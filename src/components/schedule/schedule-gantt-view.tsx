"use client"

import { useState, useCallback, useEffect, useMemo, useRef } from "react"
import type { UIEvent } from "react"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
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
  IconZoomIn,
  IconZoomOut,
  IconPalette,
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
import { GanttChart } from "./gantt-chart"
import type { GanttScrollPosition } from "./gantt-chart"
import type { GanttBaselineTask } from "./gantt-chart"
import { TaskFormDialog } from "./task-form-dialog"
import {
  transformToFrappeTasks,
  transformWithPhaseGroups,
} from "@/lib/schedule/gantt-transform"
import type { DisplayItem, FrappeTask } from "@/lib/schedule/gantt-transform"
import { updateTask } from "@/app/actions/schedule"
import { countBusinessDays } from "@/lib/schedule/business-days"
import type {
  SchedulePhaseOption,
  ScheduleTaskData,
  TaskDependencyData,
  WorkdayExceptionData,
} from "@/lib/schedule/types"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { format } from "date-fns"
import type { ProjectTaskAssigneeOption } from "@/app/actions/project-contacts"
import type { ScheduleAssigneeOption } from "@/app/actions/schedule-assignees"
import {
  DEFAULT_SCHEDULE_COLOR_PREFERENCES,
  SCHEDULE_COLOR_PALETTES,
  isScheduleColorMode,
  isScheduleColorPalette,
  schedulePhaseColor,
  scheduleTaskColor,
} from "@/lib/schedule/schedule-colors"
import type {
  ScheduleColorPalette,
  ScheduleColorPreferences,
} from "@/lib/schedule/schedule-colors"

type ViewMode = "Day" | "Week" | "Month"

interface ScheduleGanttViewProps {
  readonly projectId: string
  readonly tasks: readonly ScheduleTaskData[]
  readonly dependencies: readonly TaskDependencyData[]
  readonly exceptions: readonly WorkdayExceptionData[]
  readonly baselineTasks?: readonly GanttBaselineTask[]
  readonly baselineName?: string | null
  readonly phaseOptions: readonly SchedulePhaseOption[]
  readonly taskAssigneeOptions?: readonly ProjectTaskAssigneeOption[]
  readonly scheduleAssigneeOptions?: readonly ScheduleAssigneeOption[]
}

export function ScheduleGanttView({
  projectId,
  tasks,
  dependencies,
  exceptions,
  baselineTasks = [],
  baselineName = null,
  phaseOptions,
  taskAssigneeOptions = [],
  scheduleAssigneeOptions = [],
}: ScheduleGanttViewProps) {
  const router = useRouter()
  const isMobile = useIsMobile()
  const viewMode: ViewMode = "Week"
  const [phaseGrouping, setPhaseGrouping] = useState(true)
  const [collapsedPhases, setCollapsedPhases] = useState<Set<string>>(
    new Set()
  )
  const [showCriticalPath, setShowCriticalPath] = useState(false)
  const [taskFormOpen, setTaskFormOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<ScheduleTaskData | null>(
    null
  )
  const [contextTask, setContextTask] = useState<ScheduleTaskData | null>(null)
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null)
  const [mobileView, setMobileView] = useState<"tasks" | "chart">("chart")
  const [panMode] = useState(false)
  const taskListRef = useRef<HTMLDivElement>(null)
  const ganttContainerRef = useRef<HTMLElement | null>(null)
  const scrollPositionRef = useRef<GanttScrollPosition>({ left: 0, top: 0 })
  const scrollStorageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollToTodayRef = useRef<(() => void) | null>(null)
  const scrollToDateRef = useRef<((date: string) => void) | null>(null)
  const scrollRestoredProjectRef = useRef<string | null>(null)
  const scrollStorageKey = `compass:schedule-scroll:${projectId}`
  const colorStorageKey = `compass:schedule-colors:${projectId}`
  const [colorPreferences, setColorPreferences] =
    useState<ScheduleColorPreferences>(DEFAULT_SCHEDULE_COLOR_PREFERENCES)
  const colorPreferencesLoadedKeyRef = useRef<string | null>(null)

  const [columnWidth, setColumnWidth] = useState(140)

  const handleZoom = useCallback((direction: "in" | "out") => {
    setColumnWidth((prev) => {
      const next = direction === "in" ? prev * 1.3 : prev / 1.3
      return Math.round(Math.min(300, Math.max(20, next)))
    })
  }, [])

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
          // The in-memory position still preserves the current visit.
        }
      }, 150)
    },
    [scrollStorageKey]
  )

  useEffect(() => {
    return () => {
      if (scrollStorageTimerRef.current) {
        clearTimeout(scrollStorageTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(colorStorageKey)
      if (stored) {
        const parsed: unknown = JSON.parse(stored)
        if (
          parsed &&
          typeof parsed === "object" &&
          "mode" in parsed &&
          "palette" in parsed &&
          typeof parsed.mode === "string" &&
          typeof parsed.palette === "string" &&
          isScheduleColorMode(parsed.mode) &&
          isScheduleColorPalette(parsed.palette)
        ) {
          setColorPreferences({ mode: parsed.mode, palette: parsed.palette })
        }
      }
    } catch {
      setColorPreferences(DEFAULT_SCHEDULE_COLOR_PREFERENCES)
    }
    colorPreferencesLoadedKeyRef.current = colorStorageKey
  }, [colorStorageKey])

  useEffect(() => {
    if (colorPreferencesLoadedKeyRef.current !== colorStorageKey) return
    try {
      window.localStorage.setItem(
        colorStorageKey,
        JSON.stringify(colorPreferences)
      )
    } catch {
      // The active schedule still uses the selected colors for this visit.
    }
  }, [colorPreferences, colorStorageKey])

  const restoreScrollPosition = useCallback(
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
                ...(anchorDate
                  ? { anchorDate }
                  : {}),
              }
            }
          }
        } catch {
          // Fall back to the current in-memory position.
        }
        scrollRestoredProjectRef.current = projectId
      }

      scrollPositionRef.current = position
      requestAnimationFrame(() => {
        if (position.anchorDate && scrollToDateRef.current) {
          scrollToDateRef.current(position.anchorDate)
        } else {
          container.scrollLeft = position.left
        }
        container.scrollTop = position.top
        if (taskListRef.current) taskListRef.current.scrollTop = position.top
      })
    },
    [projectId, scrollStorageKey]
  )

  const handleGanttScroll = useCallback(
    (position: GanttScrollPosition) => {
      if (taskListRef.current && taskListRef.current.scrollTop !== position.top) {
        taskListRef.current.scrollTop = position.top
      }
      rememberScrollPosition(position)
    },
    [rememberScrollPosition]
  )

  const handleTaskListScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const top = event.currentTarget.scrollTop
      const ganttContainer = ganttContainerRef.current
      if (ganttContainer && ganttContainer.scrollTop !== top) {
        ganttContainer.scrollTop = top
      }
      rememberScrollPosition({
        left: ganttContainer?.scrollLeft ?? scrollPositionRef.current.left,
        top,
        ...(scrollPositionRef.current.anchorDate
          ? { anchorDate: scrollPositionRef.current.anchorDate }
          : {}),
      })
    },
    [rememberScrollPosition]
  )

  const openTaskEditor = useCallback(
    (task: FrappeTask) => {
      const scheduleTask = tasks.find((item) => item.id === task.id)
      if (!scheduleTask) return
      setEditingTask(scheduleTask)
      setTaskFormOpen(true)
    },
    [tasks]
  )

  const handleTaskContextMenu = useCallback(
    (task: FrappeTask) => {
      const scheduleTask = tasks.find((item) => item.id === task.id)
      setContextTask(scheduleTask ?? null)
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
    const left = x + width / 2 - container.clientWidth / 2
    const top = y + height / 2 - container.clientHeight / 2
    container.scrollTo({
      left: Math.max(0, Math.min(left, container.scrollWidth - container.clientWidth)),
      top: Math.max(0, Math.min(top, container.scrollHeight - container.clientHeight)),
      behavior: "smooth",
    })
    setFocusedTaskId(task.id)
  }, [])

  const filteredTasks = useMemo(
    () => (showCriticalPath ? tasks.filter((task) => task.isCriticalPath) : tasks),
    [showCriticalPath, tasks]
  )

  const { frappeTasks, displayItems } = useMemo(
    () =>
      phaseGrouping
        ? transformWithPhaseGroups(
            [...filteredTasks],
            [...dependencies],
            collapsedPhases,
            (task) => scheduleTaskColor(task, colorPreferences),
            (phase) => schedulePhaseColor(phase, colorPreferences.palette)
          )
        : {
            frappeTasks: transformToFrappeTasks(
              [...filteredTasks],
              [...dependencies],
              (task) => scheduleTaskColor(task, colorPreferences)
            ),
            displayItems: filteredTasks.map(
              (task): DisplayItem => ({ type: "task", task })
            ),
          },
    [collapsedPhases, colorPreferences, dependencies, filteredTasks, phaseGrouping]
  )

  const togglePhase = (phase: string) => {
    setCollapsedPhases((prev) => {
      const next = new Set(prev)
      if (next.has(phase)) next.delete(phase)
      else next.add(phase)
      return next
    })
  }

  const toggleClientView = () => {
    if (phaseGrouping && collapsedPhases.size > 0) {
      setPhaseGrouping(false)
      setCollapsedPhases(new Set())
    } else {
      setPhaseGrouping(true)
      const allPhases = new Set(
        filteredTasks.map((t) => t.phase || "uncategorized")
      )
      setCollapsedPhases(allPhases)
    }
  }

  const handleDateChange = useCallback(
    async (task: FrappeTask, start: Date, end: Date) => {
      if (task.id.startsWith("phase-")) return
      const startDate = format(start, "yyyy-MM-dd")
      const endDate = format(end, "yyyy-MM-dd")
      const workdays = countBusinessDays(
        startDate,
        endDate,
        [...exceptions]
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
    [exceptions, router]
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

  const scrollToToday = useCallback(() => {
    scrollToTodayRef.current?.()
  }, [])

  const taskTable = (
    <Table className="table-fixed">
      <TableHeader className="sticky top-0 z-10 bg-background">
        <TableRow className="h-[85px]">
          <TableHead className="text-xs">Title</TableHead>
          <TableHead className="text-xs w-[80px]">Start</TableHead>
          <TableHead className="text-xs w-[52px]">Days</TableHead>
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
                  colSpan={collapsed ? 4 : 1}
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
                    <TableCell className="h-[48px] py-0" />
                  </>
                )}
              </TableRow>
            )
          }

          const { task } = item
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
                <span className={phaseGrouping ? "pl-4" : ""}>
                  {task.title}
                </span>
              </TableCell>
              <TableCell className="h-[48px] py-0 text-xs text-muted-foreground">
                {task.startDate.slice(5)}
              </TableCell>
              <TableCell className="h-[48px] py-0 text-xs">
                {task.workdays}
              </TableCell>
              <TableCell className="h-[48px] py-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  onClick={(event) => {
                    event.stopPropagation()
                    setFocusedTaskId(task.id)
                    setEditingTask(task)
                    setTaskFormOpen(true)
                  }}
                >
                  <IconPencil className="size-3" />
                </Button>
              </TableCell>
            </TableRow>
          )
        })}
        <TableRow>
          <TableCell colSpan={4} className="py-1">
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
              Add Task
            </Button>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  )

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Compact controls row */}
      <div className="flex items-center gap-2 mb-2">
        <div className="flex items-center gap-1.5">
          {isMobile && (
            <Select
              value={mobileView}
              onValueChange={(val) =>
                setMobileView(val as "tasks" | "chart")
              }
            >
              <SelectTrigger className="h-7 w-20 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="chart">Chart</SelectItem>
                <SelectItem value="tasks">Tasks</SelectItem>
              </SelectContent>
            </Select>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={scrollToToday}
            className="h-7 px-2.5 text-xs"
          >
            Today
          </Button>
        </div>

        <div className="flex items-center gap-1 ml-auto">
          {baselineName && (
            <span className="hidden items-center gap-1.5 text-xs text-muted-foreground md:flex">
              <span className="w-5 border-t-2 border-dashed border-foreground/60" />
              {baselineName}
            </span>
          )}
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
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 px-2"
                title="Schedule colors and display"
              >
                <IconPalette className="size-3.5" />
                <span className="hidden text-xs sm:inline">Colors</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <div className="px-2 py-1.5 space-y-2">
                <div className="flex items-center gap-1.5 border-b pb-2 text-xs font-medium">
                  <IconPalette className="size-3.5" />
                  Schedule colors
                </div>
                <div>
                  <span className="mb-1 block text-[11px] text-muted-foreground">Color by</span>
                  <div className="grid grid-cols-2 gap-1">
                    {(["phase", "status"] as const).map((mode) => (
                      <Button
                        key={mode}
                        type="button"
                        size="sm"
                        variant={colorPreferences.mode === mode ? "default" : "outline"}
                        className="h-7 text-xs capitalize"
                        onClick={() =>
                          setColorPreferences((current) => ({ ...current, mode }))
                        }
                      >
                        {mode}
                      </Button>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="mb-1 block text-[11px] text-muted-foreground">Palette</span>
                  <div className="space-y-1">
                    {(
                      [
                        ["hps", "HPS"],
                        ["jobsite", "Jobsite"],
                        ["high_contrast", "High contrast"],
                      ] as const satisfies readonly (readonly [ScheduleColorPalette, string])[]
                    ).map(([palette, label]) => (
                      <button
                        key={palette}
                        type="button"
                        className={cn(
                          "flex h-8 w-full items-center gap-2 border px-2 text-xs",
                          colorPreferences.palette === palette
                            ? "border-primary bg-accent font-medium"
                            : "border-transparent hover:bg-accent"
                        )}
                        onClick={() =>
                          setColorPreferences((current) => ({ ...current, palette }))
                        }
                      >
                        <span className="flex gap-0.5" aria-hidden="true">
                          {SCHEDULE_COLOR_PALETTES[palette].slice(0, 5).map((color) => (
                            <span
                              key={color}
                              className="size-3 border border-black/10"
                              style={{ backgroundColor: color }}
                            />
                          ))}
                        </span>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="border-t pt-2" />
                <div className="flex items-center justify-between">
                  <span className="text-xs">Group by Phase</span>
                  <Switch
                    checked={phaseGrouping}
                    onCheckedChange={setPhaseGrouping}
                    className="scale-75"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs">Critical Path</span>
                  <Switch
                    checked={showCriticalPath}
                    onCheckedChange={setShowCriticalPath}
                    className="scale-75"
                  />
                </div>
                <Button
                  variant={
                    phaseGrouping && collapsedPhases.size > 0
                      ? "default"
                      : "outline"
                  }
                  size="sm"
                  onClick={toggleClientView}
                  className="w-full mt-1 text-xs h-7"
                >
                  Client View
                </Button>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Main content */}
      {isMobile ? (
        <div className="flex flex-col flex-1 min-h-0">
          {mobileView === "tasks" ? (
            <div className="flex-1 min-h-0 overflow-auto border">
              {taskTable}
            </div>
          ) : (
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <div className="min-w-0 flex-1 min-h-0 overflow-hidden border">
                  <GanttChart
                    tasks={frappeTasks}
                    viewMode={viewMode}
                    columnWidth={columnWidth}
                    panMode={panMode}
                    onDateChange={handleDateChange}
                    onZoom={handleZoom}
                    onTaskClick={openTaskEditor}
                    onTaskDoubleClick={openTaskEditor}
                    onTaskContextMenu={handleTaskContextMenu}
                    onContainerReady={restoreScrollPosition}
                    onScrollPositionChange={handleGanttScroll}
                    onTodayScrollReady={handleTodayScrollReady}
                    onDateScrollReady={handleDateScrollReady}
                    baselineTasks={baselineTasks}
                  />
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuLabel className="max-w-64 truncate">
                  {contextTask?.title ?? "Schedule item"}
                </ContextMenuLabel>
                <ContextMenuSeparator />
                <ContextMenuItem
                  disabled={!contextTask}
                  onSelect={() => {
                    if (!contextTask) return
                    setEditingTask(contextTask)
                    setTaskFormOpen(true)
                  }}
                >
                  <IconPencil className="size-4" />
                  Edit schedule item
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          )}
        </div>
      ) : (
        <ResizablePanelGroup
          orientation="horizontal"
          className="min-w-0 flex-1 min-h-[300px] overflow-hidden border"
        >
          <ResizablePanel defaultSize={30} minSize={20}>
            <div
              ref={taskListRef}
              className="h-full min-w-0 overflow-auto"
              onScroll={handleTaskListScroll}
            >
              {taskTable}
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={70} minSize={40}>
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <div className="h-full min-w-0 overflow-hidden">
                  <GanttChart
                    tasks={frappeTasks}
                    viewMode={viewMode}
                    columnWidth={columnWidth}
                    panMode={panMode}
                    onDateChange={handleDateChange}
                    onZoom={handleZoom}
                    onTaskClick={openTaskEditor}
                    onTaskDoubleClick={openTaskEditor}
                    onTaskContextMenu={handleTaskContextMenu}
                    onContainerReady={restoreScrollPosition}
                    onScrollPositionChange={handleGanttScroll}
                    onTodayScrollReady={handleTodayScrollReady}
                    onDateScrollReady={handleDateScrollReady}
                    baselineTasks={baselineTasks}
                  />
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuLabel className="max-w-64 truncate">
                  {contextTask?.title ?? "Schedule item"}
                </ContextMenuLabel>
                <ContextMenuSeparator />
                <ContextMenuItem
                  disabled={!contextTask}
                  onSelect={() => {
                    if (!contextTask) return
                    setEditingTask(contextTask)
                    setTaskFormOpen(true)
                  }}
                >
                  <IconPencil className="size-4" />
                  Edit schedule item
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          </ResizablePanel>
        </ResizablePanelGroup>
      )}

      <TaskFormDialog
        open={taskFormOpen}
        onOpenChange={setTaskFormOpen}
        projectId={projectId}
        editingTask={editingTask}
        allTasks={tasks}
        dependencies={dependencies}
        phaseOptions={phaseOptions}
        assigneeOptions={taskAssigneeOptions}
        scheduleAssigneeOptions={scheduleAssigneeOptions}
      />
    </div>
  )
}
