import type {
  ExternalInterfaceRecord,
  InteractionAccessMode,
  InteractionProfileRecord,
  UpsertExternalInterfaceInput,
  UpsertInteractionProfileInput,
} from '@/lib/app-core';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function nullableText(value: unknown) {
  return value === null ? null : typeof value === 'string' ? value.trim() || null : undefined;
}

function boolean(value: unknown) {
  return typeof value === 'boolean' ? value : undefined;
}

function mode(value: unknown): InteractionAccessMode | undefined {
  return value === 'off' || value === 'readonly' || value === 'run-approved' || value === 'full' ? value : undefined;
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined;
}

function integer(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : undefined;
}

export function interactionProfileInput(
  value: unknown,
  existing?: InteractionProfileRecord | null,
): UpsertInteractionProfileInput | null {
  const input = record(value);
  const persona = record(input.persona);
  const memoryScope = record(input.memoryScope ?? input.memory_scope);
  const rateLimit = record(input.rateLimit ?? input.rate_limit);
  const key = text(input.key) || existing?.key || '';
  if (!key) return null;
  return {
    key,
    name: input.name === undefined ? existing?.name : nullableText(input.name),
    description: input.description === undefined ? existing?.description : nullableText(input.description),
    mode: mode(input.mode) ?? existing?.mode,
    runtimeProfileKey: input.runtimeProfileKey === undefined && input.runtime_profile_key === undefined
      ? existing?.runtimeProfileKey
      : nullableText(input.runtimeProfileKey ?? input.runtime_profile_key),
    persona: {
      name: persona.name === undefined ? existing?.persona.name : nullableText(persona.name),
      instructions: persona.instructions === undefined ? existing?.persona.instructions : nullableText(persona.instructions),
    },
    memoryScope: {
      knowledgeSourceIds: strings(memoryScope.knowledgeSourceIds ?? memoryScope.knowledge_source_ids)
        ?? existing?.memoryScope.knowledgeSourceIds,
      buckets: strings(memoryScope.buckets) ?? existing?.memoryScope.buckets,
      instructions: memoryScope.instructions === undefined
        ? existing?.memoryScope.instructions
        : nullableText(memoryScope.instructions),
    },
    allowedWorkflows: strings(input.allowedWorkflows ?? input.allowed_workflows) ?? existing?.allowedWorkflows,
    rateLimit: {
      windowSeconds: integer(rateLimit.windowSeconds ?? rateLimit.window_seconds) ?? existing?.rateLimit.windowSeconds,
      maxRequests: integer(rateLimit.maxRequests ?? rateLimit.max_requests) ?? existing?.rateLimit.maxRequests,
    },
  };
}

export function externalInterfaceInput(
  value: unknown,
  existing?: ExternalInterfaceRecord | null,
): UpsertExternalInterfaceInput | null {
  const input = record(value);
  const key = text(input.key) || existing?.key || '';
  const interactionProfileKey = text(input.interactionProfileKey ?? input.interaction_profile_key)
    || existing?.interactionProfileKey
    || '';
  if (!key || !interactionProfileKey) return null;
  return {
    key,
    name: input.name === undefined ? existing?.name : nullableText(input.name),
    description: input.description === undefined ? existing?.description : nullableText(input.description),
    enabled: boolean(input.enabled) ?? existing?.enabled,
    authMode: 'api-key',
    interactionProfileKey,
    allowedOrigins: strings(input.allowedOrigins ?? input.allowed_origins) ?? existing?.allowedOrigins,
  };
}
