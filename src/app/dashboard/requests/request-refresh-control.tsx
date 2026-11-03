"use client"

import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { IconRefresh } from "@tabler/icons-react"

import {
  refreshMyFeedbackRequests,
  type FeedbackRequestScope,
} from "@/app/actions/feedback-requests"
import { Button } from "@/components/ui/button"
import { useVisibleInterval } from "@/hooks/use-visible-interval"
import { cn } from "@/lib/utils"

const REFRESH_INTERVAL_MILLISECONDS = 60_000

export function RequestRefreshControl({
  scope = "mine",
}: Readonly<{ scope?: FeedbackRequestScope }>) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null)
  const lastRefreshStartedAt = useRef(0)

  const refresh = useCallback(() => {
    const now = Date.now()
    if (now - lastRefreshStartedAt.current < 5_000) return
    lastRefreshStartedAt.current = now
    startTransition(async () => {
      const result = await refreshMyFeedbackRequests(scope)
      if (result.success) {
        setLastCheckedAt(new Date(result.checkedAt))
        router.refresh()
      }
    })
  }, [router, scope])

  // A new scope checks right away; the shared poll covers every minute after,
  // focus, and a return to a tab that missed a check.
  useEffect(() => {
    refresh()
  }, [refresh])
  useVisibleInterval(refresh, REFRESH_INTERVAL_MILLISECONDS, {
    immediate: false,
    refreshOnFocus: true,
  })

  return (
    <div className="flex items-center gap-3">
      <p className="hidden text-xs text-muted-foreground sm:block">
        {lastCheckedAt
          ? `Checked ${lastCheckedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
          : "Updates every minute"}
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={refresh}
        disabled={isPending}
      >
        <IconRefresh className={cn("size-4", isPending && "animate-spin")} />
        {isPending ? "Checking" : "Refresh status"}
      </Button>
    </div>
  )
}
