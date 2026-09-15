import type { RuntimeProfileRecord, UpsertRuntimeProfileInput } from '@/lib/app-core';

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function booleanValue(value: unknown, fallback: boolean) {
  if (typeof value === 'boolean') return value;
  return fallback;
}

function featuresValue(value: unknown, fallback: string[]) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : fallback;
}

export function runtimeProfileInput(
  body: Record<string, unknown> | null,
  existing?: RuntimeProfileRecord | null,
): UpsertRuntimeProfileInput | null {
  const key = existing?.key || stringValue(body?.key) || '';
  const adapter = stringValue(body?.adapter) || existing?.adapter || '';
  const baseUrl = stringValue(body?.baseUrl ?? body?.base_url) || existing?.baseUrl || '';
  if (!key || !adapter || !baseUrl) return null;
  const hasDefault = body ? Object.hasOwn(body, 'isDefault') || Object.hasOwn(body, 'is_default') : false;
  return {
    key,
    name: stringValue(body?.name) || existing?.name || key,
    adapter,
    baseUrl,
    enabled: booleanValue(body?.enabled, existing?.enabled ?? true),
    ...(hasDefault || existing
      ? { isDefault: booleanValue(body?.isDefault ?? body?.is_default, existing?.isDefault ?? false) }
      : {}),
    contractVersion: stringValue(body?.contractVersion ?? body?.contract_version)
      || existing?.contractVersion
      || null,
    features: featuresValue(body?.features, existing?.features ?? []),
  };
}
