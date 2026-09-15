import { NextResponse } from "next/server"
import { requireServiceAccess } from "@/lib/internal-service"
import { SourceHistoryError, sourceHistoryCapabilities } from "@/lib/source-history"

export async function GET() {
  const access = await requireServiceAccess()
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  try {
    return NextResponse.json(await sourceHistoryCapabilities())
  } catch (error) {
    if (error instanceof SourceHistoryError) return NextResponse.json({ ok: false, code: error.code, error: error.message, ...error.details }, { status: error.status })
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
