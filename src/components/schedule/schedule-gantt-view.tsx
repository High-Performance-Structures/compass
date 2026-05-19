"use client"

import { useState, useCallback } from "react"
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
import { TaskFormDialog } from "./task-form-dialog"
import {
  transformToFrappeTasks,
  transformWithPhaseGroups,
} from "@/lib/schedule/gantt-transform"
import type { DisplayItem, FrappeTask } from "@/lib/schedule/gantt-transform"
import { updateTask } from "@/app/actions/schedule"
import { countBusinessDays } from "@/lib/schedule/business-days"
import type {
  ScheduleTaskData,
  TaskDependencyData,
} from "@/lib/schedule/types"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { format } from "date-fns"

type ViewMode = "Day" | "Week" | "Month"

interface ScheduleGanttViewProps {
  readonly projectId: string
  readonly tasks: readonly ScheduleTaskData[]
  readonly dependencies: readonly TaskDependencyData[]
}

export function ScheduleGanttView({
  projectId,
  tasks,
  dependencies,
}: ScheduleGanttViewProps) {
  const router = useRouter()
  const isMobile = useIsMobile()
  const [viewMode, setViewMode] = useState<ViewMode>("Week")
  const [phaseGrouping, setPhaseGrouping] = useState(true)
  const [collapsedPhases, setCollapsedPhases] = useState<Set<string>>(
    new Set()
  )
  const [showCriticalPath, setShowCriticalPath] = useState(false)
  const [taskFormOpen, setTaskFormOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<ScheduleTaskData | null>(
    null
  )
  const [mobileView, setMobileView] = useState<"tasks" | "chart">("chart")
  const [panMode] = useState(false)

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

  const filteredTasks = showCriticalPath
    ? tasks.filter((t) => t.isCriticalPath)
    : tasks

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
      const workdays = countBusinessDays(startDate, endDate)

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
    [router]
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
                  colSpan={collapsed ? 4 : 1}
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
              <TableCell className="py-1.5">
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
            <div className="border rounded-md flex-1 min-h-0 overflow-auto">
              {taskTable}
            </div>
          ) : (
            <div className="border rounded-md flex-1 min-h-0 overflow-hidden p-2">
              <GanttChart
                tasks={frappeTasks}
                viewMode={viewMode}
                columnWidth={columnWidth}
                panMode={panMode}
                onDateChange={handleDateChange}
                onZoom={handleZoom}
              />
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
            <div className="h-full overflow-hidden p-2">
              <GanttChart
                tasks={frappeTasks}
                viewMode={viewMode}
                columnWidth={columnWidth}
                panMode={panMode}
                onDateChange={handleDateChange}
                onZoom={handleZoom}
              />
            </div>
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
      />
    </div>
  )
}
