import { NextResponse } from "next/server"

import { getDb } from "@/lib/app-core"
import { currentPrismBuild } from "@/lib/prism-version"

export function GET() {
  const dbRow = getDb()
    .prepare("SELECT COUNT(*) AS count FROM schema_migrations")
    .get() as { count: number }

  return NextResponse.json({
    ok: true,
    service: "prism-agent",
    authMode: "opaque-cookie-session",
    build: currentPrismBuild(),
    appliedMigrations: dbRow.count,
    startupMigrations: [],
  })
}
