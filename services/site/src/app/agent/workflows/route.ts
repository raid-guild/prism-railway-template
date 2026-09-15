import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

import { assignAccountabilityDomain, getAccountabilityAssignment, listWorkflows, loadConfig, upsertWorkflow } from "@/lib/app-core";
import { requireServiceAccess } from "@/lib/internal-service";
import { validateWorkflowContextPolicies } from "@/lib/workflow-context-policy";
import { modelTierFromAgentConfig } from "@/lib/model-tier";

export async function GET() {
  const access = await requireWorkflowWriteAccess();
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }

  return NextResponse.json({
    ok: true,
    workflows: listWorkflows().map((workflow) => ({
      ...workflow,
      accountabilityDomain: getAccountabilityAssignment("workflow", workflow.id),
    })),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseKey(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

function validWorkflowKey(key: string) {
  return /^[a-z0-9][a-z0-9-]{1,80}[a-z0-9]$/.test(key);
}

async function requireWorkflowWriteAccess() {
  return requireServiceAccess();
}

function resolveInsideRoot(root: string, candidate: string) {
  const resolved = path.resolve(root, candidate);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    return null;
  }
  return resolved;
}

function normalizeWorkflowFilePath(workflowRoot: string, value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const rawPath = value.trim();
  const resolved = path.isAbsolute(rawPath)
    ? path.resolve(rawPath)
    : path.resolve(workflowRoot, rawPath.replace(/^workflows\/[^/]+\//, ""));

  if (resolved !== workflowRoot && !resolved.startsWith(`${workflowRoot}${path.sep}`)) {
    return null;
  }
  return resolved;
}

function pathForManifest(workflowRoot: string, value: unknown) {
  const resolved = normalizeWorkflowFilePath(workflowRoot, value);
  return resolved ? resolved : null;
}

function manifestPathValue(workflowRoot: string, value: unknown) {
  const resolved = pathForManifest(workflowRoot, value);
  return resolved ? resolved : null;
}

function normalizeManifestPaths(definition: Record<string, unknown>, workflowRoot: string) {
  const normalized = structuredClone(definition) as Record<string, unknown>;
  const workflowPath = manifestPathValue(workflowRoot, normalized.workflowPath);
  if (workflowPath) {
    normalized.workflowPath = workflowPath;
  }

  if (Array.isArray(normalized.steps)) {
    normalized.steps = normalized.steps.map((step) => {
      if (!isRecord(step)) {
        return step;
      }
      const nextStep = { ...step };
      const instructionPath = manifestPathValue(workflowRoot, nextStep.instructionPath);
      if (instructionPath) {
        nextStep.instructionPath = instructionPath;
      }
      return nextStep;
    });
  }

  return normalized;
}

function validateWorkflowPaths(definition: Record<string, unknown>, workflowRoot: string) {
  const paths: string[] = [];
  if (typeof definition.workflowPath === "string") {
    paths.push(definition.workflowPath);
  }
  if (Array.isArray(definition.steps)) {
    for (const step of definition.steps) {
      if (isRecord(step) && typeof step.instructionPath === "string") {
        paths.push(step.instructionPath);
      }
    }
  }

  for (const rawPath of paths) {
    const resolved = normalizeWorkflowFilePath(workflowRoot, rawPath);
    if (!resolved) {
      return false;
    }
    if (resolved !== workflowRoot && !resolved.startsWith(`${workflowRoot}${path.sep}`)) {
      return false;
    }
  }
  return true;
}

function parseJsonManifest(value: string, label: string) {
  try {
    const parsed = JSON.parse(value);
    if (!isRecord(parsed)) {
      return { manifest: null, error: `${label} must be a JSON object` };
    }
    return { manifest: parsed, error: null };
  } catch {
    return { manifest: null, error: `${label} is not valid JSON` };
  }
}

function manifestFromBody(body: Record<string, unknown>) {
  if (isRecord(body.manifest)) {
    return { manifest: body.manifest, error: null };
  }
  if (isRecord(body.definition)) {
    return { manifest: body.definition, error: null };
  }
  if (typeof body.manifestJson === "string" && body.manifestJson.trim()) {
    return parseJsonManifest(body.manifestJson, "manifestJson");
  }
  if (typeof body.manifestContent === "string" && body.manifestContent.trim()) {
    return parseJsonManifest(body.manifestContent, "manifestContent");
  }
  if (isRecord(body.files) && typeof body.files["manifest.proposal.json"] === "string") {
    return parseJsonManifest(body.files["manifest.proposal.json"], 'files["manifest.proposal.json"]');
  }
  return { manifest: null, error: null };
}

export async function POST(request: Request) {
  const access = await requireWorkflowWriteAccess();
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }

  let payload: unknown = null;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const body = isRecord(payload) ? payload : {};
  const key = parseKey(body.key);
  if (!validWorkflowKey(key)) {
    return NextResponse.json({ ok: false, error: "Invalid workflow key" }, { status: 400 });
  }

  const config = loadConfig();
  const workflowRoot = path.resolve(config.dataRoot, "workflows", key);
  const manifestPath = path.resolve(workflowRoot, "manifest.proposal.json");
  let manifest: unknown = null;
  const bodyManifest = manifestFromBody(body);

  if (bodyManifest.error) {
    return NextResponse.json({ ok: false, error: bodyManifest.error }, { status: 400 });
  }

  if (bodyManifest.manifest) {
    manifest = bodyManifest.manifest;
  } else {
    if (!fs.existsSync(manifestPath)) {
      return NextResponse.json(
        {
          ok: false,
          error: `Workflow manifest not found at ${manifestPath}`,
          hint: 'To create a workflow from a runtime adapter, POST {"key","manifest","files"} to /agent/workflows. Runtime adapters cannot write the site service volume directly.',
        },
        { status: 404 },
      );
    }
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
      return NextResponse.json({ ok: false, error: "Workflow manifest is not valid JSON" }, { status: 400 });
    }
  }

  if (!isRecord(manifest)) {
    return NextResponse.json({ ok: false, error: "Workflow manifest must be an object" }, { status: 400 });
  }
  if (manifest.key !== key) {
    return NextResponse.json({ ok: false, error: "Workflow manifest key does not match requested key" }, { status: 400 });
  }
  if (!Array.isArray(manifest.steps) || !manifest.steps.length) {
    return NextResponse.json({ ok: false, error: "Workflow manifest must include steps" }, { status: 400 });
  }
  const contextPolicyError = validateWorkflowContextPolicies(manifest);
  if (contextPolicyError) {
    return NextResponse.json({ ok: false, error: contextPolicyError }, { status: 400 });
  }
  try {
    modelTierFromAgentConfig(manifest.agentConfig ?? manifest.agent_config);
    for (const step of manifest.steps) {
      if (isRecord(step)) modelTierFromAgentConfig(step.agentConfig ?? step.agent_config);
    }
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "MODEL_TIER_INVALID" }, { status: 400 });
  }
  const normalizedManifest = normalizeManifestPaths(manifest, workflowRoot);
  if (!validateWorkflowPaths(normalizedManifest, workflowRoot)) {
    return NextResponse.json({ ok: false, error: "Workflow paths must stay under the workflow volume directory" }, { status: 400 });
  }

  if (isRecord(body.files)) {
    fs.mkdirSync(workflowRoot, { recursive: true });
    for (const [relativePath, content] of Object.entries(body.files)) {
      if (relativePath === "manifest.proposal.json") {
        continue;
      }
      if (typeof content !== "string") {
        return NextResponse.json({ ok: false, error: `Workflow file ${relativePath} must be a string` }, { status: 400 });
      }
      if (path.isAbsolute(relativePath) || relativePath.includes("\0")) {
        return NextResponse.json({ ok: false, error: `Invalid workflow file path: ${relativePath}` }, { status: 400 });
      }
      const absolutePath = resolveInsideRoot(workflowRoot, relativePath);
      if (!absolutePath || absolutePath === workflowRoot) {
        return NextResponse.json({ ok: false, error: `Workflow file path escapes workflow root: ${relativePath}` }, { status: 400 });
      }
      if (!relativePath.endsWith(".md")) {
        return NextResponse.json({ ok: false, error: `Workflow file must be markdown: ${relativePath}` }, { status: 400 });
      }
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, content.trimEnd() + "\n", "utf8");
    }
  }

  fs.mkdirSync(workflowRoot, { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(normalizedManifest, null, 2)}\n`, "utf8");

  const workflow = upsertWorkflow({
    key,
    name: typeof normalizedManifest.name === "string" && normalizedManifest.name.trim() ? normalizedManifest.name.trim() : key,
    description: typeof normalizedManifest.description === "string" ? normalizedManifest.description : null,
    version: typeof normalizedManifest.version === "number" && Number.isFinite(normalizedManifest.version) ? normalizedManifest.version : 1,
    definition: normalizedManifest,
    systemDefault: false,
    enabled: body.enabled === false ? false : true,
  });

  const accountabilityDomainKey = typeof body.accountabilityDomainKey === "string"
    ? body.accountabilityDomainKey.trim()
    : typeof body.accountability_domain_key === "string"
      ? body.accountability_domain_key.trim()
      : "";
  const accountabilityAssignment = accountabilityDomainKey
    ? assignAccountabilityDomain({ targetType: "workflow", targetKey: workflow.key, domainKey: accountabilityDomainKey })
    : null;

  return NextResponse.json({ ok: true, workflow, accountabilityAssignment }, { status: 201 });
}
