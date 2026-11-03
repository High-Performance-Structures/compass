"use client"

import {
  useCallback,
  useEffect,
  useRef,
  type RefObject,
  type UIEvent,
} from "react"
import { format } from "date-fns"
import type { DisplayItem } from "@/lib/schedule/gantt-transform"
import type { ScheduleTaskData } from "@/lib/schedule/types"
import {
  centeredGanttRowScrollTop,
  nearestScheduleRowIndexForDate,
  persistGanttScrollPosition,
  revealBarScrollLeft,
  scheduleScrollStorageKey,
  shouldRestoreGanttScroll,
  synchronizedScrollTop,
} from "@/lib/schedule/gantt-scroll"
import type { GanttScrollPosition } from "../gantt-chart"
import { matchGanttPaneHeights } from "./gantt-pane-heights"
import { useTaskListWheel } from "./use-task-list-wheel"
import {
  displayItemDateRanges,
  localIsoDate,
  storedGanttScrollPosition,
} from "./gantt-view-rules"

export interface GanttScrollSync {
  readonly taskListRef: RefObject<HTMLDivElement | null>
  readonly handleGanttContainerReady: (container: HTMLElement | null) => void
  readonly handleGanttScroll: (position: GanttScrollPosition) => void
  readonly handleTaskListScroll: (event: UIEvent<HTMLDivElement>) => void
  readonly focusTaskOnTimeline: (task: ScheduleTaskData) => void
  readonly handleTodayScrollReady: (handler: (() => void) | null) => void
  readonly handleDateScrollReady: (handler: ((date: string) => void) | null) => void
  readonly scrollToToday: () => void
}

/**
 * Keeps the item list and the chart scrolled together, remembers the chart
 * position per schedule, and moves to today or to a selected item.
 */
export function useGanttScrollSync({
  projectId,
  isMobile,
  displayItems,
  setFocusedTaskId,
}: {
  readonly projectId: string | null
  readonly isMobile: boolean
  readonly displayItems: readonly DisplayItem[]
  readonly setFocusedTaskId: (taskId: string | null) => void
}): GanttScrollSync {
  const taskListRef = useRef<HTMLDivElement>(null)
  const ganttContainerRef = useRef<HTMLElement | null>(null)
  const paneHeightCleanupRef = useRef<(() => void) | null>(null)
  useEffect(
    () => () => {
      paneHeightCleanupRef.current?.()
      paneHeightCleanupRef.current = null
    },
    []
  )
  const scrollPositionRef = useRef<GanttScrollPosition>({ left: 0, top: 0 })
  const scrollToTodayRef = useRef<(() => void) | null>(null)
  const scrollToDateRef = useRef<((date: string) => void) | null>(null)
  const scrollRestoredProjectRef = useRef<string | null | undefined>(undefined)
  // The chart can rebuild once while loading; keep opening on today until then.
  const openAtTodayUntilRef = useRef(0)
  // The list and chart mirror each other's vertical scroll. Each side ignores
  // the scroll event caused by its own mirroring so they cannot fight.
  const mirroredListTopRef = useRef<number | null>(null)
  const mirroredGanttTopRef = useRef<number | null>(null)
  const markMirrored = useCallback(
    (ref: { current: number | null }, top: number): void => {
      ref.current = top
      // Scroll events dispatch before animation frames, so after two frames the
      // echo has arrived. Clear the marker even if no echo came (clamped edge).
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (ref.current === top) ref.current = null
        })
      )
    },
    []
  )
  const scrollStorageKey = scheduleScrollStorageKey(projectId)

  const rememberScrollPosition = useCallback(
    (position: GanttScrollPosition) => {
      scrollPositionRef.current = position
      persistGanttScrollPosition(
        () => window.sessionStorage,
        scrollStorageKey,
        position
      )
    },
    [scrollStorageKey]
  )

  useTaskListWheel(taskListRef, ganttContainerRef, isMobile)

  const handleGanttContainerReady = useCallback(
    (container: HTMLElement | null) => {
      ganttContainerRef.current = container
      paneHeightCleanupRef.current?.()
      paneHeightCleanupRef.current = null
      if (!container) return
      if (taskListRef.current) {
        paneHeightCleanupRef.current = matchGanttPaneHeights(
          taskListRef.current,
          container
        )
      }

      let position = scrollPositionRef.current
      let restoredFromStorage = false
      if (shouldRestoreGanttScroll(projectId, scrollRestoredProjectRef.current)) {
        try {
          const stored = window.sessionStorage.getItem(scrollStorageKey)
          if (stored) {
            const parsed = storedGanttScrollPosition(JSON.parse(stored))
            if (parsed) {
              position = parsed
              restoredFromStorage = true
            }
          }
        } catch {
          // Use the current in-memory position.
        }
        scrollRestoredProjectRef.current = projectId
      }

      scrollPositionRef.current = position
      // Nothing remembered yet: open on today instead of the portfolio's
      // earliest task (which could be years back).
      const remembered =
        position.anchorDate !== undefined || position.left !== 0 || position.top !== 0
      if (!remembered) openAtTodayUntilRef.current = performance.now() + 3000
      const openAtToday = !remembered || performance.now() < openAtTodayUntilRef.current
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          // Persisted numeric positions must be restored directly. Recomputing
          // from an anchor date can clamp to zero in mobile WebKit while the
          // Gantt content is still laying out, losing the saved viewport.
          if (!restoredFromStorage && openAtToday && scrollToDateRef.current) {
            scrollToDateRef.current(localIsoDate(new Date()))
          } else {
            container.scrollLeft = position.left
          }
          container.scrollTop = position.top
          if (taskListRef.current) {
            taskListRef.current.scrollTop = synchronizedScrollTop(
              position.top,
              taskListRef.current.scrollHeight,
              taskListRef.current.clientHeight
            )
          }
        })
      })
    },
    [projectId, scrollStorageKey]
  )

  const handleGanttScroll = useCallback(
    (position: GanttScrollPosition) => {
      const taskList = taskListRef.current
      const ganttContainer = ganttContainerRef.current
      if (taskList && ganttContainer) {
        const synchronizedTop = synchronizedScrollTop(
          position.top,
          taskList.scrollHeight,
          taskList.clientHeight
        )
        if (mirroredGanttTopRef.current !== null) {
          // This scroll was our own mirroring from the list; don't echo it back.
          mirroredGanttTopRef.current = null
        } else if (Math.abs(taskList.scrollTop - synchronizedTop) > 1) {
          markMirrored(mirroredListTopRef, synchronizedTop)
          taskList.scrollTop = synchronizedTop
        }
      }
      rememberScrollPosition(position)
    },
    [markMirrored, rememberScrollPosition]
  )

  const handleTaskListScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const top = event.currentTarget.scrollTop
      const ganttContainer = ganttContainerRef.current
      if (ganttContainer) {
        const synchronizedTop = synchronizedScrollTop(
          top,
          ganttContainer.scrollHeight,
          ganttContainer.clientHeight
        )
        if (mirroredListTopRef.current !== null) {
          mirroredListTopRef.current = null
        } else if (Math.abs(ganttContainer.scrollTop - synchronizedTop) > 1) {
          markMirrored(mirroredGanttTopRef, synchronizedTop)
          ganttContainer.scrollTop = synchronizedTop
        }
      }
      rememberScrollPosition({
        left: ganttContainer?.scrollLeft ?? scrollPositionRef.current.left,
        top: ganttContainer?.scrollTop ?? top,
        ...(scrollPositionRef.current.anchorDate
          ? { anchorDate: scrollPositionRef.current.anchorDate }
          : {}),
      })
    },
    [markMirrored, rememberScrollPosition]
  )

  // Selecting a row highlights its bar and, only if the bar is off-screen,
  // slides the timeline sideways. The row is already level with its bar
  // (vertical scroll is mirrored), so nothing moves vertically and repeated
  // clicks on the same row are stable.
  const focusTaskOnTimeline = useCallback((task: ScheduleTaskData) => {
    setFocusedTaskId(task.id)
    const container = ganttContainerRef.current
    const bar = container?.querySelector<SVGRectElement>(
      `.bar-wrapper[data-id="${CSS.escape(task.id)}"] .bar`
    )
    if (!container || !bar) return
    const left = revealBarScrollLeft({
      barLeft: Number(bar.getAttribute("x") ?? 0),
      barWidth: Number(bar.getAttribute("width") ?? 0),
      scrollLeft: container.scrollLeft,
      clientWidth: container.clientWidth,
      scrollWidth: container.scrollWidth,
    })
    if (left !== null) container.scrollTo({ left, behavior: "smooth" })
  }, [setFocusedTaskId])

  const handleTodayScrollReady = useCallback(
    (handler: (() => void) | null) => {
      scrollToTodayRef.current = handler
    },
    []
  )

  const handleDateScrollReady = useCallback(
    (handler: ((date: string) => void) | null) => {
      scrollToDateRef.current = handler
    },
    []
  )

  const scrollToToday = useCallback(() => {
    const ganttContainer = ganttContainerRef.current
    if (!ganttContainer) {
      scrollToTodayRef.current?.()
      return
    }
    const today = format(new Date(), "yyyy-MM-dd")
    const rowIndex = nearestScheduleRowIndexForDate(
      displayItemDateRanges(displayItems),
      today
    )
    if (rowIndex === null) {
      scrollToTodayRef.current?.()
      return
    }

    const ganttTop = centeredGanttRowScrollTop({
      rowIndex,
      clientHeight: ganttContainer.clientHeight,
      scrollHeight: ganttContainer.scrollHeight,
    })
    ganttContainer.scrollTop = ganttTop

    const taskList = taskListRef.current
    if (taskList) {
      const listTop = synchronizedScrollTop(
        ganttTop,
        taskList.scrollHeight,
        taskList.clientHeight
      )
      // Mark this as mirroring so the list's scroll echo does not reset the
      // chart and cancel the smooth horizontal move to today.
      markMirrored(mirroredListTopRef, listTop)
      taskList.scrollTop = listTop
    }

    const targetItem = displayItems[rowIndex]
    if (targetItem?.type === "task") {
      setFocusedTaskId(targetItem.task.id)
    }

    // Start the smooth horizontal movement last. Assigning scrollTop after
    // scrollTo({ behavior: "smooth" }) cancels that animation in browsers.
    scrollToTodayRef.current?.()
  }, [displayItems, markMirrored, setFocusedTaskId])

  return {
    taskListRef,
    handleGanttContainerReady,
    handleGanttScroll,
    handleTaskListScroll,
    focusTaskOnTimeline,
    handleTodayScrollReady,
    handleDateScrollReady,
    scrollToToday,
  }
}
