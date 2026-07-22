"use client"

import { useRef, useEffect, useCallback, useMemo } from "react"
import type FrappeGantt from "frappe-gantt"
import type { FrappeTask } from "@/lib/schedule/gantt-transform"
import "./gantt.css"

type ViewMode = "Day" | "Week" | "Month"

interface GanttChartProps {
  tasks: FrappeTask[]
  viewMode: ViewMode
  columnWidth?: number
  panMode?: boolean
  onDateChange?: (
    task: FrappeTask,
    start: Date,
    end: Date
  ) => void
  onProgressChange?: (task: FrappeTask, progress: number) => void
  onZoom?: (direction: "in" | "out") => void
  onTaskClick?: (task: FrappeTask) => void
  onTaskDoubleClick?: (task: FrappeTask) => void
  onTaskContextMenu?: (task: FrappeTask) => void
  onContainerReady?: (container: HTMLElement | null) => void
  onScrollPositionChange?: (position: GanttScrollPosition) => void
  onTodayScrollReady?: (handler: (() => void) | null) => void
  onDateScrollReady?: (handler: ((date: string) => void) | null) => void
  baselineTasks?: readonly GanttBaselineTask[]
}

export interface GanttScrollPosition {
  readonly left: number
  readonly top: number
  readonly anchorDate?: string
}

export interface GanttBaselineTask {
  readonly id: string
  readonly start: string
  readonly end: string
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
  if (unit === "hour") return milliseconds / 3_600_000
  if (unit === "year") return milliseconds / 31_536_000_000
  return milliseconds / 86_400_000
}

function addUnits(start: Date, amount: number, unit: string): Date {
  const date = new Date(start)
  if (unit === "hour") {
    date.setTime(date.getTime() + amount * 3_600_000)
    return date
  }
  if (unit === "month") {
    const wholeMonths = Math.trunc(amount)
    date.setMonth(date.getMonth() + wholeMonths)
    date.setTime(date.getTime() + (amount - wholeMonths) * 30 * 86_400_000)
    return date
  }
  if (unit === "year") {
    const wholeYears = Math.trunc(amount)
    date.setFullYear(date.getFullYear() + wholeYears)
    date.setTime(date.getTime() + (amount - wholeYears) * 365 * 86_400_000)
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

function monthYear(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(date)
}

function shortMonthYear(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
  }).format(date)
}

function weekRange(date: Date): string {
  const end = new Date(date)
  end.setDate(end.getDate() + 6)
  const startText = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date)
  const endText = new Intl.DateTimeFormat("en-US", {
    month: end.getMonth() === date.getMonth() ? undefined : "short",
    day: "numeric",
  }).format(end)
  return `${startText} - ${endText}`
}

const COMPASS_GANTT_VIEW_MODES = [
  {
    name: "Day",
    padding: "7d",
    step: "1d",
    date_format: "YYYY-MM-DD",
    lower_text: (date: Date): string => String(date.getDate()),
    upper_text: (date: Date, lastDate: Date | null): string =>
      !lastDate ||
      date.getMonth() !== lastDate.getMonth() ||
      date.getFullYear() !== lastDate.getFullYear()
        ? monthYear(date)
        : "",
    thick_line: (date: Date): boolean => date.getDay() === 1,
  },
  {
    name: "Week",
    padding: "1m",
    step: "7d",
    date_format: "YYYY-MM-DD",
    column_width: 140,
    lower_text: (date: Date): string => weekRange(date),
    upper_text: (date: Date, lastDate: Date | null): string =>
      !lastDate ||
      date.getMonth() !== lastDate.getMonth() ||
      date.getFullYear() !== lastDate.getFullYear()
        ? monthYear(date)
        : "",
    thick_line: (date: Date): boolean => date.getDate() >= 1 && date.getDate() <= 7,
    upper_text_frequency: 4,
  },
  {
    name: "Month",
    padding: "2m",
    step: "1m",
    column_width: 120,
    date_format: "YYYY-MM",
    lower_text: (date: Date): string => shortMonthYear(date),
    upper_text: "",
    thick_line: (date: Date): boolean => date.getMonth() % 3 === 0,
    snap_at: "7d",
  },
] satisfies NonNullable<
  ConstructorParameters<typeof FrappeGantt>[2]
>["view_modes"]

function baselineWidth(
  start: Date,
  end: Date,
  unit: string,
  step: number,
  columnWidth: number
): number {
  const endOfFinalDay = new Date(end)
  endOfFinalDay.setDate(endOfFinalDay.getDate() + 1)
  const days = differenceInUnits(endOfFinalDay, start, "day")
  const durationInUnit = unit === "month" ? days / 30 : unit === "year" ? days / 365 : days
  return Math.max(3, (durationInUnit / step) * columnWidth)
}

function renderBaselineOverlays(
  gantt: FrappeGantt,
  baselineTasks: readonly GanttBaselineTask[],
  root: HTMLElement
): void {
  const svgNamespace = "http://www.w3.org/2000/svg"
  for (const baselineTask of baselineTasks) {
    const wrapper = root.querySelector<SVGGElement>(
      `.gantt .bar-wrapper[data-id="${CSS.escape(baselineTask.id)}"]`
    )
    const currentBar = wrapper?.querySelector<SVGRectElement>(".bar")
    const barGroup = wrapper?.querySelector<SVGGElement>(".bar-group")
    if (!currentBar || !barGroup) continue

    const start = new Date(`${baselineTask.start}T00:00:00`)
    const end = new Date(`${baselineTask.end}T00:00:00`)
    const x =
      (differenceInUnits(start, gantt.gantt_start, gantt.config.unit) /
        gantt.config.step) *
      gantt.config.column_width
    const width = baselineWidth(
      start,
      end,
      gantt.config.unit,
      gantt.config.step,
      gantt.config.column_width
    )
    const y = Number(currentBar.getAttribute("y") ?? 0)
    const height = Number(currentBar.getAttribute("height") ?? 30)
    const overlay = document.createElementNS(svgNamespace, "rect")
    overlay.setAttribute("class", "baseline-overlay")
    overlay.setAttribute("x", String(x))
    overlay.setAttribute("y", String(y + height + 3))
    overlay.setAttribute("width", String(width))
    overlay.setAttribute("height", "5")
    overlay.setAttribute("rx", "2")
    overlay.setAttribute("ry", "2")
    barGroup.appendChild(overlay)
  }
}

function renderTaskColors(tasks: readonly FrappeTask[], root: HTMLElement): void {
  for (const task of tasks) {
    const wrapper = root.querySelector<SVGGElement>(
      `.gantt .bar-wrapper[data-id="${CSS.escape(task.id)}"]`
    )
    const bar = wrapper?.querySelector<SVGRectElement>(".bar")
    const progress = wrapper?.querySelector<SVGPathElement>(".bar-progress")
    if (!wrapper || !bar || !task.color) continue

    bar.style.fill = task.color
    bar.style.stroke = task.isCriticalPath ? "#b42318" : task.color
    bar.style.strokeWidth = task.isCriticalPath ? "3" : "1"
    if (progress) {
      progress.style.fill = `color-mix(in srgb, ${task.color} 72%, black)`
    }
    if (task.isMilestone) bar.style.strokeWidth = "3"
  }
}

export function GanttChart({
  tasks,
  viewMode,
  columnWidth,
  panMode = false,
  onDateChange,
  onProgressChange,
  onZoom,
  onTaskClick,
  onTaskDoubleClick,
  onTaskContextMenu,
  onContainerReady,
  onScrollPositionChange,
  onTodayScrollReady,
  onDateScrollReady,
  baselineTasks = [],
}: GanttChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const ganttRef = useRef<FrappeGantt | null>(null)
  const latestTasksRef = useRef(tasks)
  latestTasksRef.current = tasks
  const latestBaselineTasksRef = useRef(baselineTasks)
  latestBaselineTasksRef.current = baselineTasks
  const ganttInputKey = useMemo(
    () =>
      tasks
        .map((task) =>
          [
            task.id,
            task.name,
            task.start,
            task.end,
            task.progress,
            task.dependencies,
            task.custom_class,
          ].join("\u001f")
        )
        .join("\u001e"),
    [tasks]
  )
  const baselineInputKey = useMemo(
    () =>
      baselineTasks
        .map((task) => [task.id, task.start, task.end].join("\u001f"))
        .join("\u001e"),
    [baselineTasks]
  )
  const callbackRefs = useRef({
    onDateChange,
    onProgressChange,
    onTaskClick,
    onTaskDoubleClick,
    onTaskContextMenu,
    onContainerReady,
    onScrollPositionChange,
    onTodayScrollReady,
    onDateScrollReady,
  })
  callbackRefs.current = {
    onDateChange,
    onProgressChange,
    onTaskClick,
    onTaskDoubleClick,
    onTaskContextMenu,
    onContainerReady,
    onScrollPositionChange,
    onTodayScrollReady,
    onDateScrollReady,
  }

  const taskForEventTarget = useCallback((target: EventTarget): FrappeTask | null => {
    if (!(target instanceof Element)) return null
    const barWrapper = target.closest<SVGGElement>(".bar-wrapper[data-id]")
    const taskId = barWrapper?.dataset.id
    if (!taskId || taskId.startsWith("phase-")) return null
    return latestTasksRef.current.find((task) => task.id === taskId) ?? null
  }, [])

  const handleDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const task = taskForEventTarget(event.target)
      if (task) callbackRefs.current.onTaskDoubleClick?.(task)
    },
    [taskForEventTarget]
  )

  const handleContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const task = taskForEventTarget(event.target)
      if (task) callbackRefs.current.onTaskContextMenu?.(task)
    },
    [taskForEventTarget]
  )

  // pan state - scrolls the .gantt-container directly
  const isPanning = useRef(false)
  const panStartX = useRef(0)
  const panStartY = useRef(0)
  const panScrollLeft = useRef(0)
  const panScrollTop = useRef(0)
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
    const wrapper = wrapperRef.current
    if (wrapper) wrapper.style.cursor = "grabbing"
  }, [panMode])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning.current) return
    const gc = ganttContainerRef.current
    if (!gc) return
    gc.scrollLeft = panScrollLeft.current - (e.clientX - panStartX.current)
    gc.scrollTop = panScrollTop.current - (e.clientY - panStartY.current)
  }, [])

  const handleMouseUp = useCallback(() => {
    if (!isPanning.current) return
    isPanning.current = false
    const wrapper = wrapperRef.current
    if (wrapper) wrapper.style.cursor = ""
  }, [])

  // ctrl+scroll zoom
  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper || !onZoom) return

    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      onZoom(e.deltaY < 0 ? "in" : "out")
    }

    wrapper.addEventListener("wheel", handleWheel, { passive: false })
    return () => wrapper.removeEventListener("wheel", handleWheel)
  }, [onZoom])

  useEffect(() => {
    if (!containerRef.current || latestTasksRef.current.length === 0) return

    let cancelled = false
    let activeContainer: HTMLElement | null = null
    const handleScroll = () => {
      const onScroll = callbackRefs.current.onScrollPositionChange
      if (!activeContainer || !onScroll) return
      const gantt = ganttRef.current
      const centerUnits = gantt
        ? ((activeContainer.scrollLeft + activeContainer.clientWidth / 2) /
            gantt.config.column_width) *
          gantt.config.step
        : 0
      onScroll({
        left: activeContainer.scrollLeft,
        top: activeContainer.scrollTop,
        ...(gantt
          ? { anchorDate: dateKey(addUnits(gantt.gantt_start, centerUnits, gantt.config.unit)) }
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

      const currentTasks = latestTasksRef.current
      const ganttTasks = currentTasks.map((t) => ({
        id: t.id,
        name: t.name,
        start: t.start,
        end: t.end,
        progress: t.progress,
        dependencies: t.dependencies,
        custom_class: t.custom_class,
      }))

      const gantt = new Gantt(containerRef.current, ganttTasks, {
        view_mode: viewMode,
        view_modes: COMPASS_GANTT_VIEW_MODES,
        ...(columnWidth ? { column_width: columnWidth } : {}),
        infinite_padding: false,
        bar_height: 28,
        padding: 20,
        today_button: false,
        scroll_to: "start",
        on_date_change: (task: { id: string }, start: Date, end: Date) => {
          const dateChange = callbackRefs.current.onDateChange
          if (dateChange) {
            const original = latestTasksRef.current.find((t) => t.id === task.id)
            if (original) dateChange(original, start, end)
          }
        },
        on_progress_change: (task: { id: string }, progress: number) => {
          const progressChange = callbackRefs.current.onProgressChange
          if (progressChange) {
            const original = latestTasksRef.current.find((t) => t.id === task.id)
            if (original) progressChange(original, progress)
          }
        },
        on_click: (task: { id: string }) => {
          const taskClick = callbackRefs.current.onTaskClick
          if (!taskClick || task.id.startsWith("phase-")) return
          const original = latestTasksRef.current.find((item) => item.id === task.id)
          if (original) taskClick(original)
        },
      })
      ganttRef.current = gantt
      callbackRefs.current.onTodayScrollReady?.(() => {
        const container = ganttContainerRef.current
        if (!container) return
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const units = differenceInUnits(today, gantt.gantt_start, gantt.config.unit)
        const left =
          (units / gantt.config.step) * gantt.config.column_width -
          container.clientWidth / 2
        container.scrollTo({
          left: Math.max(0, Math.min(left, container.scrollWidth - container.clientWidth)),
          behavior: "smooth",
        })
      })
      callbackRefs.current.onDateScrollReady?.((date) => {
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
      renderBaselineOverlays(
        gantt,
        latestBaselineTasksRef.current,
        containerRef.current
      )
      renderTaskColors(currentTasks, containerRef.current)

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
        callbackRefs.current.onContainerReady?.(activeContainer)
      }
    }

    initGantt()
    return () => {
      cancelled = true
      activeContainer?.removeEventListener("scroll", handleScroll)
      callbackRefs.current.onContainerReady?.(null)
      callbackRefs.current.onTodayScrollReady?.(null)
      callbackRefs.current.onDateScrollReady?.(null)
    }
  }, [
    ganttInputKey,
    viewMode,
    columnWidth,
    baselineInputKey,
  ])

  useEffect(() => {
    if (!containerRef.current || !ganttRef.current) return
    renderTaskColors(tasks, containerRef.current)
  }, [tasks])

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
      className="gantt-wrapper relative overflow-hidden h-full"
      style={{ cursor: panMode ? "grab" : undefined }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
    >
      <div ref={containerRef} className="h-full" />
    </div>
  )
}
