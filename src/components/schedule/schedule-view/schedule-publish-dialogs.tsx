"use client"

import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { IconLoader2 } from "@tabler/icons-react"
import type { SchedulePublicationState } from "./use-schedule-publication"

/** Publish-schedule and move-to-draft confirmations. */
export function SchedulePublishDialogs({
  publication,
}: {
  readonly publication: SchedulePublicationState
}) {
  const {
    publicationStatus,
    publishOpen,
    setPublishOpen,
    moveToDraftOpen,
    setMoveToDraftOpen,
    publishReason,
    setPublishReason,
    isPublishing,
    isMovingToDraft,
    handlePublish,
    handleMoveToDraft,
  } = publication
  return (
    <>
    <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {publicationStatus?.hasPublishedSchedule ? "Publish changes" : "Publish schedule"}
          </DialogTitle>
          <DialogDescription>
            Owners and subcontractors will see the current schedule and its
            selected visible items. Later edits stay internal until published again.
          </DialogDescription>
        </DialogHeader>
        {publicationStatus?.publishedAt && (
          <div className="space-y-2">
            <Label htmlFor="schedule-publish-reason">Change reason</Label>
            <Textarea
              id="schedule-publish-reason"
              value={publishReason}
              onChange={(event) => setPublishReason(event.currentTarget.value)}
              placeholder="Summarize what changed and why..."
              rows={4}
              maxLength={500}
            />
            <p className="text-xs text-muted-foreground">
              This reason appears in the internal activity history.
            </p>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => setPublishOpen(false)}
            disabled={isPublishing}
          >
            Cancel
          </Button>
          <Button
            onClick={handlePublish}
            disabled={
              isPublishing ||
              (Boolean(publicationStatus?.publishedAt) &&
                publishReason.trim().length < 3)
            }
          >
            {isPublishing && (
              <IconLoader2 className="mr-1.5 size-4 animate-spin" />
            )}
            Publish
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    <Dialog open={moveToDraftOpen} onOpenChange={setMoveToDraftOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Move schedule to draft?</DialogTitle>
          <DialogDescription>
            The schedule will disappear from owner and subcontractor workspaces
            immediately. Your internal schedule and publication history stay intact.
            You can publish the current schedule again when it is ready.
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setMoveToDraftOpen(false)} disabled={isMovingToDraft}>
            Cancel
          </Button>
          <Button onClick={handleMoveToDraft} disabled={isMovingToDraft}>
            {isMovingToDraft && <IconLoader2 className="mr-1.5 size-4 animate-spin" />}
            Move to draft
          </Button>
        </div>
      </DialogContent>
    </Dialog>
    </>
  )
}
