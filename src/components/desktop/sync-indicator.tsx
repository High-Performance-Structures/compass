"use client"

import { useCallback } from "react"
import { RefreshCw, Check, AlertCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { useDesktop } from "@/hooks/use-desktop"
import {
  useSyncStatus,
  useTriggerSync,
  type SyncStatus,
} from "@/hooks/use-sync-status"
import { Button } from "@/components/ui/button"
import { useDeveloperMode } from "@/components/developer-mode-provider"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

function getStatusIcon(status: SyncStatus) {
  switch (status) {
    case "syncing":
      return <RefreshCw className="h-3.5 w-3.5 animate-spin" />
    case "error":
      return <AlertCircle className="h-3.5 w-3.5 text-destructive" />
    case "offline":
      return <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
    case "idle":
    default:
      return <Check className="h-3.5 w-3.5" />
  }
}

function getStatusText(status: SyncStatus, pendingCount: number): string {
  switch (status) {
    case "syncing":
      return "Syncing..."
    case "error":
      return "Sync error"
    case "offline":
      return `Offline (${pendingCount} pending)`
    case "idle":
    default:
      if (pendingCount > 0) {
        return `${pendingCount} pending`
      }
      return "Synced"
  }
}

interface SyncIndicatorProps {
  readonly className?: string
  readonly showLabel?: boolean
}

// Small badge showing sync status. Only visible on desktop.
export function SyncIndicator({
  className,
  showLabel = true,
}: SyncIndicatorProps) {
  const { developerModeEnabled } = useDeveloperMode()
  const isDesktop = useDesktop()
  const { status, pendingCount, lastSyncTime } = useSyncStatus()
  const triggerSync = useTriggerSync()

  const handleClick = useCallback(() => {
    if (status !== "syncing") {
      triggerSync()
    }
  }, [status, triggerSync])

  // Don't render on non-desktop
  if (!isDesktop) return null

  if (!developerModeEnabled) {
    if (status === "idle" && pendingCount === 0) return null

    const workerLabel =
      status === "offline"
        ? "Offline — changes saved"
        : status === "error"
          ? "Unable to send changes"
          : "Changes waiting to send"

    return (
      <div
        className={cn(
          "flex h-7 items-center gap-1.5 px-2 text-xs text-muted-foreground",
          status === "error" && "text-destructive",
          status === "offline" && "text-amber-500",
          className
        )}
        role="status"
      >
        {getStatusIcon(status)}
        {showLabel && <span>{workerLabel}</span>}
      </div>
    )
  }

  const lastSyncText = lastSyncTime
    ? `Last sync: ${new Date(lastSyncTime).toLocaleTimeString()}`
    : "Not yet synced"

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-7 gap-1.5 px-2 text-xs",
              status === "error" && "text-destructive",
              status === "offline" && "text-amber-500",
              className,
            )}
            onClick={handleClick}
            disabled={status === "syncing"}
          >
            {getStatusIcon(status)}
            {showLabel && (
              <span className="max-w-[80px] truncate">
                {getStatusText(status, pendingCount)}
              </span>
            )}
            {pendingCount > 0 && status !== "syncing" && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
                {pendingCount > 99 ? "99+" : pendingCount}
              </span>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          <p>{getStatusText(status, pendingCount)}</p>
          <p className="text-muted-foreground">{lastSyncText}</p>
          <p className="mt-1 text-muted-foreground">
            Click to sync now
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

// Minimal version for compact headers
export function SyncIndicatorCompact({ className }: { className?: string }) {
  return <SyncIndicator className={className} showLabel={false} />
}
