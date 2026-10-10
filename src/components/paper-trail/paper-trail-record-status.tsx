"use client"

import * as React from "react"
import { IconBrandGoogleDrive, IconExternalLink } from "@tabler/icons-react"
import { toast } from "sonner"
import { requestPaperTrailSave, type PaperTrailRecordView } from "@/app/actions/paper-trail"
import { Button } from "@/components/ui/button"
import type { PaperTrailRecordType } from "@/db/schema-paper-trail"
import { cn } from "@/lib/utils"

function savedTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return value
  const sameDay = date.toDateString() === new Date().toDateString()
  return new Intl.DateTimeFormat("en-US", sameDay ? { timeStyle: "short" } : { dateStyle: "medium", timeStyle: "short" }).format(date)
}

/**
 * One line under a record: where its Drive copy stands, a link to it, and
 * "Save now". Renders nothing when the paper trail is off for this project.
 */
export function PaperTrailRecordStatus({
  projectId,
  recordType,
  recordId,
  record,
  className,
}: {
  readonly projectId: string
  readonly recordType: PaperTrailRecordType
  readonly recordId: string
  readonly record: PaperTrailRecordView | null
  readonly className?: string
}): React.ReactElement {
  const [queued, setQueued] = React.useState(false)
  const [pending, startTransition] = React.useTransition()

  function saveNow(): void {
    startTransition(async () => {
      const result = await requestPaperTrailSave(projectId, recordType, recordId)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setQueued(true)
      toast.success("Saving to Drive within a minute")
    })
  }

  let message: string
  let tone: "muted" | "warning" | "destructive" = "muted"
  if (queued || !record || record.status === "pending") {
    message = record?.lastSyncedAt && !queued ? `Updating Drive copy (last saved ${savedTime(record.lastSyncedAt)})` : "Waiting to save to Drive"
  } else if (record.status === "failed") {
    message = `Not saved to Drive: ${record.error ?? "unknown error"}`
    tone = "destructive"
  } else if (record.status === "held_private") {
    message = `Saved to the private records folder ${record.lastSyncedAt ? savedTime(record.lastSyncedAt) : ""} because the usual folder is shared outside the company`
    tone = "warning"
  } else if (record.status === "removed") {
    message = "Deleted in Compass; the last Drive copy is kept"
  } else {
    message = `Saved to Drive ${record.lastSyncedAt ? savedTime(record.lastSyncedAt) : ""}`
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-xs", className)}>
      <span
        className={cn(
          "inline-flex items-center gap-1.5",
          tone === "muted" && "text-muted-foreground",
          tone === "warning" && "text-warning",
          tone === "destructive" && "text-destructive",
        )}
      >
        <IconBrandGoogleDrive className="size-3.5 shrink-0" aria-hidden="true" />
        {message.trim()}
      </span>
      {record?.driveUrl ? (
        <a
          href={record.driveUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Open copy <IconExternalLink className="size-3" aria-hidden="true" />
        </a>
      ) : null}
      {record?.status !== "removed" ? (
        <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" disabled={pending || queued} onClick={saveNow}>
          Save to Drive now
        </Button>
      ) : null}
    </div>
  )
}
