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
  IconUsers,
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
  projectId: string
  tasks: ScheduleTaskData[]
  dependencies: TaskDependencyData[]
}

export function ScheduleGanttView({
  projectId,
  tasks,
  dependencies,
}: ScheduleGanttViewProps) {
  const router = useRouter()
  const isMobile = useIsMobile()
  const [viewMode, setViewMode] = useState<ViewMode>("Week")
  const [phaseGrouping, setPhaseGrouping] = useState<"off" | "grouped">("off")
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

  const isGrouped = phaseGrouping === "grouped"
  const { frappeTasks, displayItems } = isGrouped
    ? transformWithPhaseGroups(filteredTasks, dependencies, collapsedPhases)
    : {
        frappeTasks: transformToFrappeTasks(filteredTasks, dependencies),
        displayItems: filteredTasks.map(
          (task): DisplayItem => ({ type: "task", task })
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
    if (phaseGrouping === "grouped") {
      setPhaseGrouping("off")
      setCollapsedPhases(new Set())
    } else {
      setPhaseGrouping("grouped")
      const allPhases = new Set(filteredTasks.map((t) => t.phase || "uncategorized"))
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
    const todayEl = document.querySelector(".gantt-container .today-highlight")
    if (todayEl) {
      todayEl.scrollIntoView({ behavior: "smooth", inline: "center" })
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          {isMobile && (
            <Select
              value={mobileView}
              onValueChange={(val) => setMobileView(val as "tasks" | "chart")}
            >
              <SelectTrigger className="h-9 w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="chart">Chart</SelectItem>
                <SelectItem value="tasks">Tasks</SelectItem>
              </SelectContent>
            </Select>
          )}
          <Select
            value={viewMode}
            onValueChange={(val) => handleViewModeChange(val as ViewMode)}
          >
            <SelectTrigger className="h-9 w-24 sm:w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Day">Day</SelectItem>
              <SelectItem value="Week">Week</SelectItem>
              <SelectItem value="Month">Month</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={scrollToToday}
            className="h-9 px-3"
          >
            Today
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="size-9"
              onClick={() => handleZoom("out")}
              title="Zoom out"
            >
              <IconZoomOut className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-9"
              onClick={() => handleZoom("in")}
              title="Zoom in"
            >
              <IconZoomIn className="size-4" />
            </Button>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9">
                <IconUsers className="size-4 sm:mr-2" />
                <span className="hidden sm:inline">Options</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <div className="px-2 py-1.5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm">Group by Phases</span>
                  <Switch
                    checked={isGrouped}
                    onCheckedChange={(checked) => {
                      setPhaseGrouping(checked ? "grouped" : "off")
                      if (!checked) setCollapsedPhases(new Set())
                    }}
                    className="scale-75"
                  />
                </div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm">Show Critical Path</span>
                  <Switch
                    checked={showCriticalPath}
                    onCheckedChange={setShowCriticalPath}
                    className="scale-75"
                  />
                </div>
                <Button
                  variant={phaseGrouping === "grouped" && collapsedPhases.size > 0 ? "default" : "outline"}
                  size="sm"
                  onClick={toggleClientView}
                  className="w-full mt-2"
                >
                  <IconUsers className="size-4 mr-2" />
                  <span className="hidden sm:inline">Client View</span>
                  <span className="sm:hidden">Client</span>
                </Button>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {isMobile ? (
        <div className="flex flex-col flex-1 min-h-0">
          {mobileView === "tasks" ? (
            <div className="border rounded-md flex-1 min-h-0 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Title</TableHead>
                    <TableHead className="text-xs w-[80px]">
                      Start
                    </TableHead>
                    <TableHead className="text-xs w-[60px]">
                      Days
                    </TableHead>
                    <TableHead className="w-[60px]" />
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
                        <TableCell className="text-xs py-1.5 truncate max-w-[120px]">
                          <span className={isGrouped ? "pl-4" : ""}>
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
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Title</TableHead>
                    <TableHead className="text-xs w-[80px]">
                      Start
                    </TableHead>
                    <TableHead className="text-xs w-[60px]">
                      Days
                    </TableHead>
                    <TableHead className="w-[60px]" />
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
                          <span className={isGrouped ? "pl-4" : ""}>
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
      />
    </div>
  )
}
