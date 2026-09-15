import { NextResponse } from "next/server"

import { executeBuzzCommand } from "@/lib/buzz-agent-api"
import { requireServiceAccess } from "@/lib/internal-service"

const channelPattern = /^[0-9a-f-]{36}$/i

export async function GET(request: Request, context: { params: Promise<{ channelId: string }> }) {
  const access = await requireServiceAccess()
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  const channelId = (await context.params).channelId.trim().toLowerCase()
  if (!channelPattern.test(channelId)) return NextResponse.json({ ok: false, error: "A valid Buzz channelId is required" }, { status: 400 })
  const url = new URL(request.url)
  const limit = Math.max(1, Math.min(500, Number.parseInt(url.searchParams.get("limit") ?? "100", 10) || 100))
  const args = ["messages", "get", "--channel", channelId, "--limit", String(limit)]
  const since = url.searchParams.get("since")
  const before = url.searchParams.get("before")
  const kinds = url.searchParams.get("kinds")
  if (since && /^\d+$/.test(since)) args.push("--since", since)
  if (before && /^\d+$/.test(before)) args.push("--before", before)
  if (kinds && /^\d+(,\d+)*$/.test(kinds)) args.push("--kinds", kinds)
  try {
    const messages = await executeBuzzCommand(args)
    return NextResponse.json({ ok: true, channelId, messages: Array.isArray(messages) ? messages : [] })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "BUZZ_MESSAGES_FAILED" }, { status: 502 })
  }
}
