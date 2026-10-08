"use client"

import type { ReactNode } from "react"
import { AlertTriangle, Info, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type CallNoticeAction =
  | "retry-audio"
  | "retry-video"
  | "retry-screen-share"
  | "alternate-microphone"
  | "unmute"

/** Errors stay until dismissed or replaced; info notices clear themselves. */
export type CallNotice = {
  readonly tone: "info" | "error"
  readonly text: string
  readonly action: CallNoticeAction | null
}

export const CALL_NOTICE_INFO_MS = 6_000

const ACTION_LABELS: Readonly<Record<CallNoticeAction, string>> = {
  "retry-audio": "Try again",
  "retry-video": "Try again",
  "retry-screen-share": "Try again",
  "alternate-microphone": "Try alternate microphone method",
  unmute: "Unmute",
}

export function TalkCallNotice({
  notice,
  onAction,
  onDismiss,
}: {
  readonly notice: CallNotice
  readonly onAction: (action: CallNoticeAction) => void
  readonly onDismiss: () => void
}): ReactNode {
  const isError = notice.tone === "error"
  const Icon = isError ? AlertTriangle : Info
  return (
    <div
      role={isError ? "alert" : "status"}
      className={cn(
        "flex w-full flex-wrap items-center gap-2 border-b px-3 py-2 text-sm",
        isError
          ? "border-destructive/40 bg-destructive/10 text-foreground"
          : "border-border bg-muted/40 text-muted-foreground"
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn("size-4 shrink-0", isError ? "text-destructive" : "")}
      />
      <span className="min-w-0 flex-1">{notice.text}</span>
      {notice.action ? (
        <Button
          type="button"
          size="sm"
          variant={isError ? "secondary" : "outline"}
          onClick={() => {
            if (notice.action) onAction(notice.action)
          }}
        >
          {ACTION_LABELS[notice.action]}
        </Button>
      ) : null}
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-7"
        aria-label="Dismiss message"
        onClick={onDismiss}
      >
        <X aria-hidden="true" />
      </Button>
    </div>
  )
}
