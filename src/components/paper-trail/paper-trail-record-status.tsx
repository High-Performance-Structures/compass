"use client"

import * as React from "react"
import { IconBrandGoogleDrive, IconExternalLink } from "@tabler/icons-react"
import { toast } from "sonner"
import {
  requestPaperTrailSave,
  resolvePaperTrailDuplicate,
  type PaperTrailDuplicateChoice,
  type PaperTrailRecordView,
} from "@/app/actions/paper-trail"
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

  function choose(choice: PaperTrailDuplicateChoice): void {
    startTransition(async () => {
      const result = await resolvePaperTrailDuplicate(projectId, recordType, recordId, choice)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setQueued(choice !== "keep_existing")
      toast.success(
        choice === "keep_existing"
          ? "Keeping the existing file; Compass won't save this record"
          : choice === "replace"
            ? "Compass will update the existing file within a minute"
            : "Saving Compass's copy beside the existing file",
      )
    })
  }

  if (record?.status === "needs_choice" && !queued) {
    return (
      <div className={cn("grid gap-1.5 text-xs", className)}>
        <span className="inline-flex flex-wrap items-center gap-1.5 text-warning">
          <IconBrandGoogleDrive className="size-3.5 shrink-0" aria-hidden="true" />
          This record is already in Drive
          {record.existingFile ? (
            <a href={record.existingFile.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
              {record.existingFile.name}
            </a>
          ) : null}
          , so Compass hasn&apos;t saved a copy.
        </span>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={pending} onClick={() => choose("replace")}>
            Replace with Compass copy
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={pending} onClick={() => choose("keep_both")}>
            Keep both
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" disabled={pending} onClick={() => choose("keep_existing")}>
            Keep existing only
          </Button>
        </div>
      </div>
    )
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
  } else if (record.status === "kept_existing") {
    message = `Using the file already in Drive${record.existingFile ? ` (${record.existingFile.name})` : ""}; Compass doesn't save this record`
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
      {record?.status !== "removed" && record?.status !== "kept_existing" ? (
        <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" disabled={pending || queued} onClick={saveNow}>
          Save to Drive now
        </Button>
      ) : null}
    </div>
  )
}
