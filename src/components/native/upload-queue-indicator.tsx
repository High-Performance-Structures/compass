"use client"

import { CloudUpload, AlertCircle } from "lucide-react"
import { useNative } from "@/hooks/use-native"
import { cn } from "@/lib/utils"

type UploadQueueIndicatorProps = Readonly<{
  pendingCount: number
  status: "idle" | "uploading" | "done" | "error"
  onRetry?: () => void
}>

export function UploadQueueIndicator({
  pendingCount,
  status,
  onRetry,
}: UploadQueueIndicatorProps) {
  const native = useNative()

  if (!native || (pendingCount === 0 && status !== "error")) {
    return null
  }

  return (
    <button
      type="button"
      onClick={status === "error" ? onRetry : undefined}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
        status === "error"
          ? "bg-destructive/10 text-destructive hover:bg-destructive/20"
          : status === "uploading"
            ? "bg-primary/10 text-primary animate-pulse"
            : "bg-muted text-muted-foreground",
      )}
    >
      {status === "error" ? (
        <AlertCircle className="h-3 w-3" />
      ) : (
        <CloudUpload className="h-3 w-3" />
      )}
      {status === "error"
        ? `${pendingCount} failed - tap to retry`
        : status === "uploading"
          ? `Uploading ${pendingCount}...`
          : `${pendingCount} pending`}
    </button>
  )
}
