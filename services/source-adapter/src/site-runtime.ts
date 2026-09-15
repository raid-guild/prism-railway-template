import { Agent } from "undici";

export type SiteRuntimeCredential = string | { key: string };

export type SiteRuntimeResponse = {
  responseText: string;
  continuationId: string | null;
  provider: string | null;
  runtimeKey: string | null;
};

function siteBaseUrl() {
  const value = (
    process.env.PRISM_AGENT_API_BASE_URL ??
    process.env.APP_API_BASE_URL ??
    process.env.PRISM_HOOKS_BASE_URL ??
    ""
  ).trim().replace(/\/+$/, "");
  if (!value) {
    throw new Error(
      "PRISM_AGENT_API_BASE_URL, APP_API_BASE_URL, or PRISM_HOOKS_BASE_URL is required",
    );
  }
  return value;
}

function siteServiceToken() {
  const value = (
    process.env.PRISM_AGENT_SERVICE_TOKEN ??
    process.env.APP_API_SERVICE_TOKEN ??
    process.env.PRISM_HOOK_SERVICE_TOKEN ??
    process.env.INTERNAL_SERVICE_TOKEN ??
    process.env.SERVICE_SHARED_TOKEN ??
    ""
  ).trim();
  if (!value) {
    throw new Error(
      "PRISM_AGENT_SERVICE_TOKEN, APP_API_SERVICE_TOKEN, PRISM_HOOK_SERVICE_TOKEN, INTERNAL_SERVICE_TOKEN, or SERVICE_SHARED_TOKEN is required",
    );
  }
  return value;
}

export async function requestSiteRuntime(input: {
  prompt: string;
  sessionId: string;
  continuationId?: string | null;
  recentHistory?: Array<{ role: string; content: string }>;
  credentials?: SiteRuntimeCredential[];
  context?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  skills?: string[];
  runtimeProfileKey?: string | null;
  timeoutMs: number;
}): Promise<SiteRuntimeResponse> {
  const baseUrl = siteBaseUrl();
  const serviceToken = siteServiceToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs + 5_000);
  // Node's default fetch dispatcher stops waiting for response headers after
  // five minutes. Runtime invocations legitimately run longer because Site
  // returns headers only after the runtime job completes.
  const dispatcherTimeoutMs = Math.max(input.timeoutMs + 10_000, 15_000);
  const dispatcher = new Agent({
    headersTimeout: dispatcherTimeoutMs,
    bodyTimeout: dispatcherTimeoutMs,
  });
  try {
    const response = await fetch(`${baseUrl}/agent/runtime/invoke`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-service-token": serviceToken,
      },
      body: JSON.stringify(input),
      signal: controller.signal,
      dispatcher,
    } as RequestInit & { dispatcher: Agent });
    const payload = await response.json().catch(() => null) as {
      error?: unknown;
      response?: {
        responseText?: unknown;
        output_text?: unknown;
        thread_id?: unknown;
        id?: unknown;
        provider?: unknown;
        runtimeKey?: unknown;
      };
    } | null;
    if (!response.ok) {
      throw new Error(`SITE_RUNTIME_REQUEST_FAILED:${response.status}:${String(payload?.error ?? "unknown").slice(0, 300)}`);
    }
    const runtimeResponse = payload?.response;
    const responseText = typeof runtimeResponse?.responseText === "string"
      ? runtimeResponse.responseText.trim()
      : typeof runtimeResponse?.output_text === "string"
        ? runtimeResponse.output_text.trim()
        : "";
    if (!responseText) throw new Error("RUNTIME_EMPTY_RESPONSE");
    const continuationId = typeof runtimeResponse?.thread_id === "string"
      ? runtimeResponse.thread_id
      : typeof runtimeResponse?.id === "string"
        ? runtimeResponse.id
        : null;
    return {
      responseText,
      continuationId,
      provider: typeof runtimeResponse?.provider === "string" ? runtimeResponse.provider : null,
      runtimeKey: typeof runtimeResponse?.runtimeKey === "string" ? runtimeResponse.runtimeKey : null,
    };
  } finally {
    clearTimeout(timer);
    await dispatcher.close().catch(() => undefined);
  }
}
