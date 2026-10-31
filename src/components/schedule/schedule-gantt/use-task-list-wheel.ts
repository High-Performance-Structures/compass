"use client"

import { useEffect, type RefObject } from "react"
import {
  canScrollGanttAxis,
  ganttWheelIntent,
  normalizeWheelDelta,
} from "@/lib/schedule/gantt-scroll"

/** Wheel and trackpad scrolling over the item list beside the chart. */
export function useTaskListWheel(
  taskListRef: RefObject<HTMLDivElement | null>,
  ganttContainerRef: RefObject<HTMLElement | null>,
  isMobile: boolean
): void {
  useEffect(() => {
    const taskList = taskListRef.current
    if (!taskList) return

    // The resizable layout can consume trackpad wheel gestures before the
    // browser applies its default nested-scroll behavior. Own the gesture on
    // the task pane just as the timeline does so either side remains usable.
    const handleTaskListWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return
      const intent = ganttWheelIntent(
        event.deltaX,
        event.deltaY,
        event.shiftKey
      )
      if (!intent) return
      const target =
        intent.axis === "horizontal" ? ganttContainerRef.current : taskList
      if (!target) return
      const pageSize =
        intent.axis === "vertical" ? target.clientHeight : target.clientWidth
      const delta = normalizeWheelDelta(
        intent.delta,
        event.deltaMode,
        pageSize
      )
      const canScroll =
        intent.axis === "vertical"
          ? canScrollGanttAxis(
              target.scrollTop,
              target.scrollHeight,
              target.clientHeight,
              delta
            )
          : canScrollGanttAxis(
              target.scrollLeft,
              target.scrollWidth,
              target.clientWidth,
              delta
            )
      if (!canScroll) {
        const workspace = taskList.closest<HTMLElement>(
          '[data-dashboard-scroll-region="schedule"]'
        )
        if (
          intent.axis === "vertical" &&
          workspace &&
          canScrollGanttAxis(
            workspace.scrollTop,
            workspace.scrollHeight,
            workspace.clientHeight,
            delta
          )
        ) {
          event.preventDefault()
          workspace.scrollTop += delta
        }
        return
      }

      event.preventDefault()
      if (intent.axis === "vertical") target.scrollTop += delta
      else target.scrollLeft += delta
    }

    taskList.addEventListener("wheel", handleTaskListWheel, {
      passive: false,
    })
    return () => taskList.removeEventListener("wheel", handleTaskListWheel)
  }, [ganttContainerRef, isMobile, taskListRef])
}
