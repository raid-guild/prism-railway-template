import { NextResponse } from "next/server"

import { requireLocalAdminAccess } from "@/lib/local-admin-api"

type RouteContext = {
  params: Promise<{ id: string; executionId: string }>
}

export async function POST(_request: Request, context: RouteContext) {
  await context.params

  const access = await requireLocalAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  return NextResponse.json(
    {
      ok: false,
      error: "CHANGE_REQUEST_EXECUTIONS_DEPRECATED",
      message: "Use the workflow cancel route to cancel active agent runs.",
    },
    { status: 410 },
  )
}
