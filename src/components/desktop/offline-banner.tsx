"use client"

import { useState, useEffect, useCallback } from "react"
import { WifiOff, RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"
import { useDesktop } from "@/hooks/use-desktop"
import { useSyncStatus, useTriggerSync } from "@/hooks/use-sync-status"
import { Button } from "@/components/ui/button"

interface OfflineBannerProps {
  readonly className?: string
}

// Desktop-specific offline banner that shows pending mutation count.
// Different from the native offline banner which uses Capacitor Network.
export function DesktopOfflineBanner({ className }: OfflineBannerProps) {
  const isDesktop = useDesktop()
  const { status, pendingCount } = useSyncStatus()
  const triggerSync = useTriggerSync()
  const [dismissed, setDismissed] = useState(false)

  const handleRetry = useCallback(() => {
    triggerSync()
  }, [triggerSync])

  const handleDismiss = useCallback(() => {
    setDismissed(true)
  }, [])

  // Reset dismissed state when coming back online
  useEffect(() => {
    if (status !== "offline") {
      setDismissed(false)
    }
  }, [status])

  // Don't render on non-desktop or when online
  if (!isDesktop || status !== "offline") return null

  // Don't show if dismissed and no new pending items
  if (dismissed && pendingCount === 0) return null

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 bg-amber-500/90 px-4 py-2 text-sm font-medium text-white dark:bg-amber-600/90",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <WifiOff className="h-4 w-4 shrink-0" />
        <span>
          You&apos;re offline.
          {pendingCount > 0 && (
            <span className="ml-1">
              {pendingCount} change{pendingCount !== 1 ? "s" : ""} queued for
              sync.
            </span>
          )}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          className="h-7 bg-white/20 text-white hover:bg-white/30"
          onClick={handleRetry}
        >
          <RefreshCw className="mr-1 h-3 w-3" />
          Retry
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-white/80 hover:bg-white/20 hover:text-white"
          onClick={handleDismiss}
        >
          Dismiss
        </Button>
      </div>
    </div>
  )
}

// Minimal version showing just a status bar
export function OfflineStatusBar({ className }: OfflineBannerProps) {
  const isDesktop = useDesktop()
  const { status, pendingCount } = useSyncStatus()

  if (!isDesktop || status !== "offline") return null

  return (
    <div
      className={cn(
        "flex items-center justify-center gap-1.5 bg-amber-500/80 px-2 py-0.5 text-xs font-medium text-white",
        className,
      )}
    >
      <WifiOff className="h-3 w-3" />
      <span>Offline</span>
      {pendingCount > 0 && (
        <span className="ml-1 rounded-full bg-white/20 px-1.5">
          {pendingCount}
        </span>
      )}
    </div>
  )
}
