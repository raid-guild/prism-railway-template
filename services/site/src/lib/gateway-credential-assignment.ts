export type GatewayCredentialDescriptor = { key: string };

export function credentialsForSourceMode(
  mode: "off" | "readonly" | "run-approved" | "full",
  credentials: GatewayCredentialDescriptor[],
) {
  return mode === "full" ? credentials.map((credential) => ({ key: credential.key })) : [];
}

export function trustedCredentialKeys(credentials: GatewayCredentialDescriptor[]) {
  return Array.from(new Set(credentials.map((credential) => credential.key).filter(Boolean)));
}
