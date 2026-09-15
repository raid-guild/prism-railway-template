export const plausibleGatewayPreset = {
  key: "plausible",
  provider: "plausible",
  defaultLabel: "Plausible Analytics",
  authType: "bearer",
  secretName: "apiKey",
  credentialEnvironmentName: "PLAUSIBLE_API_KEY",
  baseUrlEnvironmentName: "PLAUSIBLE_BASE_URL",
} as const;

export const nextcrmGatewayPreset = {
  key: "nextcrm",
  provider: "nextcrm",
  defaultLabel: "NextCRM",
  authType: "bearer",
  secretName: "apiToken",
  credentialEnvironmentName: "NEXTCRM_API_TOKEN",
  baseUrlEnvironmentName: "NEXTCRM_BASE_URL",
} as const;

export function normalizeGatewayPresetOrigin(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function gatewayCredentialPath(input: { connectionId: string; secretName: string }) {
  return `/admin?tab=settings&settings=gateway&connection=${encodeURIComponent(input.connectionId)}&action=credential&secretName=${encodeURIComponent(input.secretName)}`;
}
