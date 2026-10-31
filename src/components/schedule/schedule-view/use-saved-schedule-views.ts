"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import {
  deleteScheduleView,
  saveScheduleView,
} from "@/app/actions/schedule-saved-views"
import type {
  SavedScheduleViewData,
  ScheduleViewDefinition,
} from "@/lib/schedule/saved-views"

export interface SavedScheduleViewsState {
  readonly savedViews: readonly SavedScheduleViewData[]
  readonly saveViewOpen: boolean
  readonly setSaveViewOpen: (open: boolean) => void
  readonly saveViewName: string
  readonly setSaveViewName: (name: string) => void
  readonly saveViewShared: boolean
  readonly setSaveViewShared: (shared: boolean) => void
  readonly isSavingView: boolean
  readonly handleSaveView: () => void
  readonly handleDeleteView: (savedView: SavedScheduleViewData) => void
}

/** Personal and shared saved views of the schedule. */
export function useSavedScheduleViews(
  initialSavedViews: readonly SavedScheduleViewData[],
  currentViewDefinition: () => ScheduleViewDefinition
): SavedScheduleViewsState {
  const [savedViews, setSavedViews] =
    useState<readonly SavedScheduleViewData[]>(initialSavedViews)
  const [saveViewOpen, setSaveViewOpen] = useState(false)
  const [saveViewName, setSaveViewName] = useState("")
  const [saveViewShared, setSaveViewShared] = useState(false)
  const [isSavingView, startSaveViewTransition] = useTransition()

  const handleSaveView = (): void => {
    const name = saveViewName.trim()
    if (!name) return
    startSaveViewTransition(async () => {
      const result = await saveScheduleView({
        name,
        visibility: saveViewShared ? "shared" : "personal",
        definition: currentViewDefinition(),
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setSavedViews((current) => [
        ...current.filter((savedView) => savedView.id !== result.view.id),
        result.view,
      ])
      setSaveViewOpen(false)
      setSaveViewName("")
      setSaveViewShared(false)
      toast.success(`Saved “${result.view.name}”.`)
    })
  }

  const handleDeleteView = (savedView: SavedScheduleViewData): void => {
    startSaveViewTransition(async () => {
      const result = await deleteScheduleView(savedView.id)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setSavedViews((current) =>
        current.filter((candidate) => candidate.id !== savedView.id)
      )
      toast.success(`Deleted “${savedView.name}”.`)
    })
  }

  return {
    savedViews,
    saveViewOpen,
    setSaveViewOpen,
    saveViewName,
    setSaveViewName,
    saveViewShared,
    setSaveViewShared,
    isSavingView,
    handleSaveView,
    handleDeleteView,
  }
}
