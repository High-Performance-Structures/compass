"use client"

import { useEffect, useState, type Dispatch, type SetStateAction } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import type { TaskFilters } from "@/lib/schedule/types"
import {
  isScheduleOrderMode,
  scheduleOrderStorageKey,
  type ScheduleOrderMode,
} from "@/lib/schedule/task-ordering"
import type {
  SavedScheduleViewData,
  ScheduleGroupMode,
  ScheduleListColumn,
  ScheduleViewDefinition,
  ScheduleViewPreset,
} from "@/lib/schedule/saved-views"
import {
  requestedScheduleSettings,
  scheduleQueryString,
  type View,
} from "./schedule-view-rules"

export interface ScheduleViewState {
  readonly view: View
  readonly setView: (view: View) => void
  readonly orderMode: ScheduleOrderMode
  readonly handleOrderModeChange: (value: string) => void
  readonly filters: TaskFilters
  readonly setFilters: (filters: TaskFilters) => void
  readonly preset: ScheduleViewPreset
  readonly setPreset: (preset: ScheduleViewPreset) => void
  readonly conflictsOnly: boolean
  readonly setConflictsOnly: (conflictsOnly: boolean) => void
  readonly groupMode: ScheduleGroupMode
  readonly setGroupMode: (groupMode: ScheduleGroupMode) => void
  readonly visibleColumns: readonly ScheduleListColumn[]
  readonly setVisibleColumns: Dispatch<SetStateAction<readonly ScheduleListColumn[]>>
  readonly currentViewDefinition: () => ScheduleViewDefinition
  readonly applySavedView: (savedView: SavedScheduleViewData) => void
}

/**
 * View, ordering, filters, preset, grouping and columns. Starts from the URL,
 * keeps the URL in step, and remembers the ordering per schedule.
 */
export function useScheduleViewState(
  initialView: View,
  preferenceScopeKey: string
): ScheduleViewState {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const requested = requestedScheduleSettings(searchParams)
  const [view, setView] = useState<View>(initialView)
  const [orderMode, setOrderMode] =
    useState<ScheduleOrderMode>(() => {
      const requestedOrder = searchParams.get("order")
      return isScheduleOrderMode(requestedOrder)
        ? requestedOrder
        : "chronological"
    })
  const [filters, setFilters] = useState<TaskFilters>(() => ({
    status: requested.statuses,
    phase: (searchParams.get("phase") ?? "").split(",").filter(Boolean),
    assignedTo: searchParams.get("assignee") ?? "",
    search: searchParams.get("q") ?? "",
  }))
  const [preset, setPreset] = useState<ScheduleViewPreset>(requested.preset)
  const [conflictsOnly, setConflictsOnly] = useState(searchParams.get("conflicts") === "1")
  const [groupMode, setGroupMode] =
    useState<ScheduleGroupMode>(requested.group)
  const [visibleColumns, setVisibleColumns] =
    useState<readonly ScheduleListColumn[]>(requested.columns)

  useEffect(() => {
    const requestedOrder = searchParams.get("order")
    if (isScheduleOrderMode(requestedOrder)) {
      setOrderMode(requestedOrder)
      return
    }
    const storedMode = window.localStorage.getItem(
      scheduleOrderStorageKey(preferenceScopeKey)
    )
    setOrderMode(
      isScheduleOrderMode(storedMode) ? storedMode : "chronological"
    )
  }, [preferenceScopeKey, searchParams])

  useEffect(() => {
    const currentQuery = searchParams.toString()
    const nextQuery = scheduleQueryString(currentQuery, {
      view,
      orderMode,
      filters,
      preset,
      groupMode,
      conflictsOnly,
      visibleColumns,
    })
    if (nextQuery !== currentQuery) {
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, {
        scroll: false,
      })
    }
  }, [
    conflictsOnly,
    filters,
    groupMode,
    orderMode,
    pathname,
    preset,
    router,
    searchParams,
    view,
    visibleColumns,
  ])

  const handleOrderModeChange = (value: string): void => {
    if (!isScheduleOrderMode(value)) return
    setOrderMode(value)
    window.localStorage.setItem(
      scheduleOrderStorageKey(preferenceScopeKey),
      value
    )
  }

  const currentViewDefinition = (): ScheduleViewDefinition => ({
    view,
    orderMode,
    groupMode,
    preset,
    status: [...filters.status],
    phase: [...filters.phase],
    assignedTo: filters.assignedTo,
    search: filters.search,
    columns: [...visibleColumns],
  })

  const applySavedView = (savedView: SavedScheduleViewData): void => {
    const definition = savedView.definition
    setView(definition.view)
    setOrderMode(definition.orderMode)
    setGroupMode(definition.groupMode)
    setPreset(definition.preset)
    setFilters({
      status: definition.status,
      phase: definition.phase,
      assignedTo: definition.assignedTo,
      search: definition.search,
    })
    setVisibleColumns(definition.columns)
    toast.success(`Applied “${savedView.name}”.`)
  }

  return {
    view,
    setView,
    orderMode,
    handleOrderModeChange,
    filters,
    setFilters,
    preset,
    setPreset,
    conflictsOnly,
    setConflictsOnly,
    groupMode,
    setGroupMode,
    visibleColumns,
    setVisibleColumns,
    currentViewDefinition,
    applySavedView,
  }
}
