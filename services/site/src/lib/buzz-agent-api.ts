function text(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : ""
}

export function parseBuzzCommandArgs(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) return null
  const args = value.map((entry) => text(entry, 8_000))
  return args.every(Boolean) ? args : null
}

function buzzAdapterBaseUrl() {
  const configured = (process.env.BUZZ_ADAPTER_BASE_URL ?? process.env.RAILWAY_SERVICE_BUZZ_ADAPTER_URL ?? "").trim()
  if (!configured) throw new Error("BUZZ_ADAPTER_BASE_URL is required")
  const withScheme = /^https?:\/\//i.test(configured) ? configured : `https://${configured}`
  return withScheme.replace(/\/+$/, "")
}

function buzzAdapterToken() {
  const token = (process.env.BUZZ_ADAPTER_TOKEN ?? "").trim()
  if (!token) throw new Error("BUZZ_ADAPTER_TOKEN is required")
  return token
}

export async function executeBuzzCommand(args: string[]) {
  const response = await fetch(`${buzzAdapterBaseUrl()}/buzz/commands`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-adapter-token": buzzAdapterToken() },
    body: JSON.stringify({ args }),
    cache: "no-store",
  })
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null
  if (!response.ok || payload?.ok !== true) {
    throw new Error(typeof payload?.error === "string" ? payload.error : `BUZZ_ADAPTER_HTTP_${response.status}`)
  }
  return payload.result
}
