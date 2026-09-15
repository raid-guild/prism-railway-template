export type ApiErrorPayload = {
  ok?: boolean;
  error?: string;
  message?: string;
};

export async function readApiError(response: Response, fallback: string) {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const payload = (await response.json().catch(() => null)) as ApiErrorPayload | null;
    const message = payload?.error || payload?.message;
    return message ? `${fallback}: ${message}` : `${fallback}: HTTP ${response.status}`;
  }

  const text = (await response.text().catch(() => "")).trim();
  return text ? `${fallback}: HTTP ${response.status}: ${text.slice(0, 500)}` : `${fallback}: HTTP ${response.status}`;
}

export function describeFetchError(error: unknown, fallback: string) {
  if (error instanceof TypeError && /fetch/i.test(error.message)) {
    return `${fallback}: browser request failed before the server returned a response. This often means the long-running request was interrupted by the browser, proxy, deploy restart, or network connection. Check the latest run or execution log to see whether the agent run continued server-side.`;
  }
  return error instanceof Error ? error.message : fallback;
}
