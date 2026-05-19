"use client"

import { useState, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  IconFilter,
  IconPlus,
  IconDots,
  IconDownload,
  IconUpload,
  IconPrinter,
  IconX,
  IconLoader2,
} from "@tabler/icons-react"
import { toast } from "sonner"
import type { TaskStatus, ConstructionPhase, ScheduleTaskData } from "@/lib/schedule/types"

const STATUSES: { value: TaskStatus; label: string }[] = [
  { value: "PENDING", label: "Pending" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "COMPLETE", label: "Complete" },
  { value: "BLOCKED", label: "Blocked" },
]

const PHASES: { value: ConstructionPhase; label: string }[] = [
  { value: "preconstruction", label: "Preconstruction" },
  { value: "sitework", label: "Sitework" },
  { value: "foundation", label: "Foundation" },
  { value: "framing", label: "Framing" },
  { value: "roofing", label: "Roofing" },
  { value: "electrical", label: "Electrical" },
  { value: "plumbing", label: "Plumbing" },
  { value: "hvac", label: "HVAC" },
  { value: "insulation", label: "Insulation" },
  { value: "drywall", label: "Drywall" },
  { value: "finish", label: "Finish" },
  { value: "landscaping", label: "Landscaping" },
  { value: "closeout", label: "Closeout" },
]

export interface TaskFilters {
  status: TaskStatus[]
  phase: ConstructionPhase[]
  assignedTo: string
  search: string
}

interface ScheduleToolbarProps {
  onNewItem: () => void
  filters: TaskFilters
  onFiltersChange: (filters: TaskFilters) => void
  projectName: string
  tasksCount: number
  tasks: ScheduleTaskData[]
}

export function ScheduleToolbar({
  onNewItem,
  filters,
  onFiltersChange,
  projectName,
  tasksCount,
  tasks,
}: ScheduleToolbarProps) {
  const [filterDialogOpen, setFilterDialogOpen] = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const activeFiltersCount =
    filters.status.length +
    filters.phase.length +
    (filters.assignedTo ? 1 : 0) +
    (filters.search ? 1 : 0)

  const toggleStatus = (status: TaskStatus) => {
    const newStatus = filters.status.includes(status)
      ? filters.status.filter((s) => s !== status)
      : [...filters.status, status]
    onFiltersChange({ ...filters, status: newStatus })
  }

  const togglePhase = (phase: ConstructionPhase) => {
    const newPhase = filters.phase.includes(phase)
      ? filters.phase.filter((p) => p !== phase)
      : [...filters.phase, phase]
    onFiltersChange({ ...filters, phase: newPhase })
  }

  const clearFilters = () => {
    onFiltersChange({
      status: [],
      phase: [],
      assignedTo: "",
      search: "",
    })
  }

  const handlePrint = () => {
    window.print()
  }

  const handleExportCSV = () => {
    const headers = ["Title", "Phase", "Status", "Start Date", "End Date", "Duration (days)", "% Complete", "Assigned To", "Critical Path", "Milestone"]
    const rows = tasks.map((task) => [
      task.title,
      task.phase,
      task.status,
      task.startDate,
      task.endDateCalculated,
      task.workdays.toString(),
      task.percentComplete.toString(),
      task.assignedTo || "",
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

  const handleImportClick = () => {
    setImportDialogOpen(true)
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setIsImporting(true)
    try {
      const text = await file.text()
      const lines = text.split("\n")
      const headers = lines[0].split(",").map((h) => h.trim().toLowerCase())

      const titleIdx = headers.findIndex((h) => h.includes("title") || h.includes("task"))
      const startIdx = headers.findIndex((h) => h.includes("start"))
      const durationIdx = headers.findIndex((h) => h.includes("duration") || h.includes("days"))
      const phaseIdx = headers.findIndex((h) => h.includes("phase"))
      const assignedIdx = headers.findIndex((h) => h.includes("assigned") || h.includes("owner"))

      const tasks: Record<string, unknown>[] = []
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim()
        if (!line) continue

        const values = line.split(",").map((v) => v.trim())
        const task: Record<string, unknown> = {}

        if (titleIdx >= 0 && values[titleIdx]) task.title = values[titleIdx]
        if (startIdx >= 0 && values[startIdx]) task.startDate = values[startIdx]
        if (durationIdx >= 0 && values[durationIdx]) task.workdays = parseInt(values[durationIdx]) || 1
        if (phaseIdx >= 0 && values[phaseIdx]) task.phase = values[phaseIdx]
        if (assignedIdx >= 0 && values[assignedIdx]) task.assignedTo = values[assignedIdx]

        if (task.title) {
          task.status = "PENDING"
          task.percentComplete = 0
          tasks.push(task)
        }
      }

      if (tasks.length > 0) {
        const blob = new Blob([JSON.stringify(tasks, null, 2)], { type: "application/json" })
        const url = URL.createObjectURL(blob)
        const link = document.createElement("a")
        link.href = url
        link.download = `imported-tasks-${Date.now()}.json`
        link.click()
        URL.revokeObjectURL(url)
        toast.success(`Parsed ${tasks.length} tasks from CSV for review.`)
      } else {
        toast.error("No valid tasks found in the CSV file.")
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
    <>
      <div className="flex items-center justify-between gap-2 py-2 border-b mb-2 print:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-9">
              <IconDots className="size-4 mr-2" />
              Actions
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <IconFilter className="size-4 mr-2" />
                Filter Tasks
                {activeFiltersCount > 0 && (
                  <span className="ml-auto bg-primary text-primary-foreground text-xs px-1.5 py-0.5 rounded">
                    {activeFiltersCount}
                  </span>
                )}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-64">
                <DropdownMenuLabel className="text-xs">Status</DropdownMenuLabel>
                {STATUSES.map((status) => (
                  <DropdownMenuCheckboxItem
                    key={status.value}
                    checked={filters.status.includes(status.value)}
                    onCheckedChange={() => toggleStatus(status.value)}
                  >
                    {status.label}
                  </DropdownMenuCheckboxItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs">Phase</DropdownMenuLabel>
                {PHASES.map((phase) => (
                  <DropdownMenuCheckboxItem
                    key={phase.value}
                    checked={filters.phase.includes(phase.value)}
                    onCheckedChange={() => togglePhase(phase.value)}
                  >
                    {phase.label}
                  </DropdownMenuCheckboxItem>
                ))}
                {activeFiltersCount > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={clearFilters}>
                      <IconX className="size-4 mr-2" />
                      Clear all filters
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground px-2 py-1">
              Import &amp; Export
            </DropdownMenuLabel>
            <DropdownMenuItem onClick={handleExportCSV}>
              <IconDownload className="size-4 mr-2" />
              Export Schedule
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleImportClick}>
              <IconUpload className="size-4 mr-2" />
              Import Schedule
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handlePrint}>
              <IconPrinter className="size-4 mr-2" />
              Print
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex items-center gap-2">
          {activeFiltersCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-9 text-muted-foreground"
              onClick={clearFilters}
            >
              <IconX className="size-4 mr-1" />
              Clear filters
            </Button>
          )}
          <span className="text-xs text-muted-foreground hidden sm:inline">
            {tasksCount} task{tasksCount !== 1 ? "s" : ""}
          </span>
          <Button size="sm" onClick={onNewItem} className="h-9">
            <IconPlus className="size-4 mr-2" />
            New Task
          </Button>
        </div>
      </div>

      <Dialog open={filterDialogOpen} onOpenChange={setFilterDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Filter Tasks</DialogTitle>
            <DialogDescription>
              Narrow down tasks by status, phase, or assignee.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Search</Label>
              <Input
                placeholder="Search by title..."
                value={filters.search}
                onChange={(e) =>
                  onFiltersChange({ ...filters, search: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Assigned To</Label>
              <Input
                placeholder="Filter by assignee..."
                value={filters.assignedTo}
                onChange={(e) =>
                  onFiltersChange({ ...filters, assignedTo: e.target.value })
                }
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import Schedule</DialogTitle>
            <DialogDescription>
              Upload a CSV file with your schedule data. The file should have columns
              for title, start date, duration, phase, and assigned to.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
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
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
