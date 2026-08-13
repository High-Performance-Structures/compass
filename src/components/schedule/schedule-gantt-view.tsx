"use client"

import {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useTransition,
  type UIEvent,
} from "react"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  IconPencil,
  IconPlus,
  IconChevronRight,
  IconChevronDown,
  IconSettings,
  IconZoomIn,
  IconZoomOut,
  IconCalendar,
} from "@tabler/icons-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-mobile"
import {
  GanttChart,
  type GanttScrollPosition,
} from "./gantt-chart"
import { ScheduleItemFormDialog } from "./schedule-item-form-dialog"
import {
  transformToFrappeTasks,
  transformWithPhaseGroups,
} from "@/lib/schedule/gantt-transform"
import type { DisplayItem, FrappeTask } from "@/lib/schedule/gantt-transform"
import { updateTask } from "@/app/actions/schedule"
import { updateGanttScrollMode } from "@/app/actions/user-schedule-preferences"
import {
  DEFAULT_GANTT_SCROLL_MODE,
  type GanttScrollMode,
  shouldSynchronizeGanttPanes,
} from "@/lib/schedule/gantt-interaction-mode"
import { countBusinessDays } from "@/lib/schedule/business-days"
import { effectivePercentComplete } from "@/lib/schedule/progress"
import {
  DEFAULT_DISPLAY_COLOR_LABELS,
  DEFAULT_DISPLAY_COLOR_PALETTE,
  DISPLAY_COLOR_OPTIONS,
  schedulePaletteLabelStorageKey,
  normalizeDisplayColorPalette,
  schedulePaletteStorageKey,
  type DisplayColor,
  type DisplayColorPalette,
} from "@/lib/schedule/appearance"
import type {
  ScheduleTaskData,
  TaskDependencyData,
  WorkdayExceptionData,
} from "@/lib/schedule/types"
import type { ProjectTaskAssigneeOption } from "@/app/actions/project-contacts"
import { ProjectTaskCreateButton } from "@/components/projects/project-task-create-button"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { format } from "date-fns"
import type { ScheduleProjectData } from "@/lib/schedule/project-scope"
import { projectScheduleLabel } from "@/lib/schedule/project-scope"
import {
  centeredGanttRowScrollTop,
  canScrollGanttAxis,
  ganttRowIndexForScrollTop,
  lockWheelToDominantAxis,
  nearestScheduleRowIndexForDate,
  normalizeWheelDelta,
  synchronizedScrollTop,
} from "@/lib/schedule/gantt-scroll"

type ViewMode = "Day" | "Week" | "Month" | "Year"

const COLOR_PICKER_SWATCHES = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#06b6d4",
  "#3b82f6", "#6366f1", "#a855f7", "#ec4899", "#6b7280", "#111827",
] as const

interface ScheduleGanttViewProps {
  readonly projectId: string | null
  readonly tasks: readonly ScheduleTaskData[]
  readonly dependencies: readonly TaskDependencyData[]
  readonly exceptions: readonly WorkdayExceptionData[]
  readonly assigneeOptions: readonly ProjectTaskAssigneeOption[]
  readonly projects?: readonly ScheduleProjectData[]
  readonly ganttScrollMode?: GanttScrollMode
  readonly groupByPhase?: boolean
  readonly onGroupByPhaseChange?: (grouped: boolean) => void
}

export function ScheduleGanttView({
  projectId,
  tasks,
  dependencies,
  exceptions,
  assigneeOptions,
  projects = [],
  ganttScrollMode = DEFAULT_GANTT_SCROLL_MODE,
  groupByPhase = false,
  onGroupByPhaseChange,
}: ScheduleGanttViewProps) {
  const router = useRouter()
  const isMobile = useIsMobile()
  const [viewMode, setViewMode] = useState<ViewMode>("Week")
  const [phaseGrouping, setPhaseGrouping] = useState(false)
  const [collapsedPhases, setCollapsedPhases] = useState<Set<string>>(
    new Set()
  )
  const [showCriticalPath, setShowCriticalPath] = useState(false)
  const [showScheduleKey, setShowScheduleKey] = useState(false)
  const [editingScheduleKey, setEditingScheduleKey] = useState(false)
  const [displayColorPalette, setDisplayColorPalette] = useState<DisplayColorPalette>(
    DEFAULT_DISPLAY_COLOR_PALETTE
  )
  const [displayColorLabels, setDisplayColorLabels] = useState<Record<DisplayColor, string>>(
    DEFAULT_DISPLAY_COLOR_LABELS
  )
  const [taskFormOpen, setTaskFormOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<ScheduleTaskData | null>(
    null
  )
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null)
  const [mobileView, setMobileView] = useState<"tasks" | "chart">("chart")
  const [scrollMode, setScrollMode] = useState<GanttScrollMode>(ganttScrollMode)
  const [isSavingScrollMode, startScrollModeTransition] = useTransition()
  const [panMode] = useState(false)
  const taskListRef = useRef<HTMLDivElement>(null)
  const ganttContainerRef = useRef<HTMLElement | null>(null)
  const scrollPositionRef = useRef<GanttScrollPosition>({ left: 0, top: 0 })
  const scrollStorageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollToTodayRef = useRef<(() => void) | null>(null)
  const scrollToDateRef = useRef<((date: string) => void) | null>(null)
  const scrollTaskIntoViewRef = useRef<((taskId: string) => void) | null>(null)
  const displayItemsRef = useRef<readonly DisplayItem[]>([])
  const followedListItemRef = useRef<string | null>(null)
  const scrollRestoredProjectRef = useRef<string | null>(null)
  const preferenceScopeKey = projectId ?? "unified"
  const scrollStorageKey = `compass:schedule-scroll:${preferenceScopeKey}`
  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects]
  )
  const multipleProjects = projectById.size > 1

  useEffect(() => {
    setPhaseGrouping(groupByPhase)
  }, [groupByPhase])

  useEffect(() => {
    setScrollMode(ganttScrollMode)
  }, [ganttScrollMode])

  const [hasLoadedPalette, setHasLoadedPalette] = useState(false)

  useEffect(() => {
    try {
      const storedPalette = window.localStorage.getItem(
        schedulePaletteStorageKey(preferenceScopeKey)
      )
      const storedLabels = window.localStorage.getItem(
        schedulePaletteLabelStorageKey(preferenceScopeKey)
      )
      if (storedPalette) {
        setDisplayColorPalette(normalizeDisplayColorPalette(JSON.parse(storedPalette)))
      }
      if (storedLabels) {
        const candidate = JSON.parse(storedLabels) as Partial<Record<DisplayColor, string>>
        setDisplayColorLabels({
          ...DEFAULT_DISPLAY_COLOR_LABELS,
          ...Object.fromEntries(
            Object.entries(candidate).filter(([, value]) => typeof value === "string" && value.trim())
          ),
        })
      }
    } catch {
      // A malformed or unavailable local preference falls back to the default palette.
    } finally {
      setHasLoadedPalette(true)
    }
  }, [preferenceScopeKey])

  useEffect(() => {
    if (!hasLoadedPalette) return
    window.localStorage.setItem(
      schedulePaletteStorageKey(preferenceScopeKey),
      JSON.stringify(displayColorPalette)
    )
    window.localStorage.setItem(
      schedulePaletteLabelStorageKey(preferenceScopeKey),
      JSON.stringify(displayColorLabels)
    )
  }, [
    displayColorLabels,
    displayColorPalette,
    hasLoadedPalette,
    preferenceScopeKey,
  ])

  const updatePaletteColor = (color: DisplayColor, value: string) => {
    setDisplayColorPalette((palette) => ({ ...palette, [color]: value }))
  }

  const updatePaletteLabel = (color: DisplayColor, value: string) => {
    setDisplayColorLabels((labels) => ({ ...labels, [color]: value }))
  }

  const defaultWidths: Record<ViewMode, number> = {
    Day: 38,
    Week: 140,
    Month: 120,
    Year: 160,
  }
  const [columnWidth, setColumnWidth] = useState(defaultWidths[viewMode])

  const handleZoom = useCallback((direction: "in" | "out") => {
    setColumnWidth((prev) => {
      const next = direction === "in" ? prev * 1.3 : prev / 1.3
      return Math.round(Math.min(300, Math.max(20, next)))
    })
  }, [])

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode)
    setColumnWidth(defaultWidths[mode])
  }

  const handleScrollModeChange = (powerUser: boolean): void => {
    const nextMode: GanttScrollMode = powerUser ? "power" : "default"
    if (nextMode === scrollMode) return
    const previousMode = scrollMode
    setScrollMode(nextMode)
    startScrollModeTransition(async () => {
      const result = await updateGanttScrollMode(nextMode)
      if (!result.success) {
        setScrollMode(previousMode)
        toast.error(result.error)
      }
    })
  }

  const rememberScrollPosition = useCallback(
    (position: GanttScrollPosition) => {
      scrollPositionRef.current = position
      if (scrollStorageTimerRef.current) {
        clearTimeout(scrollStorageTimerRef.current)
      }
      scrollStorageTimerRef.current = setTimeout(() => {
        try {
          window.sessionStorage.setItem(
            scrollStorageKey,
            JSON.stringify(scrollPositionRef.current)
          )
        } catch {
          // In-memory state still preserves this visit.
        }
      }, 150)
    },
    [scrollStorageKey]
  )

  const flushScrollPosition = useCallback(() => {
    if (scrollStorageTimerRef.current) {
      clearTimeout(scrollStorageTimerRef.current)
      scrollStorageTimerRef.current = null
    }
    try {
      window.sessionStorage.setItem(
        scrollStorageKey,
        JSON.stringify(scrollPositionRef.current)
      )
    } catch {
      // Persisting the position is optional.
    }
  }, [scrollStorageKey])

  useEffect(() => {
    return flushScrollPosition
  }, [flushScrollPosition])

  useEffect(() => {
    const taskList = taskListRef.current
    if (!taskList) return

    // The resizable layout can consume trackpad wheel gestures before the
    // browser applies its default nested-scroll behavior. Own the gesture on
    // the task pane just as the timeline does so either side remains usable.
    const handleTaskListWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return

      const pageSize = Math.max(taskList.clientWidth, taskList.clientHeight)
      const rawDeltaX =
        event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX
      const rawDeltaY =
        event.shiftKey && event.deltaX === 0 ? 0 : event.deltaY
      const locked = lockWheelToDominantAxis(
        normalizeWheelDelta(rawDeltaX, event.deltaMode, pageSize),
        normalizeWheelDelta(rawDeltaY, event.deltaMode, pageSize)
      )
      if (locked.deltaX === 0 && locked.deltaY === 0) return
      const canScrollHorizontally = canScrollGanttAxis(
        taskList.scrollLeft,
        taskList.scrollWidth,
        taskList.clientWidth,
        locked.deltaX
      )
      const canScrollVertically = canScrollGanttAxis(
        taskList.scrollTop,
        taskList.scrollHeight,
        taskList.clientHeight,
        locked.deltaY
      )
      if (!canScrollHorizontally && !canScrollVertically) {
        const workspace = taskList.closest<HTMLElement>(
          '[data-dashboard-scroll-region="schedule"]'
        )
        if (
          workspace &&
          canScrollGanttAxis(
            workspace.scrollTop,
            workspace.scrollHeight,
            workspace.clientHeight,
            locked.deltaY
          )
        ) {
          event.preventDefault()
          workspace.scrollTop += locked.deltaY
        }
        return
      }

      event.preventDefault()
      taskList.scrollLeft += locked.deltaX
      taskList.scrollTop += locked.deltaY
    }

    taskList.addEventListener("wheel", handleTaskListWheel, {
      passive: false,
    })
    return () => taskList.removeEventListener("wheel", handleTaskListWheel)
  }, [isMobile])

  const handleGanttContainerReady = useCallback(
    (container: HTMLElement | null) => {
      ganttContainerRef.current = container
      if (!container) return

      let position = scrollPositionRef.current
      if (scrollRestoredProjectRef.current !== projectId) {
        try {
          const stored = window.sessionStorage.getItem(scrollStorageKey)
          if (stored) {
            const parsed: unknown = JSON.parse(stored)
            if (
              parsed &&
              typeof parsed === "object" &&
              "left" in parsed &&
              "top" in parsed &&
              typeof parsed.left === "number" &&
              typeof parsed.top === "number" &&
              (!("anchorDate" in parsed) ||
                typeof parsed.anchorDate === "string")
            ) {
              const anchorDate =
                "anchorDate" in parsed &&
                typeof parsed.anchorDate === "string"
                  ? parsed.anchorDate
                  : null
              position = {
                left: parsed.left,
                top: parsed.top,
                ...(anchorDate ? { anchorDate } : {}),
              }
            }
          }
        } catch {
          // Use the current in-memory position.
        }
        scrollRestoredProjectRef.current = projectId
      }

      scrollPositionRef.current = position
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (position.anchorDate && scrollToDateRef.current) {
            scrollToDateRef.current(position.anchorDate)
          } else {
            container.scrollLeft = position.left
          }
          container.scrollTop = position.top
          if (taskListRef.current && shouldSynchronizeGanttPanes(scrollMode)) {
            taskListRef.current.scrollTop = synchronizedScrollTop(
              position.top,
              container.scrollHeight,
              container.clientHeight,
              taskListRef.current.scrollHeight,
              taskListRef.current.clientHeight
            )
          }
        })
      })
    },
    [projectId, scrollMode, scrollStorageKey]
  )

  const handleGanttScroll = useCallback(
    (position: GanttScrollPosition) => {
      const taskList = taskListRef.current
      const ganttContainer = ganttContainerRef.current
      if (taskList && ganttContainer && shouldSynchronizeGanttPanes(scrollMode)) {
        const synchronizedTop = synchronizedScrollTop(
          position.top,
          ganttContainer.scrollHeight,
          ganttContainer.clientHeight,
          taskList.scrollHeight,
          taskList.clientHeight
        )
        if (Math.abs(taskList.scrollTop - synchronizedTop) > 1) {
          taskList.scrollTop = synchronizedTop
        }
      }
      rememberScrollPosition(position)
    },
    [rememberScrollPosition, scrollMode]
  )

  const handleTaskListScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const top = event.currentTarget.scrollTop
      const ganttContainer = ganttContainerRef.current
      if (ganttContainer && shouldSynchronizeGanttPanes(scrollMode)) {
        const synchronizedTop = synchronizedScrollTop(
          top,
          event.currentTarget.scrollHeight,
          event.currentTarget.clientHeight,
          ganttContainer.scrollHeight,
          ganttContainer.clientHeight
        )
        if (Math.abs(ganttContainer.scrollTop - synchronizedTop) > 1) {
          ganttContainer.scrollTop = synchronizedTop
        }

        const itemIndex = ganttRowIndexForScrollTop(
          top,
          displayItemsRef.current.length
        )
        const item =
          itemIndex === null ? undefined : displayItemsRef.current[itemIndex]
        const itemKey =
          item?.type === "task" ? item.task.id : item?.phase ?? null
        if (item && itemKey && followedListItemRef.current !== itemKey) {
          followedListItemRef.current = itemKey
          if (item.type === "task") {
            scrollTaskIntoViewRef.current?.(item.task.id)
          } else {
            scrollToDateRef.current?.(item.group.startDate)
          }
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
    [rememberScrollPosition, scrollMode]
  )

  const openTaskEditor = useCallback(
    (task: FrappeTask) => {
      const scheduleTask = tasks.find((item) => item.id === task.id)
      if (!scheduleTask) return
      setFocusedTaskId(scheduleTask.id)
      setEditingTask(scheduleTask)
      setTaskFormOpen(true)
    },
    [tasks]
  )

  const focusTaskOnTimeline = useCallback((task: ScheduleTaskData) => {
    const container = ganttContainerRef.current
    if (!container) return
    const wrapper = container.querySelector<SVGGElement>(
      `.bar-wrapper[data-id="${CSS.escape(task.id)}"]`
    )
    const bar = wrapper?.querySelector<SVGRectElement>(".bar")
    if (!wrapper || !bar) return

    container
      .querySelectorAll(".bar-wrapper.schedule-focused")
      .forEach((element) => element.classList.remove("schedule-focused"))
    wrapper.classList.add("schedule-focused")

    const x = Number(bar.getAttribute("x") ?? 0)
    const width = Number(bar.getAttribute("width") ?? 0)
    const y = Number(bar.getAttribute("y") ?? 0)
    const height = Number(bar.getAttribute("height") ?? 0)
    container.scrollTo({
      left: Math.max(
        0,
        Math.min(
          x + width / 2 - container.clientWidth / 2,
          container.scrollWidth - container.clientWidth
        )
      ),
      top: Math.max(
        0,
        Math.min(
          y + height / 2 - container.clientHeight / 2,
          container.scrollHeight - container.clientHeight
        )
      ),
      behavior: "smooth",
    })
    setFocusedTaskId(task.id)
  }, [])

  const filteredTasks = tasks

  const { frappeTasks, displayItems } = useMemo(() => {
    const transformed = phaseGrouping
      ? transformWithPhaseGroups(
          filteredTasks as ScheduleTaskData[],
          dependencies as TaskDependencyData[],
          collapsedPhases,
        )
      : {
          frappeTasks: transformToFrappeTasks(
            filteredTasks as ScheduleTaskData[],
            dependencies as TaskDependencyData[],
          ),
          displayItems: filteredTasks.map(
            (task): DisplayItem => ({
              type: "task",
              task: task as ScheduleTaskData,
            })
          ),
        }

    if (!multipleProjects) return transformed
    const taskById = new Map(filteredTasks.map((task) => [task.id, task]))
    return {
      ...transformed,
      frappeTasks: transformed.frappeTasks.map((task) => {
        const scheduleTask = taskById.get(task.id)
        const project = scheduleTask
          ? projectById.get(scheduleTask.projectId)
          : null
        return project ? { ...task, projectColor: project.color } : task
      }),
    }
  }, [
    collapsedPhases,
    dependencies,
    filteredTasks,
    multipleProjects,
    phaseGrouping,
    projectById,
  ])
  displayItemsRef.current = displayItems

  const togglePhase = (phase: string) => {
    setCollapsedPhases((prev) => {
      const next = new Set(prev)
      if (next.has(phase)) next.delete(phase)
      else next.add(phase)
      return next
    })
  }

  const handleDateChange = useCallback(
    async (task: FrappeTask, start: Date, end: Date) => {
      if (task.id.startsWith("phase-")) return
      const startDate = format(start, "yyyy-MM-dd")
      const endDate = format(end, "yyyy-MM-dd")
      const scheduleTask = tasks.find(
        (candidate) => candidate.id === task.id
      )
      const taskExceptions = scheduleTask
        ? exceptions.filter(
            (exception) => exception.projectId === scheduleTask.projectId
          )
        : []
      const workdays = countBusinessDays(
        startDate,
        endDate,
        taskExceptions
      )

      const result = await updateTask(task.id, {
        startDate,
        workdays: Math.max(1, workdays),
      })

      if (result.success) {
        router.refresh()
      } else {
        toast.error(result.error)
      }
    },
    [exceptions, router, tasks]
  )

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

  const handleTaskVisibilityReady = useCallback(
    (handler: ((taskId: string) => void) | null) => {
      scrollTaskIntoViewRef.current = handler
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
      displayItems.map((item) =>
        item.type === "task"
          ? {
              startDate: item.task.startDate,
              endDate: item.task.endDateCalculated,
            }
          : {
              startDate: item.group.startDate,
              endDate: item.group.endDate,
            }
      ),
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
    if (taskList && shouldSynchronizeGanttPanes(scrollMode)) {
      taskList.scrollTop = synchronizedScrollTop(
        ganttTop,
        ganttContainer.scrollHeight,
        ganttContainer.clientHeight,
        taskList.scrollHeight,
        taskList.clientHeight
      )
    }

    const targetItem = displayItems[rowIndex]
    if (targetItem?.type === "task") {
      setFocusedTaskId(targetItem.task.id)
      followedListItemRef.current = targetItem.task.id
    } else if (targetItem) {
      followedListItemRef.current = targetItem.phase
    }

    // Start the smooth horizontal movement last. Assigning scrollTop after
    // scrollTo({ behavior: "smooth" }) cancels that animation in browsers.
    scrollToTodayRef.current?.()
  }, [displayItems, scrollMode])

  const taskTable = (
    <Table className="table-fixed">
      <TableHeader className="sticky top-0 z-10 bg-background">
        <TableRow className="h-[85px]">
          <TableHead className="text-xs">Title</TableHead>
          <TableHead className="text-xs w-[80px]">Start</TableHead>
          <TableHead className="text-xs w-[52px]">Days</TableHead>
          <TableHead className="text-xs w-[52px]">Done</TableHead>
          <TableHead className="w-[40px]" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {displayItems.map((item) => {
          if (item.type === "phase-header") {
            const { phase, group, collapsed } = item
            return (
              <TableRow
                key={`phase-${phase}`}
                className="h-[48px] max-h-[48px] bg-muted/40 cursor-pointer hover:bg-muted/60"
                onClick={() => togglePhase(phase)}
              >
                <TableCell
                  colSpan={collapsed ? 5 : 1}
                  className="h-[48px] py-0 text-xs font-medium"
                >
                  <span className="flex items-center gap-1">
                    {collapsed
                      ? <IconChevronRight className="size-3.5" />
                      : <IconChevronDown className="size-3.5" />}
                    {group.label}
                    <span className="text-muted-foreground font-normal ml-1">
                      ({group.tasks.length})
                    </span>
                    {collapsed && (
                      <span className="text-muted-foreground font-normal ml-auto text-[10px]">
                        {group.startDate.slice(5)} – {group.endDate.slice(5)}
                      </span>
                    )}
                  </span>
                </TableCell>
                {!collapsed && (
                  <>
                    <TableCell className="h-[48px] py-0 text-xs text-muted-foreground">
                      {group.startDate.slice(5)}
                    </TableCell>
                    <TableCell className="h-[48px] py-0 text-xs" />
                    <TableCell className="h-[48px] py-0 text-xs" />
                    <TableCell className="h-[48px] py-0" />
                  </>
                )}
              </TableRow>
            )
          }

          const { task } = item
          const taskProject = projectById.get(task.projectId)
          return (
            <TableRow
              key={task.id}
              data-schedule-task-id={task.id}
              className={cn(
                "h-[48px] max-h-[48px] cursor-pointer",
                focusedTaskId === task.id && "bg-accent"
              )}
              onClick={() => focusTaskOnTimeline(task)}
              title="Show this item on the timeline"
            >
              <TableCell className="h-[48px] py-0 text-xs truncate max-w-[140px]">
                <span
                  className={cn(
                    "flex min-w-0 items-center gap-1.5",
                    phaseGrouping && "pl-4"
                  )}
                >
                  {multipleProjects && taskProject && (
                    <span
                      className="inline-flex max-w-[72px] shrink-0 items-center gap-1 rounded-sm bg-muted px-1 py-0.5 text-[9px] font-medium"
                      title={projectScheduleLabel(taskProject)}
                    >
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: taskProject.color }}
                      />
                      <span className="truncate">
                        {taskProject.projectNumber ?? taskProject.name}
                      </span>
                    </span>
                  )}
                  <span className="truncate">{task.title}</span>
                </span>
              </TableCell>
              <TableCell className="h-[48px] py-0 text-xs text-muted-foreground">
                {task.startDate.slice(5)}
              </TableCell>
              <TableCell className="h-[48px] py-0 text-xs">
                {task.workdays}
              </TableCell>
              <TableCell className="h-[48px] py-0 text-xs tabular-nums">
                {effectivePercentComplete(task.status, task.percentComplete)}%
              </TableCell>
              <TableCell className="h-[48px] py-0">
                <div
                  className="flex items-center"
                  onClick={(event) => event.stopPropagation()}
                >
                  <ProjectTaskCreateButton
                    compact
                    projectId={task.projectId}
                    sourceLabel="Schedule item"
                    sourceRecordId={task.id}
                    sourceRecordNumber={null}
                    sourceHref={`/dashboard/projects/${task.projectId}/schedule`}
                    defaultTitle={`Follow up: ${task.title}`}
                    defaultDescription={`${task.phase} schedule item.`}
                    defaultAssigneeName={task.assignedTo}
                    defaultCompanyName={null}
                    defaultDueDate={task.endDateCalculated}
                    defaultPriority={task.isCriticalPath ? "high" : "normal"}
                    defaultTaskType="schedule_task"
                    assigneeOptions={assigneeOptions}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    aria-label={`Edit ${task.title}`}
                    onClick={() => {
                      setFocusedTaskId(task.id)
                      setEditingTask(task)
                      setTaskFormOpen(true)
                    }}
                  >
                    <IconPencil className="size-3" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          )
        })}
        {projectId && (
          <TableRow>
            <TableCell colSpan={5} className="py-1">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs w-full justify-start"
                onClick={() => {
                  setEditingTask(null)
                  setTaskFormOpen(true)
                }}
              >
                <IconPlus className="size-3 mr-1" />
                Add Schedule Item
              </Button>
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  )

  const scheduleKey = (
    <div className="absolute bottom-3 right-3 z-20 flex flex-col items-end gap-2">
      {showScheduleKey && (
        <div className="w-72 rounded-md border bg-background/95 p-3 shadow-lg backdrop-blur">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-xs font-medium">Schedule key</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-[11px]"
              onClick={() => setEditingScheduleKey((editing) => !editing)}
            >
              {editingScheduleKey ? "Done" : "Edit"}
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {DISPLAY_COLOR_OPTIONS.map((color) => (
              <div
                key={color.value}
                className="flex items-center gap-1.5 text-[11px] text-foreground"
              >
                {editingScheduleKey ? (
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        aria-label={`Choose ${color.label} schedule color`}
                        className="size-5 shrink-0 rounded-full"
                        style={{ backgroundColor: displayColorPalette[color.value] }}
                      />
                    </PopoverTrigger>
                    <PopoverContent side="top" align="start" className="w-44 p-2">
                      <p className="mb-2 text-xs font-medium">Choose {color.label}</p>
                      <div className="grid grid-cols-6 gap-1.5">
                        {COLOR_PICKER_SWATCHES.map((swatch) => (
                          <button
                            key={swatch}
                            type="button"
                            aria-label={`Set ${color.label} to ${swatch}`}
                            className={cn(
                              "size-5 rounded border border-border shadow-sm transition-transform hover:scale-110",
                              displayColorPalette[color.value] === swatch && "ring-2 ring-ring ring-offset-1"
                            )}
                            style={{ backgroundColor: swatch }}
                            onClick={() => updatePaletteColor(color.value, swatch)}
                          />
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                ) : (
                  <span
                    aria-hidden="true"
                    className="size-5 rounded-full"
                    style={{ backgroundColor: displayColorPalette[color.value] }}
                  />
                )}
                {editingScheduleKey ? (
                  <span
                    contentEditable
                    suppressContentEditableWarning
                    role="textbox"
                    tabIndex={0}
                    aria-label={`${color.label} schedule meaning`}
                    className="min-w-0 outline-none"
                    onBlur={(event) => {
                      const meaning = event.currentTarget.textContent?.trim()
                      updatePaletteLabel(color.value, meaning || DEFAULT_DISPLAY_COLOR_LABELS[color.value])
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur()
                    }}
                  >
                    {displayColorLabels[color.value]}
                  </span>
                ) : (
                  <span>{displayColorLabels[color.value]}</span>
                )}
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2 h-6 px-1.5 text-[10px]"
            onClick={() => {
              setDisplayColorPalette(DEFAULT_DISPLAY_COLOR_PALETTE)
              setDisplayColorLabels(DEFAULT_DISPLAY_COLOR_LABELS)
            }}
          >
            Reset personal colors
          </Button>
          <div className="mt-3 border-t pt-2 text-[10px] leading-snug text-muted-foreground">
            <p>Schedule item bars use their chosen display color; phase is grouping only.</p>
            <p className="mt-1">Critical Path View: blue is critical work; gray has float.</p>
          </div>
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 gap-1.5 bg-background/95 px-2.5 text-xs shadow-sm backdrop-blur"
        aria-expanded={showScheduleKey}
        onClick={() => setShowScheduleKey((open) => !open)}
      >
        Schedule key
        <IconChevronDown
          className={cn("size-3 transition-transform", showScheduleKey && "rotate-180")}
        />
      </Button>
    </div>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="mb-1 flex h-8 shrink-0 items-center"
        data-gantt-controls
      >
        <div className="flex items-center gap-1">
          {isMobile && (
            <Select
              value={mobileView}
              onValueChange={(value) =>
                setMobileView(value as "tasks" | "chart")
              }
            >
              <SelectTrigger className="h-8 w-20 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="chart">Chart</SelectItem>
                <SelectItem value="tasks">Items</SelectItem>
              </SelectContent>
            </Select>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label="Gantt controls"
                className="h-8 px-2 text-xs"
                size="sm"
                variant="outline"
              >
                <IconCalendar className="size-3.5" />
                <span className="ml-1.5">{viewMode}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuRadioGroup
                value={viewMode}
                onValueChange={(mode) =>
                  handleViewModeChange(mode as ViewMode)
                }
              >
                {(["Day", "Week", "Month", "Year"] as const).map((mode) => (
                  <DropdownMenuRadioItem key={mode} value={mode}>
                    {mode}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={scrollToToday}>Today</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => handleZoom("out")}
            title="Zoom out"
          >
            <IconZoomOut className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => handleZoom("in")}
            title="Zoom in"
          >
            <IconZoomIn className="size-3.5" />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label="Gantt settings"
                variant="ghost"
                size="icon"
                className="size-7"
              >
                <IconSettings className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <div className="space-y-2 px-2 py-1.5">
                <div className="border-b pb-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <span className="text-xs">Power-user scrolling</span>
                      <p className="text-[10px] leading-snug text-muted-foreground">
                        Scroll task list and chart independently.
                      </p>
                    </div>
                    <Switch
                      aria-label="Use power-user Gantt scrolling"
                      checked={scrollMode === "power"}
                      disabled={isSavingScrollMode}
                      onCheckedChange={handleScrollModeChange}
                      className="scale-75"
                    />
                  </div>
                  <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
                    Default keeps rows aligned. Shift + wheel pans the timeline horizontally in either mode.
                  </p>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs">Group by Phase</span>
                  <Switch
                    checked={phaseGrouping}
                    onCheckedChange={(checked) => {
                      setPhaseGrouping(checked)
                      onGroupByPhaseChange?.(checked)
                    }}
                    className="scale-75"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs">Critical Path View</span>
                  <Switch
                    checked={showCriticalPath}
                    onCheckedChange={setShowCriticalPath}
                    className="scale-75"
                  />
                </div>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Main content */}
      {isMobile ? (
        <div className="flex flex-col flex-1 min-h-0">
          {mobileView === "tasks" ? (
            <div className="border rounded-md flex-1 min-h-0 overflow-auto">
              {taskTable}
            </div>
          ) : (
            <div className="relative min-w-0 flex-1 min-h-0 overflow-hidden border">
              <GanttChart
                tasks={frappeTasks}
                viewMode={viewMode}
                columnWidth={columnWidth}
                panMode={panMode}
                onDateChange={handleDateChange}
                criticalPathMode={showCriticalPath}
                displayColorPalette={displayColorPalette}
                onZoom={handleZoom}
                onTaskDoubleClick={openTaskEditor}
                onContainerReady={handleGanttContainerReady}
                onScrollPositionChange={handleGanttScroll}
                onTodayScrollReady={handleTodayScrollReady}
                onDateScrollReady={handleDateScrollReady}
                onTaskVisibilityReady={handleTaskVisibilityReady}
              />
              {scheduleKey}
            </div>
          )}
        </div>
      ) : (
        <ResizablePanelGroup
          orientation="horizontal"
          className="min-w-0 flex-1 min-h-[300px] overflow-hidden border"
        >
          <ResizablePanel defaultSize="30%" minSize="20%">
            <div
              ref={taskListRef}
              className="schedule-gantt-task-list h-full min-w-0 overflow-auto"
              onScroll={handleTaskListScroll}
            >
              {taskTable}
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize="70%" minSize="40%">
            <div className="relative h-full min-w-0 overflow-hidden">
              <GanttChart
                tasks={frappeTasks}
                viewMode={viewMode}
                columnWidth={columnWidth}
                panMode={panMode}
                onDateChange={handleDateChange}
                criticalPathMode={showCriticalPath}
                displayColorPalette={displayColorPalette}
                onZoom={handleZoom}
                onTaskDoubleClick={openTaskEditor}
                onContainerReady={handleGanttContainerReady}
                onScrollPositionChange={handleGanttScroll}
                onTodayScrollReady={handleTodayScrollReady}
                onDateScrollReady={handleDateScrollReady}
                onTaskVisibilityReady={handleTaskVisibilityReady}
              />
              {scheduleKey}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      )}

      {(editingTask || projectId) && (
        <ScheduleItemFormDialog
          open={taskFormOpen}
          onOpenChange={setTaskFormOpen}
          projectId={editingTask?.projectId ?? projectId ?? ""}
          editingTask={editingTask}
          allTasks={tasks.filter(
            (task) =>
              task.projectId === (editingTask?.projectId ?? projectId)
          )}
          dependencies={dependencies}
          exceptions={exceptions.filter(
            (exception) =>
              exception.projectId === (editingTask?.projectId ?? projectId)
          )}
          assigneeOptions={assigneeOptions}
        />
      )}
    </div>
  )
}
