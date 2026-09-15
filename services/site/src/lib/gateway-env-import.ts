export function isProtectedGatewayEnvName(name: string) {
  return name.startsWith("RAILWAY_")
    || name.startsWith("GATEWAY_")
    || name.startsWith("PRISM_")
    || name.startsWith("BAK_")
    || name === "INTERNAL_SERVICE_TOKEN"
    || name === "APP_API_SERVICE_TOKEN"
    || name === "PRISM_AGENT_SERVICE_TOKEN"
    || name === "TASK_RUNNER_TOKEN"
    || name === "COMMUNICATION_ADAPTER_TOKEN"
    || /_PRISM_API_(?:READ_)?KEY$/.test(name)
    || /^CODEX_(?:ACCESS|REFRESH|ID)_TOKEN$/.test(name);
}

export function gatewayCredentialImportNames(parsed: Record<string, string>) {
  return Object.keys(parsed).filter(
    (name) =>
      /(KEY|TOKEN|SECRET|PASSWORD|PRIVATE|CREDENTIAL)/.test(name)
      && !isProtectedGatewayEnvName(name),
  );
}

export function gatewayImportableEnvNames(parsed: Record<string, string>) {
  return Object.keys(parsed).filter((name) => !isProtectedGatewayEnvName(name));
}

export function protectedGatewayEnvNames(parsed: Record<string, string>) {
  return Object.keys(parsed).filter(isProtectedGatewayEnvName);
}

export function parseEnvText(value: string) {
  const parsed: Record<string, string> = {};
  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^export\s+/, "");
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const name = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
    let entry = line.slice(separator + 1).trim();
    if ((entry.startsWith('"') && entry.endsWith('"')) || (entry.startsWith("'") && entry.endsWith("'"))) {
      entry = entry.slice(1, -1);
    }
    if (entry) parsed[name] = entry;
  }
  return parsed;
}
