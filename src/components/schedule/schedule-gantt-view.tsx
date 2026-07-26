"use client"

import { useState, useCallback, useEffect } from "react"
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
import { ScheduleItemFormDialog } from "./schedule-item-form-dialog"
import {
  transformToFrappeTasks,
  transformWithPhaseGroups,
} from "@/lib/schedule/gantt-transform"
import type { DisplayItem, FrappeTask } from "@/lib/schedule/gantt-transform"
import { updateTask } from "@/app/actions/schedule"
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

type ViewMode = "Day" | "Week" | "Month"

const COLOR_PICKER_SWATCHES = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#06b6d4",
  "#3b82f6", "#6366f1", "#a855f7", "#ec4899", "#6b7280", "#111827",
] as const

interface ScheduleGanttViewProps {
  readonly projectId: string
  readonly tasks: readonly ScheduleTaskData[]
  readonly dependencies: readonly TaskDependencyData[]
  readonly exceptions: readonly WorkdayExceptionData[]
  readonly assigneeOptions: readonly ProjectTaskAssigneeOption[]
}

export function ScheduleGanttView({
  projectId,
  tasks,
  dependencies,
  exceptions,
  assigneeOptions,
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
  const [mobileView, setMobileView] = useState<"tasks" | "chart">("chart")
  const [panMode] = useState(false)

  const [hasLoadedPalette, setHasLoadedPalette] = useState(false)

  useEffect(() => {
    try {
      const storedPalette = window.localStorage.getItem(schedulePaletteStorageKey(projectId))
      const storedLabels = window.localStorage.getItem(schedulePaletteLabelStorageKey(projectId))
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
  }, [projectId])

  useEffect(() => {
    if (!hasLoadedPalette) return
    window.localStorage.setItem(
      schedulePaletteStorageKey(projectId),
      JSON.stringify(displayColorPalette)
    )
    window.localStorage.setItem(
      schedulePaletteLabelStorageKey(projectId),
      JSON.stringify(displayColorLabels)
    )
  }, [displayColorLabels, displayColorPalette, hasLoadedPalette, projectId])

  const updatePaletteColor = (color: DisplayColor, value: string) => {
    setDisplayColorPalette((palette) => ({ ...palette, [color]: value }))
  }

  const updatePaletteLabel = (color: DisplayColor, value: string) => {
    setDisplayColorLabels((labels) => ({ ...labels, [color]: value }))
  }

  const defaultWidths: Record<ViewMode, number> = {
    Day: 38, Week: 140, Month: 120,
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

  const filteredTasks = tasks

  const { frappeTasks, displayItems } = phaseGrouping
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
          (task): DisplayItem => ({ type: "task", task: task as ScheduleTaskData })
        ),
      }

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
      const workdays = countBusinessDays(startDate, endDate, exceptions)

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

  const scrollToToday = () => {
    const todayEl = document.querySelector(
      ".gantt-container .today-highlight"
    )
    if (todayEl) {
      todayEl.scrollIntoView({ behavior: "smooth", inline: "center" })
    }
  }

  const taskTable = (
    <Table>
      <TableHeader>
        <TableRow>
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
                className="bg-muted/40 cursor-pointer hover:bg-muted/60"
                onClick={() => togglePhase(phase)}
              >
                <TableCell
                  colSpan={collapsed ? 5 : 1}
                  className="text-xs py-1.5 font-medium"
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
                    <TableCell className="text-xs py-1.5 text-muted-foreground">
                      {group.startDate.slice(5)}
                    </TableCell>
                    <TableCell className="text-xs py-1.5" />
                    <TableCell className="text-xs py-1.5" />
                    <TableCell className="py-1.5" />
                  </>
                )}
              </TableRow>
            )
          }

          const { task } = item
          return (
            <TableRow key={task.id}>
              <TableCell className="text-xs py-1.5 truncate max-w-[140px]">
                <span className={phaseGrouping ? "pl-4" : ""}>
                  {task.title}
                </span>
              </TableCell>
              <TableCell className="text-xs py-1.5 text-muted-foreground">
                {task.startDate.slice(5)}
              </TableCell>
              <TableCell className="text-xs py-1.5">
                {task.workdays}
              </TableCell>
              <TableCell className="text-xs py-1.5 tabular-nums">
                {effectivePercentComplete(task.status, task.percentComplete)}%
              </TableCell>
              <TableCell className="py-1.5">
                <div className="flex items-center">
                  <ProjectTaskCreateButton
                    compact
                    projectId={projectId}
                    sourceLabel="Schedule item"
                    sourceRecordId={task.id}
                    sourceRecordNumber={null}
                    sourceHref={`/dashboard/projects/${projectId}/schedule`}
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
                    onClick={() => {
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
                <SelectItem value="tasks">Schedule Items</SelectItem>
              </SelectContent>
            </Select>
          )}

          {/* Day / Week / Month */}
          <div className="flex items-center rounded-md border bg-muted/40 p-0.5">
            {(["Day", "Week", "Month"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => handleViewModeChange(mode)}
                className={cn(
                  "px-2 py-1 text-xs font-medium rounded-sm transition-all",
                  viewMode === mode
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {mode}
              </button>
            ))}
          </div>

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
              <Button variant="ghost" size="icon" className="size-7">
                <IconSettings className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <div className="px-2 py-1.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs">Group by Phase</span>
                  <Switch
                    checked={phaseGrouping}
                    onCheckedChange={setPhaseGrouping}
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
            <div className="border rounded-md flex-1 min-h-0 overflow-auto">
              {taskTable}
            </div>
          ) : (
            <div className="relative border rounded-md flex-1 min-h-0 overflow-hidden p-2">
              <GanttChart
                tasks={frappeTasks}
                viewMode={viewMode}
                columnWidth={columnWidth}
                panMode={panMode}
                onDateChange={handleDateChange}
                criticalPathMode={showCriticalPath}
                displayColorPalette={displayColorPalette}
                onZoom={handleZoom}
              />
              {scheduleKey}
            </div>
          )}
        </div>
      ) : (
        <ResizablePanelGroup
          orientation="horizontal"
          className="border rounded-md flex-1 min-h-[300px]"
        >
          <ResizablePanel defaultSize={30} minSize={20}>
            <div className="h-full overflow-auto">
              {taskTable}
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={70} minSize={40}>
            <div className="relative h-full overflow-hidden p-2">
              <GanttChart
                tasks={frappeTasks}
                viewMode={viewMode}
                columnWidth={columnWidth}
                panMode={panMode}
                onDateChange={handleDateChange}
                criticalPathMode={showCriticalPath}
                displayColorPalette={displayColorPalette}
                onZoom={handleZoom}
              />
              {scheduleKey}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      )}

      <ScheduleItemFormDialog
        open={taskFormOpen}
        onOpenChange={setTaskFormOpen}
        projectId={projectId}
        editingTask={editingTask}
        allTasks={tasks}
        dependencies={dependencies}
        exceptions={exceptions}
        assigneeOptions={assigneeOptions}
      />
    </div>
  )
}
