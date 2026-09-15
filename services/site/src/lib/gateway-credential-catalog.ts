type GatewayCredentialCatalogEntry = {
  key?: unknown;
  status?: unknown;
  secretNames?: unknown;
  envBindings?: unknown;
};

function stringRecord(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.some(([, entry]) => typeof entry !== "string" || entry.length === 0)) return null;
  return Object.fromEntries(entries) as Record<string, string>;
}

/**
 * Return only credentials that the Gateway can lease immediately.
 *
 * Pending connections remain in the Gateway catalog for Settings, but must not
 * be auto-injected into full-access runtime sessions until every referenced
 * secret has been stored. Explicitly requesting a pending credential still
 * reaches the Gateway and returns its normal lease error.
 */
export function leaseReadyGatewayCredentials(
  credentials: GatewayCredentialCatalogEntry[],
): Array<{ key: string }> {
  return credentials.flatMap((credential) => {
    if (
      typeof credential.key !== "string"
      || credential.key.length === 0
      || (credential.status !== "untested" && credential.status !== "leased")
      || !Array.isArray(credential.secretNames)
      || credential.secretNames.some((entry) => typeof entry !== "string")
    ) return [];

    const envBindings = stringRecord(credential.envBindings);
    if (!envBindings) return [];
    const storedSecretNames = new Set(credential.secretNames as string[]);
    if (Object.values(envBindings).some((secretName) => !storedSecretNames.has(secretName))) {
      return [];
    }

    return [{ key: credential.key }];
  });
}
