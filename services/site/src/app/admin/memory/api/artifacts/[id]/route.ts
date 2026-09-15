import { NextResponse } from "next/server"

import {
  proxyPrismMemoryJson,
  withAdminMemoryArtifactViewUrl,
  type PrismArtifactDetail,
} from "@/lib/prism-memory"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const url = new URL(request.url)
  const response = await proxyPrismMemoryJson(
    `/api/artifacts/${encodeURIComponent(id)}`,
    url.searchParams,
  )
  if (!response.ok) return response

  const payload = await response.clone().json().catch(() => null) as
    | PrismArtifactDetail
    | null
  if (!payload || typeof payload !== "object") return response

  return NextResponse.json(withAdminMemoryArtifactViewUrl(payload), {
    status: response.status,
  })
}
