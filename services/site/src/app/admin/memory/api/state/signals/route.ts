import { proxyPrismMemoryJson } from "@/lib/prism-memory"

const allowedParams = ["anchor", "kind", "source", "objective_key", "throughline_key", "limit"]

export async function GET(request: Request) {
  const url = new URL(request.url)
  return proxyPrismMemoryJson("/state/signals", url.searchParams, allowedParams)
}
