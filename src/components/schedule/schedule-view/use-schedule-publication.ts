"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  moveScheduleToDraft,
  publishSchedule,
  treatScheduleAsNeverPublished,
  type SchedulePublicationStatus,
} from "@/app/actions/schedule-publications"

export interface SchedulePublicationState {
  readonly publicationStatus: SchedulePublicationStatus | null
  readonly publishOpen: boolean
  readonly setPublishOpen: (open: boolean) => void
  readonly moveToDraftOpen: boolean
  readonly setMoveToDraftOpen: (open: boolean) => void
  readonly publishReason: string
  readonly setPublishReason: (reason: string) => void
  readonly isPublishing: boolean
  readonly isMovingToDraft: boolean
  readonly handlePublish: () => void
  readonly handleMoveToDraft: () => void
  readonly neverPublishedOpen: boolean
  readonly setNeverPublishedOpen: (open: boolean) => void
  readonly isTreatingAsNeverPublished: boolean
  readonly handleTreatAsNeverPublished: () => void
}

/**
 * Publishing the schedule to owners and subs, moving it back to draft, or
 * treating a draft as never published.
 */
export function useSchedulePublication(
  projectId: string | null,
  initialPublicationStatus: SchedulePublicationStatus | null
): SchedulePublicationState {
  const router = useRouter()
  const [publicationStatus, setPublicationStatus] =
    useState<SchedulePublicationStatus | null>(initialPublicationStatus)
  const [publishOpen, setPublishOpen] = useState(false)
  const [moveToDraftOpen, setMoveToDraftOpen] = useState(false)
  const [publishReason, setPublishReason] = useState("")
  const [isPublishing, startPublishTransition] = useTransition()
  const [isMovingToDraft, startMoveToDraftTransition] = useTransition()
  const [neverPublishedOpen, setNeverPublishedOpen] = useState(false)
  const [isTreatingAsNeverPublished, startNeverPublishedTransition] = useTransition()

  useEffect(() => {
    setPublicationStatus(initialPublicationStatus)
  }, [initialPublicationStatus])

  function handlePublish(): void {
    if (!projectId) return
    const hadPublication = publicationStatus?.publishedAt != null
    startPublishTransition(async () => {
      const result = await publishSchedule(projectId, hadPublication ? publishReason : "")
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setPublicationStatus({
        hasPublishedSchedule: true,
        hasUnpublishedChanges: false,
        publishedAt: result.publishedAt,
        publishedBy: null,
        changeReason: hadPublication ? publishReason.trim() : "Initial publication.",
        shiftReasonRequired: true,
      })
      setPublishReason("")
      setPublishOpen(false)
      toast.success("Schedule published to owner and subcontractor views.")
      router.refresh()
    })
  }

  function handleMoveToDraft(): void {
    if (!projectId) return
    startMoveToDraftTransition(async () => {
      const result = await moveScheduleToDraft(projectId)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setPublicationStatus((current) =>
        current ? { ...current, hasPublishedSchedule: false } : current
      )
      setMoveToDraftOpen(false)
      toast.success("Schedule moved to draft and hidden from owners and subcontractors.")
      router.refresh()
    })
  }

  function handleTreatAsNeverPublished(): void {
    if (!projectId) return
    startNeverPublishedTransition(async () => {
      const result = await treatScheduleAsNeverPublished(projectId)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setPublicationStatus((current) =>
        current
          ? {
              ...current,
              publishedAt: null,
              publishedBy: null,
              changeReason: null,
              shiftReasonRequired: false,
            }
          : current
      )
      setNeverPublishedOpen(false)
      toast.success("Schedule treated as never published. Edits no longer need a reason.")
      router.refresh()
    })
  }

  return {
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
    neverPublishedOpen,
    setNeverPublishedOpen,
    isTreatingAsNeverPublished,
    handleTreatAsNeverPublished,
  }
}
