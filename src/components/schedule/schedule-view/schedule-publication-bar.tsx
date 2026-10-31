"use client"

import { Button } from "@/components/ui/button"
import { IconSend, IconEyeOff } from "@tabler/icons-react"
import type { SchedulePublicationStatus } from "@/app/actions/schedule-publications"

/** Published or draft state, with Publish and Move to draft for managers. */
export function SchedulePublicationBar({
  publicationStatus,
  canManagePublication,
  setPublishOpen,
  setMoveToDraftOpen,
}: {
  readonly publicationStatus: SchedulePublicationStatus
  readonly canManagePublication: boolean
  readonly setPublishOpen: (open: boolean) => void
  readonly setMoveToDraftOpen: (open: boolean) => void
}) {
  return (
    <div
      className="mb-1 flex h-8 shrink-0 min-w-0 flex-nowrap items-center gap-2 overflow-x-auto text-xs print:hidden"
      data-schedule-publication-controls
    >
      <span className="shrink-0 text-muted-foreground">
        {publicationStatus.hasPublishedSchedule
          ? `Published ${new Date(
              publicationStatus.publishedAt ?? ""
            ).toLocaleString()}`
          : publicationStatus.publishedAt
            ? "Draft · Hidden from owners and subcontractors"
            : "Draft · Never published"}
      </span>
      {!publicationStatus.hasPublishedSchedule && publicationStatus.publishedAt && (
        <span className="shrink-0 text-muted-foreground">
          Last published {new Date(publicationStatus.publishedAt).toLocaleString()}
        </span>
      )}
      {publicationStatus.hasPublishedSchedule && publicationStatus.hasUnpublishedChanges && (
        <span className="shrink-0 text-warning">
          Draft changes are hidden; viewers still see the published version
        </span>
      )}
      {canManagePublication && publicationStatus.hasPublishedSchedule && (
        <Button
          className="ml-auto h-7 shrink-0 px-2 text-xs"
          size="sm"
          variant="outline"
          onClick={() => setMoveToDraftOpen(true)}
        >
          <IconEyeOff className="mr-1 size-3.5" />
          Move to draft
        </Button>
      )}
      {canManagePublication && (!publicationStatus.hasPublishedSchedule || publicationStatus.hasUnpublishedChanges) && (
        <Button
          className={publicationStatus.hasPublishedSchedule ? "h-7 shrink-0 px-2 text-xs" : "ml-auto h-7 shrink-0 px-2 text-xs"}
          size="sm"
          onClick={() => setPublishOpen(true)}
        >
          <IconSend className="mr-1 size-3.5" />
          {publicationStatus.hasPublishedSchedule ? "Publish changes" : "Publish schedule"}
        </Button>
      )}
    </div>
  )
}
