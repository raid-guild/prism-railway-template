import { proxyPrismMemoryResponse } from "@/lib/prism-memory"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string[] }> },
) {
  const { slug } = await params
  const url = new URL(request.url)
  const safeSlug = slug.map((segment) => encodeURIComponent(segment)).join("/")

  return proxyPrismMemoryResponse(
    `/knowledge/view/${safeSlug}`,
    url.searchParams,
  )
}
