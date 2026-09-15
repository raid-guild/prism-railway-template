import { proxyPrismMemoryJson } from "@/lib/prism-memory"

const allowedParams = ["status", "source", "externalSystem", "objective_key", "limit"]

export async function GET(request: Request) {
  const url = new URL(request.url)
  return proxyPrismMemoryJson("/state/objectives", url.searchParams, allowedParams)
}
