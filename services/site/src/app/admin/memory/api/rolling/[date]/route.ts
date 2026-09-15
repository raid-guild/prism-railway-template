import { NextResponse } from "next/server"

import { requireCapabilityAccess } from "@/lib/admin-auth"
import { fetchPrismMemoryJson } from "@/lib/prism-memory"
import { isValidMemoryDate, parseRollingDay } from "@/lib/prism-lab/memory"

export async function GET(_request: Request, { params }: { params: Promise<{ date: string }> }) {
  const access = await requireCapabilityAccess("canViewMemory")
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  const { date } = await params
  if (!isValidMemoryDate(date)) return NextResponse.json({ ok: false, error: "Invalid Memory date" }, { status: 400 })
  const result = await fetchPrismMemoryJson(`/memory/date/${date}`)
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status })
  const day = parseRollingDay(result.data)
  if (!day) return NextResponse.json({ ok: false, error: "Prism Memory returned an invalid rolling snapshot" }, { status: 502 })
  return NextResponse.json({ ok: true, day })
}
