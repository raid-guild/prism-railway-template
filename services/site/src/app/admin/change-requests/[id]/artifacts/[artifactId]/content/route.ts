import { NextResponse } from "next/server"
import {
  getRequestArtifact,
  readRequestArtifactFile,
  safeArtifactContentDisposition,
  safeArtifactMimeType,
} from "@/lib/app-core"

import { adminFetch } from "@/lib/admin"
import { readRouteParam, requireLocalRequestViewAccess, useLocalAppApi } from "@/lib/local-admin-api"

type RouteContext = {
  params: Promise<{ id: string; artifactId: string }>
}

export async function GET(_request: Request, context: RouteContext) {
  const { id, artifactId } = await context.params

  if (useLocalAppApi()) {
    const access = await requireLocalRequestViewAccess()
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
    }

    const requestId = readRouteParam(id)
    const artifact = getRequestArtifact(readRouteParam(artifactId))
    if (!artifact || artifact.requestId !== requestId) {
      return NextResponse.json({ ok: false, error: "Artifact not found" }, { status: 404 })
    }

    try {
      const body = await readRequestArtifactFile(artifact)
      return new NextResponse(body, {
        headers: {
          "content-type": safeArtifactMimeType(artifact.mimeType),
          "content-length": String(body.byteLength),
          "content-disposition": safeArtifactContentDisposition(artifact.name),
        },
      })
    } catch {
      return NextResponse.json({ ok: false, error: "Artifact file not found" }, { status: 404 })
    }
  }

  const response = await adminFetch(`/api/admin/change-board/requests/${id}/artifacts/${artifactId}/content`)
  const body = await response.arrayBuffer()
  return new NextResponse(body, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/octet-stream",
      "content-disposition": response.headers.get("content-disposition") ?? "inline",
    },
  })
}
