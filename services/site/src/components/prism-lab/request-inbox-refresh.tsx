"use client"

import { useCallback, useEffect, useRef, useTransition } from "react"
import { useRouter } from "next/navigation"
import { RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { shouldRefreshInbox } from "@/lib/prism-lab/inbox-refresh"
import { cn } from "@/lib/utils"

const inboxRefreshIntervalMs = 10_000

export function RequestInboxRefresh() {
  const router = useRouter()
  const [refreshPending, startRefresh] = useTransition()
  const refreshPendingRef = useRef(refreshPending)
  refreshPendingRef.current = refreshPending

  const refresh = useCallback(() => {
    if (!shouldRefreshInbox({
      visible: document.visibilityState === "visible",
      refreshPending: refreshPendingRef.current,
    })) return
    startRefresh(() => router.refresh())
  }, [router])

  useEffect(() => {
    const interval = window.setInterval(refresh, inboxRefreshIntervalMs)
    return () => window.clearInterval(interval)
  }, [refresh])

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={refresh}
      disabled={refreshPending}
      title="Refresh canonical request state. Auto-refresh runs every 10 seconds while this tab is visible."
    >
      <RefreshCw className={cn(refreshPending && "animate-spin")} aria-hidden="true" />
      {refreshPending ? "Refreshing" : "Refresh"}
    </Button>
  )
}
