import { NextResponse } from "next/server"

import { requireCapabilityAccess } from "@/lib/admin-auth"
import { fetchPrismMemoryJson } from "@/lib/prism-memory"
import { listRollingDatesFromIndex, parseRollingDay } from "@/lib/prism-lab/memory"

export async function GET() {
  const access = await requireCapabilityAccess("canViewMemory")
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status })

  const params = new URLSearchParams({ limit: "180" })
  const [index, latest] = await Promise.all([
    fetchPrismMemoryJson("/memory/dates", params, ["limit"]),
    fetchPrismMemoryJson("/memory/latest"),
  ])
  const latestDay = latest.ok ? parseRollingDay(latest.data) : null
  const dates = index.ok ? listRollingDatesFromIndex(index.data) : []
  if (latestDay && !dates.includes(latestDay.date)) dates.unshift(latestDay.date)
  const uniqueDates = Array.from(new Set(dates)).sort((left, right) => right.localeCompare(left))

  if (!latestDay && !index.ok) {
    return NextResponse.json({ ok: false, error: latest.error || index.error }, { status: latest.status || index.status })
  }
  return NextResponse.json({
    ok: true,
    latestDate: latestDay?.date ?? uniqueDates[0] ?? null,
    dates: uniqueDates,
    warnings: [!index.ok ? `Rolling date index unavailable: ${index.error}` : null, !latest.ok ? `Latest snapshot unavailable: ${latest.error}` : null].filter(Boolean),
  })
}
