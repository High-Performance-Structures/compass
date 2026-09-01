"use client"

import { useRef, useEffect, useState, useCallback, type CSSProperties } from "react"
import type { FrappeTask } from "@/lib/schedule/gantt-transform"
import type { DisplayColorPalette } from "@/lib/schedule/appearance"
import { getScheduleItemClasses } from "@/lib/schedule/appearance"
import { isNonWorkday } from "@/lib/schedule/business-days"
import type { WorkdayExceptionData } from "@/lib/schedule/types"
import {
  dominantScrollAxis,
  clampGanttScrollOffset,
  canScrollGanttAxis,
  ganttWheelIntent,
  normalizeWheelDelta,
  paddingToIncludeDate,
  type GanttScrollAxis,
} from "@/lib/schedule/gantt-scroll"
import "./gantt.css"

type ViewMode = "Day" | "Week" | "Month" | "Year"

export interface GanttScrollPosition {
  readonly left: number
  readonly top: number
  readonly anchorDate?: string
}

function differenceInUnits(date: Date, start: Date, unit: string): number {
  if (unit === "month") {
    const yearDifference = date.getFullYear() - start.getFullYear()
    let monthDifference = date.getMonth() - start.getMonth()
    monthDifference += date.getDate() / 31
    if (date.getDate() < start.getDate()) monthDifference -= 1
    return yearDifference * 12 + monthDifference
  }

  const timezoneOffset = start.getTimezoneOffset() - date.getTimezoneOffset()
  const milliseconds = date.getTime() - start.getTime() + timezoneOffset * 60_000
  return milliseconds / 86_400_000
}

function addUnits(start: Date, amount: number, unit: string): Date {
  const date = new Date(start)
  if (unit === "month") {
    const wholeMonths = Math.trunc(amount)
    date.setMonth(date.getMonth() + wholeMonths)
    date.setTime(date.getTime() + (amount - wholeMonths) * 30 * 86_400_000)
    return date
  }
  date.setTime(date.getTime() + amount * 86_400_000)
  return date
}

function dateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function basePaddingDays(viewMode: ViewMode): number {
  if (viewMode === "Day") return 7
  if (viewMode === "Week") return 31
  if (viewMode === "Month") return 62
  return 183
}

function monthYearLabel(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  })
}

function monthYearAtBoundary(date: Date, previousDate: Date | null): string {
  return previousDate === null ||
    date.getMonth() !== previousDate.getMonth() ||
    date.getFullYear() !== previousDate.getFullYear()
    ? monthYearLabel(date)
    : ""
}

function weekLabel(date: Date, previousDate: Date | null): string {
  const end = new Date(date)
  end.setDate(end.getDate() + 6)
  const includeStartMonth =
    previousDate === null ||
    date.getMonth() !== previousDate.getMonth() ||
    date.getFullYear() !== previousDate.getFullYear()
  const includeEndMonth =
    end.getMonth() !== date.getMonth() ||
    end.getFullYear() !== date.getFullYear()
  const startLabel = includeStartMonth
    ? date.toLocaleDateString("en-US", { day: "numeric", month: "short" })
    : date.toLocaleDateString("en-US", { day: "numeric" })
  const endLabel = includeEndMonth
    ? end.toLocaleDateString("en-US", { day: "numeric", month: "short" })
    : end.toLocaleDateString("en-US", { day: "numeric" })
  return `${startLabel} - ${endLabel}`
}

const GANTT_VIEW_MODES = [
  {
    name: "Day",
    padding: "7d",
    date_format: "YYYY-MM-DD",
    step: "1d",
    lower_text: "D",
    upper_text: monthYearAtBoundary,
    thick_line: (date: Date) => date.getDay() === 1,
  },
  {
    name: "Week",
    padding: "1m",
    step: "7d",
    date_format: "YYYY-MM-DD",
    column_width: 140,
    lower_text: weekLabel,
    upper_text: monthYearAtBoundary,
    upper_text_frequency: 4,
    thick_line: (date: Date) => date.getDate() >= 1 && date.getDate() <= 7,
  },
  {
    name: "Month",
    padding: "2m",
    step: "1m",
    column_width: 120,
    date_format: "YYYY-MM",
    lower_text: monthYearLabel,
    upper_text: (date: Date, previousDate: Date | null) =>
      previousDate === null ||
      date.getFullYear() !== previousDate.getFullYear()
        ? date.getFullYear().toString()
        : "",
    thick_line: (date: Date) => date.getMonth() % 3 === 0,
    snap_at: "7d",
  },
  {
    name: "Year",
    padding: "6m",
    step: "3m",
    column_width: 160,
    date_format: "YYYY-MM",
    lower_text: (date: Date) => `Q${Math.floor(date.getMonth() / 3) + 1}`,
    upper_text: (date: Date, previousDate: Date | null) =>
      previousDate === null ||
      date.getFullYear() !== previousDate.getFullYear()
        ? date.getFullYear().toString()
        : "",
    thick_line: (date: Date) => date.getMonth() === 0,
    snap_at: "1m",
  },
]

interface GanttChartProps {
  tasks: FrappeTask[]
  exceptions?: readonly WorkdayExceptionData[]
  viewMode: ViewMode
  columnWidth?: number
  panMode?: boolean
  criticalPathMode?: boolean
  displayColorPalette?: DisplayColorPalette
  onDateChange?: (
    task: FrappeTask,
    start: Date,
    end: Date
  ) => void
  onProgressChange?: (task: FrappeTask, progress: number) => void
  onZoom?: (direction: "in" | "out") => void
  onTaskDoubleClick?: (task: FrappeTask) => void
  onContainerReady?: (container: HTMLElement | null) => void
  onScrollPositionChange?: (position: GanttScrollPosition) => void
  onTodayScrollReady?: (handler: (() => void) | null) => void
  onDateScrollReady?: (handler: ((date: string) => void) | null) => void
  onTaskVisibilityReady?: (
    handler: ((taskId: string) => void) | null
  ) => void
}

export function GanttChart({
  tasks,
  exceptions = [],
  viewMode,
  columnWidth,
  panMode = false,
  criticalPathMode = false,
  displayColorPalette,
  onDateChange,
  onProgressChange,
  onZoom,
  onTaskDoubleClick,
  onContainerReady,
  onScrollPositionChange,
  onTodayScrollReady,
  onDateScrollReady,
  onTaskVisibilityReady,
}: GanttChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ganttRef = useRef<any>(null)
  const [loaded, setLoaded] = useState(false)
  const latestTasksRef = useRef(tasks)
  latestTasksRef.current = tasks
  const interactionCallbacksRef = useRef({
    onTaskDoubleClick,
    onContainerReady,
    onScrollPositionChange,
    onTodayScrollReady,
    onDateScrollReady,
    onTaskVisibilityReady,
  })
  interactionCallbacksRef.current = {
    onTaskDoubleClick,
    onContainerReady,
    onScrollPositionChange,
    onTodayScrollReady,
    onDateScrollReady,
    onTaskVisibilityReady,
  }

  const taskForEventTarget = useCallback((target: EventTarget): FrappeTask | null => {
    if (!(target instanceof Element)) return null
    const taskId = target.closest<SVGGElement>(".bar-wrapper[data-id]")?.dataset.id
    if (!taskId || taskId.startsWith("phase-")) return null
    return latestTasksRef.current.find((task) => task.id === taskId) ?? null
  }, [])

  const handleDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const task = taskForEventTarget(event.target)
      if (task) interactionCallbacksRef.current.onTaskDoubleClick?.(task)
    },
    [taskForEventTarget]
  )

  // pan state - scrolls the .gantt-container directly
  const isPanning = useRef(false)
  const panStartX = useRef(0)
  const panStartY = useRef(0)
  const panScrollLeft = useRef(0)
  const panScrollTop = useRef(0)
  const panAxis = useRef<GanttScrollAxis | null>(null)
  const ganttContainerRef = useRef<HTMLElement | null>(null)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const canPan = e.button === 1 || (panMode && e.button === 0)
    if (!canPan) return
    e.preventDefault()
    const gc = ganttContainerRef.current
    if (!gc) return
    isPanning.current = true
    panStartX.current = e.clientX
    panStartY.current = e.clientY
    panScrollLeft.current = gc.scrollLeft
    panScrollTop.current = gc.scrollTop
    panAxis.current = null
    const wrapper = wrapperRef.current
    if (wrapper) wrapper.style.cursor = "grabbing"
  }, [panMode])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning.current) return
    const gc = ganttContainerRef.current
    if (!gc) return
    const deltaX = e.clientX - panStartX.current
    const deltaY = e.clientY - panStartY.current
    if (
      panAxis.current === null &&
      Math.max(Math.abs(deltaX), Math.abs(deltaY)) >= 6
    ) {
      panAxis.current = dominantScrollAxis(deltaX, deltaY)
    }
    if (panAxis.current === "horizontal") {
      gc.scrollLeft = panScrollLeft.current - deltaX
      return
    }
    if (panAxis.current === "vertical") {
      gc.scrollTop = panScrollTop.current - deltaY
    }
  }, [])

  const handleMouseUp = useCallback(() => {
    if (!isPanning.current) return
    isPanning.current = false
    panAxis.current = null
    const wrapper = wrapperRef.current
    if (wrapper) wrapper.style.cursor = ""
  }, [])

  // Keep wheel handling on the stable React wrapper. Frappe may rebuild its
  // generated scroll element when the view changes, but the wrapper survives.
  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        if (!onZoom) return
        e.preventDefault()
        onZoom(e.deltaY < 0 ? "in" : "out")
        return
      }

      const container = ganttContainerRef.current
      if (!container) return
      const intent = ganttWheelIntent(e.deltaX, e.deltaY, e.shiftKey)
      if (!intent) return
      const pageSize =
        intent.axis === "vertical"
          ? container.clientHeight
          : container.clientWidth
      const delta = normalizeWheelDelta(intent.delta, e.deltaMode, pageSize)
      const canScroll =
        intent.axis === "vertical"
          ? canScrollGanttAxis(
              container.scrollTop,
              container.scrollHeight,
              container.clientHeight,
              delta
            )
          : canScrollGanttAxis(
              container.scrollLeft,
              container.scrollWidth,
              container.clientWidth,
              delta
            )
      if (!canScroll) {
        const workspace = wrapper.closest<HTMLElement>(
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
          e.preventDefault()
          workspace.scrollTop += delta
        }
        return
      }

      e.preventDefault()
      if (intent.axis === "vertical") container.scrollTop += delta
      else container.scrollLeft += delta
    }

    wrapper.addEventListener("wheel", handleWheel, { passive: false })
    return () => wrapper.removeEventListener("wheel", handleWheel)
  }, [onZoom])

  useEffect(() => {
    if (!containerRef.current || tasks.length === 0) return

    let cancelled = false
    let activeContainer: HTMLElement | null = null
    const handleScroll = () => {
      if (!activeContainer) return
      const gantt = ganttRef.current
      const centerUnits = gantt
        ? ((activeContainer.scrollLeft + activeContainer.clientWidth / 2) /
            gantt.config.column_width) *
          gantt.config.step
        : 0
      interactionCallbacksRef.current.onScrollPositionChange?.({
        left: activeContainer.scrollLeft,
        top: activeContainer.scrollTop,
        ...(gantt
          ? {
              anchorDate: dateKey(
                addUnits(gantt.gantt_start, centerUnits, gantt.config.unit)
              ),
            }
          : {}),
      })
    }
    async function initGantt() {
      const { default: Gantt } = await import("frappe-gantt")
      if (cancelled || !containerRef.current) return

      // clear previous gantt instance by removing child nodes
      while (containerRef.current.firstChild) {
        containerRef.current.removeChild(containerRef.current.firstChild)
      }

      const ganttTasks = tasks.map((t) => ({
        id: t.id,
        name: t.name,
        start: t.start,
        end: t.end,
        progress: t.progress,
        dependencies: t.dependencies,
        custom_class: t.custom_class,
      }))
      const earliestStart = tasks
        .map((task) => task.start)
        .sort((left, right) => left.localeCompare(right))[0]
      const latestEnd = tasks
        .map((task) => task.end)
        .sort((left, right) => right.localeCompare(left))[0]
      const today = dateKey(new Date())
      const viewModes = GANTT_VIEW_MODES.map((mode) =>
        mode.name === viewMode
          ? {
              ...mode,
              padding: paddingToIncludeDate(
                earliestStart,
                latestEnd,
                today,
                basePaddingDays(viewMode)
              ),
            }
          : mode
      )

      ganttRef.current = new Gantt(containerRef.current, ganttTasks, {
        view_mode: viewMode,
        view_modes: viewModes,
        infinite_padding: false,
        holidays: {
          "var(--background)": "weekend",
        },
        is_weekend: (date: Date) => isNonWorkday(date, exceptions),
        ...(columnWidth ? { column_width: columnWidth } : {}),
        on_date_change: (task: { id: string }, start: Date, end: Date) => {
          if (onDateChange) {
            const original = tasks.find((t) => t.id === task.id)
            if (original) onDateChange(original, start, end)
          }
        },
        on_progress_change: (task: { id: string }, progress: number) => {
          if (onProgressChange) {
            const original = tasks.find((t) => t.id === task.id)
            if (original) onProgressChange(original, progress)
          }
        },
      })
      // Frappe resets a custom view-mode collection to its first entry during
      // construction, so explicitly restore the React-selected mode.
      ganttRef.current.change_view_mode(viewMode)
      const gantt = ganttRef.current
      interactionCallbacksRef.current.onTodayScrollReady?.(() => {
        const container = ganttContainerRef.current
        if (!container) return
        const todayDate = new Date()
        todayDate.setHours(0, 0, 0, 0)
        const units = differenceInUnits(
          todayDate,
          gantt.gantt_start,
          gantt.config.unit
        )
        const left =
          (units / gantt.config.step) * gantt.config.column_width -
          container.clientWidth / 2
        container.scrollTo({
          left: Math.max(
            0,
            Math.min(left, container.scrollWidth - container.clientWidth)
          ),
          behavior: "smooth",
        })
      })
      interactionCallbacksRef.current.onDateScrollReady?.((date) => {
        const container = ganttContainerRef.current
        if (!container) return
        const anchor = new Date(`${date}T00:00:00`)
        const units = differenceInUnits(
          anchor,
          gantt.gantt_start,
          gantt.config.unit
        )
        const left =
          (units / gantt.config.step) * gantt.config.column_width -
          container.clientWidth / 2
        container.scrollLeft = Math.max(
          0,
          Math.min(left, container.scrollWidth - container.clientWidth)
        )
      })

      const tasksById = new Map(tasks.map((task) => [task.id, task]))
      for (const wrapper of containerRef.current.querySelectorAll<HTMLElement>(
        ".bar-wrapper"
      )) {
        const task = tasksById.get(wrapper.dataset.id ?? "")
        if (!task || task.id.startsWith("phase-")) continue
        wrapper.classList.add(...getScheduleItemClasses(task))
        if (task.projectColor) {
          wrapper.classList.add("project-color")
          wrapper.style.setProperty(
            "--schedule-project-color",
            task.projectColor
          )
        }
      }

      // constrain gantt-container to wrapper height so content overflows
      // this enables scroll-based panning while keeping the header sticky
      const ganttContainer = containerRef.current.querySelector(
        ".gantt-container"
      ) as HTMLElement | null
      if (ganttContainer) {
        ganttContainer.style.height = "100%"
        ganttContainerRef.current = ganttContainer
        activeContainer = ganttContainer
        activeContainer.addEventListener("scroll", handleScroll, {
          passive: true,
        })
        interactionCallbacksRef.current.onTaskVisibilityReady?.((taskId) => {
          const root = containerRef.current
          const container = ganttContainerRef.current
          if (!root || !container) return
          const bar = root.querySelector<SVGRectElement>(
            `.gantt .bar-wrapper[data-id="${CSS.escape(taskId)}"] .bar`
          )
          if (!bar) return
          const barLeft = Number(bar.getAttribute("x"))
          const barWidth = Number(bar.getAttribute("width"))
          if (!Number.isFinite(barLeft) || !Number.isFinite(barWidth)) return
          const safeLeft = container.scrollLeft + 32
          const safeRight =
            container.scrollLeft + container.clientWidth - 32
          const barRight = barLeft + barWidth
          if (barRight >= safeLeft && barLeft <= safeRight) return
          const centeredLeft =
            barLeft + barWidth / 2 - container.clientWidth / 2
          container.scrollTo({
            left: Math.max(
              0,
              Math.min(
                centeredLeft,
                container.scrollWidth - container.clientWidth
              )
            ),
            behavior: "auto",
          })
        })
        interactionCallbacksRef.current.onContainerReady?.(activeContainer)
      }

      setLoaded(true)
    }

    initGantt()
    return () => {
      cancelled = true
      activeContainer?.removeEventListener("scroll", handleScroll)
      if (ganttContainerRef.current === activeContainer) {
        ganttContainerRef.current = null
      }
      interactionCallbacksRef.current.onContainerReady?.(null)
      interactionCallbacksRef.current.onTodayScrollReady?.(null)
      interactionCallbacksRef.current.onDateScrollReady?.(null)
      interactionCallbacksRef.current.onTaskVisibilityReady?.(null)
    }
  }, [tasks, exceptions, viewMode, columnWidth, onDateChange, onProgressChange])

  useEffect(() => {
    if (ganttRef.current && loaded) {
      ganttRef.current.change_view_mode(viewMode)
    }
  }, [viewMode, loaded])

  useEffect(() => {
    const wrapper = wrapperRef.current
    const container = ganttContainerRef.current
    if (!wrapper || !container || !loaded || typeof ResizeObserver === "undefined") {
      return
    }

    let frameId: number | null = null
    let observedWidth: number | null = null
    const reconcileAfterResize = (): void => {
      frameId = requestAnimationFrame(() => {
        frameId = null
        const activeContainer = ganttContainerRef.current
        if (!activeContainer) return
        activeContainer.scrollLeft = clampGanttScrollOffset(
          activeContainer.scrollLeft,
          activeContainer.scrollWidth,
          activeContainer.clientWidth
        )
        activeContainer.scrollTop = clampGanttScrollOffset(
          activeContainer.scrollTop,
          activeContainer.scrollHeight,
          activeContainer.clientHeight
        )
        activeContainer.dispatchEvent(new Event("scroll"))
      })
    }

    const resizeObserver = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width
      if (width === undefined || width === observedWidth) return
      observedWidth = width
      if (frameId !== null) cancelAnimationFrame(frameId)
      reconcileAfterResize()
    })
    resizeObserver.observe(wrapper)
    return () => {
      resizeObserver.disconnect()
      if (frameId !== null) cancelAnimationFrame(frameId)
    }
  }, [loaded])

  if (tasks.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        Add tasks in the List view to see them on the Gantt chart.
      </div>
    )
  }

  return (
    <div
      ref={wrapperRef}
      className={`gantt-wrapper relative overflow-hidden h-full${
        criticalPathMode ? " critical-path-mode" : ""
      }`}
      style={{
        cursor: panMode ? "grab" : undefined,
        ...(displayColorPalette
          ? Object.fromEntries(
              Object.entries(displayColorPalette).map(([color, value]) => [
                `--schedule-display-${color}`,
                value,
              ])
            )
          : {}),
      } as CSSProperties}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onDoubleClick={handleDoubleClick}
    >
      <div ref={containerRef} className="h-full" />
    </div>
  )
}
