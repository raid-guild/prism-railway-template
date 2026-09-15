import { proxyPrismMemoryJson } from "@/lib/prism-memory"

const allowedParams = ["status", "throughline_key", "limit"]

export async function GET(request: Request) {
  const url = new URL(request.url)
  return proxyPrismMemoryJson("/state/throughlines", url.searchParams, allowedParams)
}
