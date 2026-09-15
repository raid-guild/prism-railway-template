import { NextResponse } from "next/server"
import { requireServiceAccess } from "@/lib/internal-service"
import { authorizeSourceHistoryContext, communicationAdapterRequest, currentSourceAdapterPolicy, SourceHistoryError } from "@/lib/source-history"

export async function POST(request: Request) {
  const access = await requireServiceAccess()
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  try {
    const payload = await request.json().catch(() => {
      throw new SourceHistoryError(400, "INVALID_SOURCE_HISTORY_REQUEST", "Invalid JSON body")
    })
    const body = authorizeSourceHistoryContext(payload, currentSourceAdapterPolicy())
    return NextResponse.json(await communicationAdapterRequest("/history/discord/context", body))
  } catch (error) {
    if (error instanceof SourceHistoryError) return NextResponse.json({ ok: false, code: error.code, error: error.message, ...error.details }, { status: error.status })
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
