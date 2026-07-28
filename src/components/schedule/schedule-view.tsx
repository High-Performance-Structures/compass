"use client"

import { useState, useMemo, useRef, useEffect } from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-mobile"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  IconSearch,
  IconFilter,
  IconX,
  IconPlus,
  IconCalendar,
  IconList,
  IconTimeline,
  IconChevronRight,
  IconDots,
  IconDownload,
  IconUpload,
  IconPrinter,
  IconHistory,
  IconCalendarOff,
  IconLoader2,
} from "@tabler/icons-react"
import { toast } from "sonner"
import { ScheduleListView } from "./schedule-list-view"
import { ScheduleGanttView } from "./schedule-gantt-view"
import { ScheduleCalendarView } from "./schedule-calendar-view"
import { ScheduleMobileView } from "./schedule-mobile-view"
import { WorkdayExceptionsView } from "./workday-exceptions-view"
import { ScheduleBaselineView } from "./schedule-baseline-view"
import { ScheduleItemFormDialog } from "./schedule-item-form-dialog"
import { ProjectQuickSwitcher } from "@/components/projects/project-quick-switcher"
import type { ProjectListItem } from "@/app/actions/projects"
import type { ProjectTaskAssigneeOption } from "@/app/actions/project-contacts"
import type {
  ScheduleData,
  ScheduleBaselineData,
  TaskFilters,
  TaskStatus,
} from "@/lib/schedule/types"
import {
  EMPTY_FILTERS,
  STATUS_OPTIONS,
} from "@/lib/schedule/types"
import {
  isScheduleOrderMode,
  orderScheduleTasks,
  scheduleOrderStorageKey,
  type ScheduleOrderMode,
} from "@/lib/schedule/task-ordering"

type View = "calendar" | "list" | "gantt"

const VIEW_OPTIONS = [
  { value: "calendar" as const, icon: IconCalendar, label: "Calendar" },
  { value: "list" as const, icon: IconList, label: "List" },
  { value: "gantt" as const, icon: IconTimeline, label: "Gantt" },
]

interface ScheduleViewProps {
  readonly projectId: string
  readonly projectName: string
  readonly initialData: ScheduleData
  readonly baselines: ScheduleBaselineData[]
  readonly allProjects?: readonly ProjectListItem[]
  readonly assigneeOptions?: readonly ProjectTaskAssigneeOption[]
  readonly initialView?: View
  readonly focusTaskId?: string | null
}

export function ScheduleView({
  projectId,
  projectName,
  initialData,
  baselines,
  allProjects = [],
  assigneeOptions = [],
  initialView = "gantt",
  focusTaskId = null,
}: ScheduleViewProps) {
  const isMobile = useIsMobile()
  const [view, setView] = useState<View>(initialView)
  const [orderMode, setOrderMode] =
    useState<ScheduleOrderMode>("chronological")
  const [taskFormOpen, setTaskFormOpen] = useState(false)
  const [filters, setFilters] = useState<TaskFilters>(EMPTY_FILTERS)
  const [baselinesOpen, setBaselinesOpen] = useState(false)
  const [exceptionsOpen, setExceptionsOpen] = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const storedMode = window.localStorage.getItem(
      scheduleOrderStorageKey(projectId)
    )
    setOrderMode(
      isScheduleOrderMode(storedMode) ? storedMode : "chronological"
    )
  }, [projectId])

  const handleOrderModeChange = (value: string): void => {
    if (!isScheduleOrderMode(value)) return
    setOrderMode(value)
    window.localStorage.setItem(scheduleOrderStorageKey(projectId), value)
  }

  const phaseOptions = useMemo(() => {
    const seen = new Set<string>()
    return initialData.tasks
      .map((task) => task.phase)
      .filter((phase) => {
        if (!phase || seen.has(phase)) return false
        seen.add(phase)
        return true
      })
      .map((phase) => ({ value: phase, label: phase }))
  }, [initialData.tasks])

  const filteredTasks = useMemo(() => {
    let tasks = initialData.tasks

    if (filters.status.length > 0) {
      tasks = tasks.filter((t) => filters.status.includes(t.status))
    }
    if (filters.phase.length > 0) {
      tasks = tasks.filter((t) => filters.phase.includes(t.phase))
    }
    if (filters.assignedTo) {
      const search = filters.assignedTo.toLowerCase()
      tasks = tasks.filter((t) =>
        t.assignedTo?.toLowerCase().includes(search)
      )
    }
    if (filters.search) {
      const search = filters.search.toLowerCase()
      tasks = tasks.filter((t) =>
        t.title.toLowerCase().includes(search)
      )
    }
    return orderScheduleTasks(tasks, orderMode)
  }, [initialData.tasks, filters, orderMode])

  const activeFilterCount =
    filters.status.length +
    filters.phase.length +
    (filters.assignedTo ? 1 : 0)

  const toggleStatus = (status: TaskStatus) => {
    const current = filters.status
    const next = current.includes(status)
      ? current.filter((s) => s !== status)
      : [...current, status]
    setFilters({ ...filters, status: next })
  }

  const togglePhase = (phase: string) => {
    const current = filters.phase
    const next = current.includes(phase)
      ? current.filter((p) => p !== phase)
      : [...current, phase]
    setFilters({ ...filters, phase: next })
  }

  const removeStatusChip = (status: TaskStatus) => {
    setFilters({
      ...filters,
      status: filters.status.filter((s) => s !== status),
    })
  }

  const removePhaseChip = (phase: string) => {
    setFilters({
      ...filters,
      phase: filters.phase.filter((p) => p !== phase),
    })
  }

  const clearFilters = () => setFilters(EMPTY_FILTERS)

  // CSV export
  const handleExportCSV = () => {
    const headers = [
      "Title", "Phase", "Status", "Start Date", "End Date",
      "Duration (days)", "% Complete", "Assigned To",
      "Critical Path", "Milestone",
    ]
    const rows = filteredTasks.map((task) => [
      task.title, task.phase, task.status, task.startDate,
      task.endDateCalculated, task.workdays.toString(),
      task.percentComplete.toString(), task.assignedTo ?? "",
      task.isCriticalPath ? "Yes" : "No",
      task.isMilestone ? "Yes" : "No",
    ])

    const escapeCSV = (value: string) => {
      if (value.includes(",") || value.includes('"') || value.includes("\n")) {
        return `"${value.replace(/"/g, '""')}"`
      }
      return value
    }

    const csvContent = [
      headers.join(","),
      ...rows.map((row) => row.map(escapeCSV).join(",")),
    ].join("\n")

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
    const link = document.createElement("a")
    link.download = `${projectName.replace(/\s+/g, "-")}-schedule-${new Date().toISOString().split("T")[0]}.csv`
    link.href = URL.createObjectURL(blob)
    link.click()
    URL.revokeObjectURL(link.href)
  }

  // CSV import
  const handleFileSelect = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0]
    if (!file) return

    setIsImporting(true)
    try {
      const text = await file.text()
      const lines = text.split("\n")
      const headers = lines[0].split(",").map((h) => h.trim().toLowerCase())

      const titleIdx = headers.findIndex(
        (h) => h.includes("title") || h.includes("task")
      )
      const startIdx = headers.findIndex((h) => h.includes("start"))
      const durationIdx = headers.findIndex(
        (h) => h.includes("duration") || h.includes("days")
      )
      const phaseIdx = headers.findIndex((h) => h.includes("phase"))
      const assignedIdx = headers.findIndex(
        (h) => h.includes("assigned") || h.includes("owner")
      )

      const parsed: Record<string, unknown>[] = []
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim()
        if (!line) continue

        const values = line.split(",").map((v) => v.trim())
        const task: Record<string, unknown> = {}

        if (titleIdx >= 0 && values[titleIdx]) task.title = values[titleIdx]
        if (startIdx >= 0 && values[startIdx]) task.startDate = values[startIdx]
        if (durationIdx >= 0 && values[durationIdx]) {
          task.workdays = parseInt(values[durationIdx]) || 1
        }
        if (phaseIdx >= 0 && values[phaseIdx]) task.phase = values[phaseIdx]
        if (assignedIdx >= 0 && values[assignedIdx]) {
          task.assignedTo = values[assignedIdx]
        }

        if (task.title) {
          task.status = "PENDING"
          task.percentComplete = 0
          parsed.push(task)
        }
      }

      if (parsed.length > 0) {
        const blob = new Blob(
          [JSON.stringify(parsed, null, 2)],
          { type: "application/json" }
        )
        const url = URL.createObjectURL(blob)
        const link = document.createElement("a")
        link.href = url
        link.download = `imported-tasks-${Date.now()}.json`
        link.click()
        URL.revokeObjectURL(url)
        toast.success(
          `Parsed ${parsed.length} schedule items from CSV for review.`
        )
      } else {
        toast.error("No valid schedule items found in the CSV file.")
      }
    } catch (error) {
      console.error("Import failed:", error)
      toast.error("Failed to parse CSV file. Please check the format.")
    } finally {
      setIsImporting(false)
      setImportDialogOpen(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header: breadcrumb + project switcher + view toggle + new task */}
      <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center">
        <nav className="flex min-w-0 items-center gap-1.5 text-sm">
          <Link
            href={`/dashboard/projects/${projectId}`}
            className="text-muted-foreground hover:text-foreground truncate transition-colors"
          >
            {projectName}
          </Link>
          <IconChevronRight className="size-3.5 text-muted-foreground/60 shrink-0" />
          <span className="font-medium">Schedule</span>
        </nav>

        <div className="flex flex-wrap items-center gap-2 lg:ml-auto lg:justify-end">
          <ProjectQuickSwitcher
            projects={allProjects}
            currentProjectId={projectId}
            targetSection="schedule"
            placeholder="Switch schedule project..."
            className="w-full sm:w-[300px]"
          />

          {/* View switcher */}
          <div className={cn(
            "flex items-center rounded-lg border bg-muted/40 p-0.5",
            isMobile ? "gap-0" : "gap-0",
          )}>
            {VIEW_OPTIONS.map(({ value, icon: Icon, label }) => (
              <button
                key={value}
                onClick={() => setView(value)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-all",
                  view === value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="size-3.5" />
                {!isMobile && <span>{label}</span>}
              </button>
            ))}
          </div>

          <Button size="sm" onClick={() => setTaskFormOpen(true)} className="h-8">
            <IconPlus className="size-3.5" />
            <span className="hidden sm:inline ml-1.5">New Schedule Item</span>
          </Button>
        </div>
      </div>

      {/* Action bar: search, filters, overflow */}
      <div className="flex items-center gap-2 mb-3 print:hidden">
        {/* Search */}
        <div className="relative min-w-0 flex-1 sm:flex-none sm:w-52">
          <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search schedule items..."
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            className="h-8 pl-8 text-sm"
          />
        </div>

        {/* Filter popover */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 shrink-0">
              <IconFilter className="size-3.5" />
              <span className="hidden sm:inline ml-1.5">Filters</span>
              {activeFilterCount > 0 && (
                <Badge
                  variant="secondary"
                  className="ml-1.5 h-4 min-w-4 rounded-sm px-1 text-[10px]"
                >
                  {activeFilterCount}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-3">
            <div className="space-y-3">
              <div>
                <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Status
                </Label>
                <div className="mt-1.5 space-y-1">
                  {STATUS_OPTIONS.map((opt) => (
                    <label
                      key={opt.value}
                      className="flex items-center gap-2 py-0.5 cursor-pointer"
                    >
                      <Checkbox
                        checked={filters.status.includes(opt.value)}
                        onCheckedChange={() => toggleStatus(opt.value)}
                      />
                      <span className="text-sm">{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Phase
                </Label>
                <div className="mt-1.5 space-y-1 max-h-40 overflow-y-auto">
                  {phaseOptions.map((opt) => (
                    <label
                      key={opt.value}
                      className="flex items-center gap-2 py-0.5 cursor-pointer"
                    >
                      <Checkbox
                        checked={filters.phase.includes(opt.value)}
                        onCheckedChange={() => togglePhase(opt.value)}
                      />
                      <span className="text-sm">{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Responsible Contact
                </Label>
                <Input
                  placeholder="Filter by name..."
                  value={filters.assignedTo}
                  onChange={(e) =>
                    setFilters({ ...filters, assignedTo: e.target.value })
                  }
                  className="mt-1.5 h-8 text-sm"
                />
              </div>
              {activeFilterCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs"
                  onClick={clearFilters}
                >
                  <IconX className="size-3 mr-1" />
                  Clear all filters
                </Button>
              )}
            </div>
          </PopoverContent>
        </Popover>

        <Select value={orderMode} onValueChange={handleOrderModeChange}>
          <SelectTrigger
            className="h-8 w-[132px] shrink-0 text-xs sm:w-[146px]"
            aria-label="Schedule ordering"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="chronological">Chronological</SelectItem>
            <SelectItem value="manual">Manual order</SelectItem>
          </SelectContent>
        </Select>

        {/* Active filter chips */}
        <div className="hidden sm:flex items-center gap-1 overflow-x-auto min-w-0">
          {filters.status.map((s) => (
            <Badge
              key={s}
              variant="outline"
              className="gap-1 shrink-0 text-xs py-0 h-6 cursor-pointer hover:bg-accent"
              onClick={() => removeStatusChip(s)}
            >
              {STATUS_OPTIONS.find((o) => o.value === s)?.label ?? s}
              <IconX className="size-3" />
            </Badge>
          ))}
          {filters.phase.map((p) => (
            <Badge
              key={p}
              variant="outline"
              className="gap-1 shrink-0 text-xs py-0 h-6 cursor-pointer hover:bg-accent"
              onClick={() => removePhaseChip(p)}
            >
              {p}
              <IconX className="size-3" />
            </Badge>
          ))}
          {filters.assignedTo && (
            <Badge
              variant="outline"
              className="gap-1 shrink-0 text-xs py-0 h-6 cursor-pointer hover:bg-accent"
              onClick={() => setFilters({ ...filters, assignedTo: "" })}
            >
              {filters.assignedTo}
              <IconX className="size-3" />
            </Badge>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2 shrink-0">
          <span className="text-xs text-muted-foreground hidden sm:inline tabular-nums">
            {filteredTasks.length} schedule item
            {filteredTasks.length !== 1 ? "s" : ""}
          </span>

          {/* Overflow menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8">
                <IconDots className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={handleExportCSV}>
                <IconDownload className="size-4 mr-2" />
                Export CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setImportDialogOpen(true)}>
                <IconUpload className="size-4 mr-2" />
                Import CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => window.print()}>
                <IconPrinter className="size-4 mr-2" />
                Print
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setBaselinesOpen(true)}>
                <IconHistory className="size-4 mr-2" />
                Baselines
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setExceptionsOpen(true)}>
                <IconCalendarOff className="size-4 mr-2" />
                Workday Exceptions
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* View content */}
      <div className="flex flex-col flex-1 min-h-0">
        {view === "calendar" && (
          isMobile ? (
            <ScheduleMobileView
              projectId={projectId}
              tasks={filteredTasks}
              exceptions={initialData.exceptions}
            />
          ) : (
            <ScheduleCalendarView
              projectId={projectId}
              tasks={filteredTasks}
              exceptions={initialData.exceptions}
            />
          )
        )}
        {view === "list" && (
          <ScheduleListView
            projectId={projectId}
            tasks={filteredTasks}
            dependencies={initialData.dependencies}
            exceptions={initialData.exceptions}
            assigneeOptions={assigneeOptions}
            focusTaskId={focusTaskId}
          />
        )}
        {view === "gantt" && (
          <ScheduleGanttView
            projectId={projectId}
            tasks={filteredTasks}
            dependencies={initialData.dependencies}
            exceptions={initialData.exceptions}
            assigneeOptions={assigneeOptions}
          />
        )}
      </div>

      {/* New schedule item dialog */}
      <ScheduleItemFormDialog
        open={taskFormOpen}
        onOpenChange={setTaskFormOpen}
        projectId={projectId}
        editingTask={null}
        allTasks={initialData.tasks}
        dependencies={initialData.dependencies}
        exceptions={initialData.exceptions}
        assigneeOptions={assigneeOptions}
      />

      {/* Import dialog */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import Schedule</DialogTitle>
            <DialogDescription>
              Upload a CSV file with columns for title, start date, duration,
              phase, and assigned to.
            </DialogDescription>
          </DialogHeader>
          <div className="border-2 border-dashed rounded-lg p-8 text-center">
            <Input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleFileSelect}
            />
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={isImporting}
            >
              {isImporting ? (
                <>
                  <IconLoader2 className="size-4 mr-2 animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <IconUpload className="size-4 mr-2" />
                  Select CSV File
                </>
              )}
            </Button>
            <p className="text-xs text-muted-foreground mt-2">
              Supported format: CSV with headers
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* Baselines sheet */}
      <Sheet open={baselinesOpen} onOpenChange={setBaselinesOpen}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Baselines</SheetTitle>
            <SheetDescription>
              Save and compare schedule snapshots.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4">
            <ScheduleBaselineView
              projectId={projectId}
              baselines={baselines}
              currentTasks={initialData.tasks}
            />
          </div>
        </SheetContent>
      </Sheet>

      {/* Exceptions sheet */}
      <Sheet open={exceptionsOpen} onOpenChange={setExceptionsOpen}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Workday Exceptions</SheetTitle>
            <SheetDescription>
              Holidays, shutdowns, and weekend working overrides.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4">
            <WorkdayExceptionsView
              projectId={projectId}
              exceptions={initialData.exceptions}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
