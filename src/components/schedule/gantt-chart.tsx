"use client"

import { useRef, useEffect, useState, useCallback, type CSSProperties } from "react"
import type { FrappeTask } from "@/lib/schedule/gantt-transform"
import type { DisplayColorPalette } from "@/lib/schedule/appearance"
import { getScheduleItemClasses } from "@/lib/schedule/appearance"
import "./gantt.css"

type ViewMode = "Day" | "Week" | "Month"

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
]

interface GanttChartProps {
  tasks: FrappeTask[]
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
  onScrollTopChange?: (top: number) => void
}

export function GanttChart({
  tasks,
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
  onScrollTopChange,
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
    onScrollTopChange,
  })
  interactionCallbacksRef.current = {
    onTaskDoubleClick,
    onContainerReady,
    onScrollTopChange,
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
    if (!containerRef.current || tasks.length === 0) return

    let cancelled = false
    let activeContainer: HTMLElement | null = null
    const handleScroll = () => {
      if (!activeContainer) return
      interactionCallbacksRef.current.onScrollTopChange?.(
        activeContainer.scrollTop
      )
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

      ganttRef.current = new Gantt(containerRef.current, ganttTasks, {
        view_mode: viewMode,
        view_modes: GANTT_VIEW_MODES,
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

      const tasksById = new Map(tasks.map((task) => [task.id, task]))
      for (const wrapper of containerRef.current.querySelectorAll<HTMLElement>(
        ".bar-wrapper"
      )) {
        const task = tasksById.get(wrapper.dataset.id ?? "")
        if (!task || task.id.startsWith("phase-")) continue
        wrapper.classList.add(...getScheduleItemClasses(task))
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
    }
  }, [tasks, viewMode, columnWidth, onDateChange, onProgressChange])

  useEffect(() => {
    if (ganttRef.current && loaded) {
      ganttRef.current.change_view_mode(viewMode)
    }
  }, [viewMode, loaded])

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
