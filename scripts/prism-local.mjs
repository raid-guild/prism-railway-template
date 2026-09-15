#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const instanceName = (process.env.PRISM_LOCAL_INSTANCE || "default").replace(/[^a-zA-Z0-9_.-]/g, "-");
const localHome = path.resolve(
  process.env.PRISM_LOCAL_HOME || path.join(os.homedir(), ".local", "share", "prism"),
);
const instanceRoot = path.join(localHome, "instances", instanceName);
const dataRoot = path.join(instanceRoot, "data");
const envPath = path.join(instanceRoot, "local.env");
const runtimePidPath = path.join(instanceRoot, "codex-runtime.pid");
const runtimeLogPath = path.join(instanceRoot, "codex-runtime.log");
const grokRuntimePidPath = path.join(instanceRoot, "grok-runtime.pid");
const grokRuntimeLogPath = path.join(instanceRoot, "grok-runtime.log");
const composePath = path.join(repoRoot, "compose.yaml");
const versionManifestPath = path.join(repoRoot, "services", "site", "prism-version.json");

function readVersionManifest() {
  try {
    const value = JSON.parse(fs.readFileSync(versionManifestPath, "utf8"));
    if (
      typeof value.version === "string" &&
      typeof value.repository === "string" &&
      typeof value.branch === "string"
    ) {
      return value;
    }
  } catch {
    // The caller reports unavailable version metadata without blocking local operations.
  }
  return null;
}

function versionParts(value) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(String(value).trim());
  if (!match) return null;
  const prerelease = match[4]?.split(".") || null;
  if (prerelease?.some((identifier) => /^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith("0"))) {
    return null;
  }
  return {
    numbers: [match[1], match[2], match[3]],
    prerelease,
  };
}

function compareNumericIdentifiers(left, right) {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function comparePrereleaseIdentifiers(left, right) {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = left[index];
    const rightIdentifier = right[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    if (leftIdentifier === rightIdentifier) continue;

    const leftNumeric = /^\d+$/.test(leftIdentifier);
    const rightNumeric = /^\d+$/.test(rightIdentifier);
    if (leftNumeric && rightNumeric) {
      return compareNumericIdentifiers(leftIdentifier, rightIdentifier);
    }
    if (leftNumeric) return -1;
    if (rightNumeric) return 1;
    return leftIdentifier < rightIdentifier ? -1 : 1;
  }
  return 0;
}

function compareVersions(left, right) {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  if (!leftParts || !rightParts) return null;
  for (let index = 0; index < leftParts.numbers.length; index += 1) {
    if (leftParts.numbers[index] !== rightParts.numbers[index]) {
      return compareNumericIdentifiers(leftParts.numbers[index], rightParts.numbers[index]);
    }
  }
  if (leftParts.prerelease === rightParts.prerelease) return 0;
  if (leftParts.prerelease === null) return 1;
  if (rightParts.prerelease === null) return -1;
  return comparePrereleaseIdentifiers(leftParts.prerelease, rightParts.prerelease);
}

async function localVersionStatus() {
  const current = readVersionManifest();
  if (!current) return null;
  try {
    const shaResult = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" });
    const currentSha = shaResult.status === 0 ? shaResult.stdout.trim() : null;
    const manifestRequest = fetch(
      `https://raw.githubusercontent.com/${current.repository}/${current.branch}/services/site/prism-version.json`,
      { signal: AbortSignal.timeout(3_000), headers: { accept: "application/json" } },
    );
    const comparisonRequest = currentSha
      ? fetch(
        `https://api.github.com/repos/${current.repository}/compare/${currentSha}...${current.branch}`,
        {
          signal: AbortSignal.timeout(3_000),
          headers: {
            accept: "application/vnd.github+json",
            "x-github-api-version": "2022-11-28",
          },
        },
      )
      : null;
    const [response, comparisonResponse] = await Promise.all([manifestRequest, comparisonRequest]);
    if (!response.ok) return { current, latest: null, comparison: null };
    const latest = await response.json();
    if (
      latest.repository !== current.repository ||
      latest.branch !== current.branch ||
      typeof latest.version !== "string"
    ) {
      return { current, latest: null, comparison: null, commitUpdate: false, currentSha };
    }
    let commitUpdate = false;
    if (comparisonResponse?.ok) {
      const gitComparison = await comparisonResponse.json();
      commitUpdate =
        (gitComparison.status === "behind" || gitComparison.status === "diverged") &&
        Number(gitComparison.behind_by) > 0 &&
        Array.isArray(gitComparison.files) &&
        gitComparison.files.length > 0;
    }
    return {
      current,
      latest,
      comparison: compareVersions(current.version, latest.version),
      commitUpdate,
      currentSha,
    };
  } catch {
    return { current, latest: null, comparison: null, commitUpdate: false, currentSha: null };
  }
}

async function printLocalVersionStatus({ always = false } = {}) {
  const status = await localVersionStatus();
  if (!status) return;
  if (status.comparison === -1 || status.commitUpdate) {
    const updateLabel = status.comparison === -1
      ? `Prism ${status.latest.version}`
      : "A newer Prism build";
    console.log(
      `update ${updateLabel} is available; this checkout is ${status.current.version}.`,
    );
    console.log(
      `       Review changes at https://github.com/${status.current.repository}/${status.currentSha ? `compare/${status.currentSha}...${status.current.branch}` : `commits/${status.current.branch}`}`,
    );
    console.log("       Preserve local changes before updating from the canonical main branch.");
  } else if (always) {
    const suffix = status.comparison === 0
      ? "current"
      : status.comparison === 1
        ? "development build"
        : "update check unavailable";
    console.log(`info Prism ${status.current.version} (${suffix})`);
  }
}

function randomSecret(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

function envLine(key, value) {
  return `${key}=${JSON.stringify(String(value))}`;
}

function initialConfig(defaultRuntime) {
  return {
    COMPOSE_PROJECT_NAME: `prism-local-${instanceName}`.replace(/[^a-zA-Z0-9_-]/g, "-"),
    PRISM_LOCAL_DATA_DIR: dataRoot,
    SITE_PORT: "3100",
    CODEX_RUNTIME_PORT: "3030",
    GROK_RUNTIME_PORT: "3031",
    PRISM_API_PORT: "8788",
    PRISM_GATEWAY_PORT: "8794",
    TASK_RUNNER_PORT: "8790",
    ADMIN_EMAIL: "admin@local.agent",
    ADMIN_PASSWORD: randomSecret(18),
    SESSION_SECRET: randomSecret(),
    INTERNAL_SERVICE_TOKEN: randomSecret(),
    PRISM_API_KEY: randomSecret(),
    GATEWAY_MASTER_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    GATEWAY_SITE_TOKEN: randomSecret(),
    GATEWAY_CODEX_RUNTIME_TOKEN: randomSecret(),
    GATEWAY_TASK_RUNNER_TOKEN: randomSecret(),
    TASK_RUNNER_TOKEN: randomSecret(),
    CODEX_HOME: process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
    GROK_HOME: process.env.GROK_HOME || path.join(os.homedir(), ".grok"),
    PRISM_LOCAL_DEFAULT_RUNTIME: defaultRuntime,
  };
}

function writeInitialConfig(defaultRuntime) {
  fs.mkdirSync(instanceRoot, { recursive: true, mode: 0o700 });
  for (const directory of ["site", "gateway", "memory"]) {
    fs.mkdirSync(path.join(dataRoot, directory), { recursive: true, mode: 0o700 });
  }
  const config = initialConfig(defaultRuntime);
  const content = [
    "# Generated by `prism local init`. Keep this file private.",
    `# Instance: ${instanceName}`,
    ...Object.entries(config).map(([key, value]) => envLine(key, value)),
    "",
  ].join("\n");
  fs.writeFileSync(envPath, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
  return config;
}

function parseEnvFile() {
  if (!fs.existsSync(envPath)) return null;
  const result = {};
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator);
    const raw = trimmed.slice(separator + 1);
    try {
      result[key] = JSON.parse(raw);
    } catch {
      result[key] = raw;
    }
  }
  return result;
}

async function ensureConfig({ quiet = false } = {}) {
  const existing = parseEnvFile();
  if (existing) return { config: existing, created: false };
  const defaultRuntime = await selectDefaultRuntime();
  const config = writeInitialConfig(defaultRuntime);
  if (!quiet) printFirstRun(config);
  return { config, created: true };
}

function detectedRuntimes(config = {}) {
  return [
    resolveHostCodexBinary(config)
      ? { key: "codex-default", label: "Codex CLI" }
      : null,
    resolveHostGrokBinary(config)
      ? { key: "grok-local", label: "Grok Build" }
      : null,
  ].filter(Boolean);
}

async function selectDefaultRuntime(config = {}) {
  const runtimes = detectedRuntimes(config);
  if (runtimes.length === 0) {
    throw new Error("No supported host runtime was detected. Install and authenticate Codex CLI or Grok Build first.");
  }
  const requested = process.env.PRISM_LOCAL_DEFAULT_RUNTIME?.trim() || config.PRISM_LOCAL_DEFAULT_RUNTIME?.trim();
  if (requested) {
    if (!runtimes.some((runtime) => runtime.key === requested)) {
      throw new Error(`Requested local runtime '${requested}' was not detected.`);
    }
    return requested;
  }
  if (runtimes.length === 1 || !process.stdin.isTTY || !process.stdout.isTTY) {
    return runtimes[0].key;
  }

  console.log("Detected runtime adapters:");
  runtimes.forEach((runtime, index) => console.log(`  ${index + 1}. ${runtime.label}`));
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question(`Default runtime [1-${runtimes.length}] (1): `);
    const selectedIndex = answer.trim() ? Number.parseInt(answer.trim(), 10) - 1 : 0;
    if (!Number.isInteger(selectedIndex) || !runtimes[selectedIndex]) {
      throw new Error("Invalid runtime selection.");
    }
    return runtimes[selectedIndex].key;
  } finally {
    prompt.close();
  }
}

function persistConfigValue(key, value) {
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  const replacement = envLine(key, value);
  const index = lines.findIndex((line) => line.startsWith(`${key}=`));
  if (index >= 0) lines[index] = replacement;
  else lines.splice(Math.max(0, lines.length - 1), 0, replacement);
  fs.writeFileSync(envPath, `${lines.join("\n").replace(/\n+$/, "")}\n`, { encoding: "utf8", mode: 0o600 });
}

function printFirstRun(config) {
  console.log(`Initialized Prism local instance '${instanceName}' at ${instanceRoot}`);
  console.log(`Admin: ${config.ADMIN_EMAIL}`);
  console.log(`Initial password: ${config.ADMIN_PASSWORD}`);
  console.log(`Default runtime: ${config.PRISM_LOCAL_DEFAULT_RUNTIME}`);
  console.log("Provider credentials should be added later through Settings > Gateway.");
}

function commandExists(command) {
  return spawnSync(command, ["--version"], { stdio: "ignore" }).status === 0;
}

function findExecutable(command, { excludeNodeModules = false } = {}) {
  if (command.includes(path.sep)) {
    try {
      fs.accessSync(command, fs.constants.X_OK);
      return path.resolve(command);
    } catch {
      return null;
    }
  }

  const extensions = process.platform === "win32"
    ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";")
    : [""];
  for (const directory of (process.env.PATH || "").split(path.delimiter)) {
    if (!directory) continue;
    const normalized = path.resolve(directory);
    if (excludeNodeModules && normalized.includes(`${path.sep}node_modules${path.sep}.bin`)) continue;
    for (const extension of extensions) {
      const candidate = path.join(normalized, `${command}${extension.toLowerCase()}`);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        // Continue searching PATH.
      }
    }
  }
  return null;
}

function resolveHostCodexBinary(config = {}) {
  const configured = config.CODEX_BIN || process.env.PRISM_LOCAL_CODEX_BIN || process.env.CODEX_BIN;
  return findExecutable(configured?.trim() || "codex", { excludeNodeModules: !configured });
}

function resolveHostGrokBinary(config = {}) {
  const configured = config.GROK_BIN || process.env.PRISM_LOCAL_GROK_BIN || process.env.GROK_BIN;
  return findExecutable(configured?.trim() || "grok", { excludeNodeModules: !configured });
}

function codexVersion(codexBinary) {
  if (!codexBinary) return null;
  const result = spawnSync(codexBinary, ["--version"], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function grokVersion(grokBinary) {
  if (!grokBinary) return null;
  const result = spawnSync(grokBinary, ["--version"], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim().replace(/\s+/g, " ") : null;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}`);
  }
}

function composeArgs(args) {
  return ["compose", "--env-file", envPath, "-f", composePath, ...args];
}

function runCompose(args, options = {}) {
  const shaResult = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" });
  const branchResult = spawnSync("git", ["branch", "--show-current"], { cwd: repoRoot, encoding: "utf8" });
  run("docker", composeArgs(args), {
    ...options,
    env: {
      ...process.env,
      PRISM_BUILD_SHA: shaResult.status === 0 ? shaResult.stdout.trim() : "unknown",
      PRISM_BUILD_BRANCH: branchResult.status === 0 ? branchResult.stdout.trim() : "unknown",
      ...(options.env || {}),
    },
  });
}

function readManagedPid(pidPath = runtimePidPath) {
  if (!fs.existsSync(pidPath)) return null;
  const pid = Number.parseInt(fs.readFileSync(pidPath, "utf8").trim(), 10);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

function pidIsRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function cleanStalePid(pidPath = runtimePidPath) {
  const pid = readManagedPid(pidPath);
  if (pid && pidIsRunning(pid)) return pid;
  fs.rmSync(pidPath, { force: true });
  return null;
}

async function fetchHealth(name, url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
    const body = await response.json().catch(() => ({}));
    return { name, ok: response.ok && body.ok !== false, status: response.status, body };
  } catch (error) {
    return { name, ok: false, status: null, error: error instanceof Error ? error.message : String(error) };
  }
}

async function waitForHealth(name, url, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await fetchHealth(name, url);
    if (result.ok) return result;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`${name} did not become healthy at ${url}`);
}

function runtimeEnvironment(config, codexBinary) {
  return {
    ...process.env,
    NODE_ENV: "production",
    PORT: config.CODEX_RUNTIME_PORT,
    CODEX_HOME: config.CODEX_HOME,
    CODEX_BIN: codexBinary,
    CODEX_WORKSPACE_ROOT: repoRoot,
    CODEX_TARGET_WORKSPACE_ROOT: path.join(dataRoot, "runtime-workspaces"),
    APP_API_BASE_URL: `http://127.0.0.1:${config.SITE_PORT}`,
    APP_API_SERVICE_TOKEN: config.INTERNAL_SERVICE_TOKEN,
    INTERNAL_SERVICE_TOKEN: config.INTERNAL_SERVICE_TOKEN,
    PRISM_API_BASE: `http://127.0.0.1:${config.PRISM_API_PORT}`,
    PRISM_API_KEY: config.PRISM_API_KEY,
    PRISM_API_READ_KEY: config.PRISM_API_KEY,
    PRISM_GATEWAY_ENABLED: "true",
    PRISM_GATEWAY_BASE_URL: `http://127.0.0.1:${config.PRISM_GATEWAY_PORT}`,
    PRISM_GATEWAY_TOKEN: config.GATEWAY_CODEX_RUNTIME_TOKEN,
    PRISM_RUNTIME_KEY: "codex-default",
  };
}

function grokRuntimeEnvironment(config, grokBinary) {
  return {
    ...process.env,
    NODE_ENV: "production",
    PORT: config.GROK_RUNTIME_PORT || "3031",
    GROK_HOME: config.GROK_HOME || path.join(os.homedir(), ".grok"),
    GROK_BIN: grokBinary,
    GROK_WORKSPACE_ROOT: repoRoot,
    APP_API_BASE_URL: `http://127.0.0.1:${config.SITE_PORT}`,
    APP_API_SERVICE_TOKEN: config.INTERNAL_SERVICE_TOKEN,
    INTERNAL_SERVICE_TOKEN: config.INTERNAL_SERVICE_TOKEN,
    PRISM_RUNTIME_KEY: "grok-local",
  };
}

async function startRuntime(config) {
  const existingPid = cleanStalePid();
  if (existingPid) {
    console.log(`Codex runtime already running (pid ${existingPid}).`);
    return true;
  }

  const runtimeUrl = `http://127.0.0.1:${config.CODEX_RUNTIME_PORT}/health`;
  const existingHealth = await fetchHealth("codex-runtime", runtimeUrl);
  if (existingHealth.ok) {
    console.log(`Using an existing runtime at ${runtimeUrl}.`);
    return true;
  }

  const codexBinary = resolveHostCodexBinary(config);
  if (!codexBinary) {
    console.log("Codex CLI not detected; skipping the optional Codex runtime adapter.");
    return false;
  }
  if (!fs.existsSync(path.join(repoRoot, "node_modules"))) {
    throw new Error("Repository dependencies are missing. Run `npm install` before `prism local up`.");
  }

  console.log("Building the host Codex runtime adapter...");
  console.log(`Using host Codex CLI: ${codexBinary} (${codexVersion(codexBinary) || "version unknown"})`);
  run("npm", ["run", "build", "--workspace", "@prism-railway/codex-runtime"]);
  fs.mkdirSync(path.join(dataRoot, "runtime-workspaces"), { recursive: true, mode: 0o700 });
  const logFd = fs.openSync(runtimeLogPath, "a", 0o600);
  const child = spawn(process.execPath, [path.join(repoRoot, "services/codex-runtime/dist/index.js")], {
    cwd: repoRoot,
    env: runtimeEnvironment(config, codexBinary),
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();
  fs.closeSync(logFd);
  fs.writeFileSync(runtimePidPath, `${child.pid}\n`, { mode: 0o600 });
  try {
    await waitForHealth("codex-runtime", runtimeUrl, 30_000);
  } catch (error) {
    await stopRuntime();
    throw new Error(`${error instanceof Error ? error.message : String(error)}. See ${runtimeLogPath}`);
  }
  console.log(`Codex runtime adapter started (pid ${child.pid}).`);
  return true;
}

async function startGrokRuntime(config) {
  const grokBinary = resolveHostGrokBinary(config);
  if (!grokBinary) {
    console.log("Grok CLI not detected; skipping the optional Grok runtime adapter.");
    return false;
  }
  const existingPid = cleanStalePid(grokRuntimePidPath);
  if (existingPid) {
    console.log(`Grok runtime already running (pid ${existingPid}).`);
    return true;
  }

  const port = config.GROK_RUNTIME_PORT || "3031";
  const runtimeUrl = `http://127.0.0.1:${port}/health`;
  const existingHealth = await fetchHealth("grok-runtime", runtimeUrl);
  if (existingHealth.ok) {
    console.log(`Using an existing Grok runtime at ${runtimeUrl}.`);
    return true;
  }

  console.log("Building the host Grok runtime adapter...");
  console.log(`Using host Grok CLI: ${grokBinary} (${grokVersion(grokBinary) || "version unknown"})`);
  run("npm", ["run", "build", "--workspace", "@prism-railway/contracts"]);
  run("npm", ["run", "build", "--workspace", "@prism-railway/grok-runtime"]);
  const logFd = fs.openSync(grokRuntimeLogPath, "a", 0o600);
  const child = spawn(process.execPath, [path.join(repoRoot, "services/grok-runtime/dist/index.js")], {
    cwd: repoRoot,
    env: grokRuntimeEnvironment(config, grokBinary),
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();
  fs.closeSync(logFd);
  fs.writeFileSync(grokRuntimePidPath, `${child.pid}\n`, { mode: 0o600 });
  try {
    await waitForHealth("grok-runtime", runtimeUrl, 30_000);
  } catch (error) {
    await stopManagedRuntime(grokRuntimePidPath, "Grok runtime adapter");
    throw new Error(`${error instanceof Error ? error.message : String(error)}. See ${grokRuntimeLogPath}`);
  }
  console.log(`Grok runtime adapter started (pid ${child.pid}).`);
  return true;
}

async function stopManagedRuntime(pidPath, label) {
  const pid = cleanStalePid(pidPath);
  if (!pid) return;
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    process.kill(pid, "SIGTERM");
  }
  const deadline = Date.now() + 5_000;
  while (pidIsRunning(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (pidIsRunning(pid)) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      process.kill(pid, "SIGKILL");
    }
  }
  fs.rmSync(pidPath, { force: true });
  console.log(`${label} stopped.`);
}

async function stopRuntime() {
  await stopManagedRuntime(runtimePidPath, "Codex runtime adapter");
}

function serviceUrls(config, startedRuntimes = null) {
  const urls = [
    ["site", `http://127.0.0.1:${config.SITE_PORT}/api/health`],
    ["gateway", `http://127.0.0.1:${config.PRISM_GATEWAY_PORT}/health`],
    ["memory", `http://127.0.0.1:${config.PRISM_API_PORT}/health`],
    ["task-runner", `http://127.0.0.1:${config.TASK_RUNNER_PORT}/health`],
  ];
  if (startedRuntimes ? startedRuntimes.codex : resolveHostCodexBinary(config)) {
    urls.push(["codex-runtime", `http://127.0.0.1:${config.CODEX_RUNTIME_PORT}/health`]);
  }
  if (startedRuntimes ? startedRuntimes.grok : resolveHostGrokBinary(config)) {
    urls.push(["grok-runtime", `http://127.0.0.1:${config.GROK_RUNTIME_PORT || "3031"}/health`]);
  }
  return urls;
}

async function registerRuntimeProfile(config, profile, isDefault) {
  const response = await fetch(`http://127.0.0.1:${config.SITE_PORT}/agent/runtime-profiles`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-service-token": config.INTERNAL_SERVICE_TOKEN,
    },
    body: JSON.stringify({ ...profile, enabled: true, ...(isDefault ? { isDefault: true } : {}) }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Could not register runtime profile ${profile.key}: ${response.status}:${body.slice(0, 500)}`);
  }
  console.log(`${profile.key}: registered with Site${isDefault ? " (default)" : ""}`);
}

async function existingSiteDefault(config, availableKeys) {
  try {
    const response = await fetch(`http://127.0.0.1:${config.SITE_PORT}/agent/runtime-profiles`, {
      headers: { "x-service-token": config.INTERNAL_SERVICE_TOKEN },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const current = Array.isArray(payload.profiles)
      ? payload.profiles.find((profile) => profile?.isDefault === true && availableKeys.includes(profile.key))
      : null;
    return current?.key || null;
  } catch {
    return null;
  }
}

async function resolveLocalDefault(config, startedRuntimes) {
  const availableKeys = [
    ...(startedRuntimes.codex ? ["codex-default"] : []),
    ...(startedRuntimes.grok ? ["grok-local"] : []),
  ];
  if (availableKeys.length === 0) {
    throw new Error("No supported host runtime could be started.");
  }
  if (config.PRISM_LOCAL_RUNTIME_SETUP_COMPLETE === "true") {
    const current = await existingSiteDefault(config, availableKeys);
    if (current) {
      if (config.PRISM_LOCAL_DEFAULT_RUNTIME !== current) {
        persistConfigValue("PRISM_LOCAL_DEFAULT_RUNTIME", current);
        config.PRISM_LOCAL_DEFAULT_RUNTIME = current;
        console.log(`Updated local default runtime from Site: ${current}`);
      }
      return current;
    }
  }
  if (availableKeys.includes(config.PRISM_LOCAL_DEFAULT_RUNTIME)) {
    return config.PRISM_LOCAL_DEFAULT_RUNTIME;
  }
  const current = await existingSiteDefault(config, availableKeys);
  const selected = current || await selectDefaultRuntime(config);
  persistConfigValue("PRISM_LOCAL_DEFAULT_RUNTIME", selected);
  config.PRISM_LOCAL_DEFAULT_RUNTIME = selected;
  console.log(`Persisted local default runtime: ${selected}`);
  return selected;
}

async function registerLocalRuntimeProfiles(config, startedRuntimes) {
  const selected = await resolveLocalDefault(config, startedRuntimes);
  const profiles = [
    ...(startedRuntimes.codex ? [{
      key: "codex-default",
      name: "Codex Local",
      adapter: "codex-cli",
      baseUrl: `http://host.docker.internal:${config.CODEX_RUNTIME_PORT}`,
      contractVersion: "2026-07-10",
      features: ["cancellation", "continuations", "gateway-credentials", "workspace-assignment"],
    }] : []),
    ...(startedRuntimes.grok ? [{
      key: "grok-local",
      name: "Grok Build Local",
      adapter: "grok-build",
      baseUrl: `http://host.docker.internal:${config.GROK_RUNTIME_PORT || "3031"}`,
      contractVersion: "2026-07-10",
      features: ["repository", "shell", "site-hosted-skills", "continuations", "cancellation"],
    }] : []),
  ];
  for (const profile of profiles.filter((profile) => profile.key !== selected)) {
    await registerRuntimeProfile(config, profile, false);
  }
  const defaultProfile = profiles.find((profile) => profile.key === selected);
  await registerRuntimeProfile(config, defaultProfile, true);
  if (config.PRISM_LOCAL_RUNTIME_SETUP_COMPLETE !== "true") {
    persistConfigValue("PRISM_LOCAL_RUNTIME_SETUP_COMPLETE", "true");
    config.PRISM_LOCAL_RUNTIME_SETUP_COMPLETE = "true";
  }
}

async function initCommand() {
  const existing = parseEnvFile();
  if (existing) {
    console.log(`Prism local instance '${instanceName}' is already initialized at ${instanceRoot}.`);
    return;
  }
  const defaultRuntime = await selectDefaultRuntime();
  printFirstRun(writeInitialConfig(defaultRuntime));
}

async function upCommand() {
  if (!commandExists("docker")) throw new Error("Docker is required for `prism local up`.");
  const { config } = await ensureConfig();
  runCompose(["up", "-d", "--build"]);
  const codexStarted = await startRuntime(config);
  const grokStarted = await startGrokRuntime(config);
  const startedRuntimes = { codex: codexStarted, grok: grokStarted };
  for (const [name, url] of serviceUrls(config, startedRuntimes)) {
    await waitForHealth(name, url);
    console.log(`${name}: healthy`);
  }
  await registerLocalRuntimeProfiles(config, startedRuntimes);
  console.log(`Prism is available at http://127.0.0.1:${config.SITE_PORT}`);
  await printLocalVersionStatus();
}

async function siteCommand() {
  if (!commandExists("docker")) throw new Error("Docker is required for `prism local site`.");
  const { config } = await ensureConfig();
  runCompose(["up", "-d", "--build", "--no-deps", "site"]);
  await waitForHealth("site", `http://127.0.0.1:${config.SITE_PORT}/api/health`);
  console.log(`Site refreshed at http://127.0.0.1:${config.SITE_PORT}`);
}

async function downCommand() {
  await stopManagedRuntime(grokRuntimePidPath, "Grok runtime adapter");
  await stopRuntime();
  if (fs.existsSync(envPath) && commandExists("docker")) runCompose(["down"]);
}

async function statusCommand() {
  const config = parseEnvFile();
  if (!config) {
    console.log(`Prism local instance '${instanceName}' is not initialized.`);
    process.exitCode = 1;
    return;
  }
  if (commandExists("docker")) runCompose(["ps"]);
  const results = await Promise.all(serviceUrls(config).map(([name, url]) => fetchHealth(name, url)));
  for (const result of results) {
    console.log(`${result.ok ? "ok  " : "fail"} ${result.name}${result.status ? ` (${result.status})` : ""}`);
  }
  await printLocalVersionStatus({ always: true });
  if (results.some((result) => !result.ok)) process.exitCode = 1;
}

async function doctorCommand() {
  const checks = [];
  const config = parseEnvFile();
  const codexBinary = resolveHostCodexBinary(config || {});
  const grokBinary = resolveHostGrokBinary(config || {});
  checks.push(["docker", commandExists("docker"), "Install Docker with the Compose plugin."]);
  const compose = spawnSync("docker", ["compose", "version"], { stdio: "ignore" }).status === 0;
  checks.push(["docker compose", compose, "Install the Docker Compose plugin."]);
  checks.push(["node >= 20", Number(process.versions.node.split(".")[0]) >= 20, `Current Node is ${process.versions.node}.`]);
  checks.push([
    "supported host runtime",
    Boolean(codexBinary || grokBinary),
    "Install and authenticate Codex CLI or Grok Build.",
  ]);
  if (codexBinary) {
    checks.push([
      `host Codex CLI (${codexVersion(codexBinary) || "version unknown"}; ${codexBinary})`,
      true,
      "",
    ]);
  } else {
    console.log("info host Codex CLI not installed; Codex runtime is optional.");
  }
  if (grokBinary) {
    checks.push([
      `host Grok CLI (${grokVersion(grokBinary) || "version unknown"}; ${grokBinary})`,
      true,
      "",
    ]);
  } else {
    console.log("info host Grok CLI not installed; Grok runtime is optional.");
  }
  checks.push(["local config", fs.existsSync(envPath), "Run `prism local init`."]);

  for (const [name, ok, help] of checks) {
    console.log(`${ok ? "ok  " : "fail"} ${name}${ok ? "" : `: ${help}`}`);
  }
  if (config) {
    for (const result of await Promise.all(serviceUrls(config).map(([name, url]) => fetchHealth(name, url)))) {
      console.log(`${result.ok ? "ok  " : "warn"} ${result.name} health${result.status ? ` (${result.status})` : ""}`);
    }
  }
  await printLocalVersionStatus({ always: true });
  if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
}

async function logsCommand(service) {
  await ensureConfig({ quiet: true });
  if (service === "runtime" || service === "codex-runtime") {
    if (!fs.existsSync(runtimeLogPath)) {
      console.log(`No runtime log exists at ${runtimeLogPath}.`);
      return;
    }
    run("tail", ["-n", "200", "-f", runtimeLogPath]);
    return;
  }
  if (service === "grok" || service === "grok-runtime") {
    if (!fs.existsSync(grokRuntimeLogPath)) {
      console.log(`No Grok runtime log exists at ${grokRuntimeLogPath}.`);
      return;
    }
    run("tail", ["-n", "200", "-f", grokRuntimeLogPath]);
    return;
  }
  runCompose(["logs", "-f", "--tail", "200", ...(service ? [service] : [])]);
}

async function openCommand() {
  const { config } = await ensureConfig({ quiet: true });
  const url = `http://127.0.0.1:${config.SITE_PORT}`;
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
  console.log(url);
}

function usage() {
  console.log(`Usage: prism-local <command>\n\nCommands:\n  init\n  up\n  site\n  down\n  status\n  doctor\n  logs [service]\n  open`);
}

const [command = "help", argument] = process.argv.slice(2);

try {
  if (command === "init") await initCommand();
  else if (command === "up") await upCommand();
  else if (command === "site") await siteCommand();
  else if (command === "down") await downCommand();
  else if (command === "status") await statusCommand();
  else if (command === "doctor") await doctorCommand();
  else if (command === "logs") await logsCommand(argument);
  else if (command === "open") await openCommand();
  else usage();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
