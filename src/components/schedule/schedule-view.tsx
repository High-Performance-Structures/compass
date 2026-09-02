"use client"

import {
  useState,
  useMemo,
  useRef,
  useEffect,
  useTransition,
} from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { flushSync } from "react-dom"
import { useIsMobile } from "@/hooks/use-mobile"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
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
  IconDeviceFloppy,
  IconBookmark,
  IconTrash,
  IconSend,
  IconTemplate,
} from "@tabler/icons-react"
import { toast } from "sonner"
import { ScheduleListView } from "./schedule-list-view"
import { ScheduleGanttView } from "./schedule-gantt-view"
import { ScheduleCalendarView } from "./schedule-calendar-view"
import { ScheduleMobileView } from "./schedule-mobile-view"
import { WorkdayExceptionsView } from "./workday-exceptions-view"
import { ScheduleBaselineView } from "./schedule-baseline-view"
import { ScheduleItemFormDialog } from "./schedule-item-form-dialog"
import { ScheduleTemplateDialog } from "./schedule-template-dialog"
import { ScheduleTemplateBulkImportDialog } from "./schedule-template-bulk-import-dialog"
import { ProjectQuickSwitcher } from "@/components/projects/project-quick-switcher"
import {
  printScheduleDocument,
  SchedulePrintDocument,
} from "./schedule-print-document"
import {
  SchedulePrintDialog,
  type SchedulePrintSelection,
} from "./schedule-print-dialog"
import { ScheduleScopeSwitcher } from "./schedule-scope-switcher"
import { OwnerScheduleVisibilityControl } from "./owner-schedule-visibility-control"
import type { ProjectListItem } from "@/app/actions/projects"
import type { ProjectTaskAssigneeOption } from "@/app/actions/project-contacts"
import type {
  ScheduleProjectData,
  ScheduleScope,
} from "@/lib/schedule/project-scope"
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
import type { OwnerScheduleView } from "@/lib/schedule/owner-visibility"
import type { GanttScrollMode } from "@/lib/schedule/gantt-interaction-mode"
import { projectBrandFor } from "@/lib/project-branding"
import {
  deleteScheduleView,
  saveScheduleView,
} from "@/app/actions/schedule-saved-views"
import {
  publishSchedule,
  type SchedulePublicationStatus,
} from "@/app/actions/schedule-publications"
import {
  SCHEDULE_GROUP_MODES,
  SCHEDULE_LIST_COLUMNS,
  SCHEDULE_VIEW_PRESETS,
  type SavedScheduleViewData,
  type ScheduleGroupMode,
  type ScheduleListColumn,
  type ScheduleViewDefinition,
  type ScheduleViewPreset,
} from "@/lib/schedule/saved-views"

type View = "calendar" | "list" | "gantt"

const VIEW_OPTIONS = [
  { value: "calendar" as const, icon: IconCalendar, label: "Calendar" },
  { value: "list" as const, icon: IconList, label: "List" },
  { value: "gantt" as const, icon: IconTimeline, label: "Gantt" },
]

interface ScheduleViewProps {
  readonly projectId: string | null
  readonly projectName: string
  readonly initialData: ScheduleData
  readonly baselines: ScheduleBaselineData[]
  readonly allProjects?: readonly ProjectListItem[]
  readonly scheduleProjects?: readonly ScheduleProjectData[]
  readonly scope?: ScheduleScope
  readonly assigneeOptions?: readonly ProjectTaskAssigneeOption[]
  readonly initialView?: View
  readonly focusTaskId?: string | null
  readonly globalMode?: boolean
  readonly ownerScheduleView?: OwnerScheduleView
  readonly savedViews?: readonly SavedScheduleViewData[]
  readonly ganttScrollMode?: GanttScrollMode
  readonly currentUserAssigneeTerms?: readonly string[]
  readonly publicationStatus?: SchedulePublicationStatus | null
  readonly initialTaskFormOpen?: boolean
}

export function ScheduleView({
  projectId,
  projectName,
  initialData,
  baselines,
  allProjects = [],
  scheduleProjects = [],
  scope,
  assigneeOptions = [],
  initialView = "gantt",
  focusTaskId = null,
  globalMode = false,
  ownerScheduleView = "items",
  savedViews: initialSavedViews = [],
  ganttScrollMode = "default",
  currentUserAssigneeTerms = [],
  publicationStatus: initialPublicationStatus = null,
  initialTaskFormOpen = false,
}: ScheduleViewProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const isMobile = useIsMobile()
  const activeProject = projectId
    ? allProjects.find((project) => project.id === projectId) ??
      scheduleProjects.find((project) => project.id === projectId)
    : undefined
  const printBrand = projectId
    ? projectBrandFor({
        projectId,
        projectNumber: activeProject?.projectNumber,
      })
    : null
  const requestedPreset = searchParams.get("preset")
  const initialPreset =
    SCHEDULE_VIEW_PRESETS.find((value) => value === requestedPreset) ?? "all"
  const requestedGroup = searchParams.get("group")
  const initialGroup =
    SCHEDULE_GROUP_MODES.find((value) => value === requestedGroup) ?? "none"
  const requestedColumns = (searchParams.get("columns") ?? "")
    .split(",")
    .filter((value): value is ScheduleListColumn =>
      SCHEDULE_LIST_COLUMNS.some((column) => column === value)
    )
  const initialColumns =
    requestedColumns.length > 0
      ? requestedColumns
      : [...SCHEDULE_LIST_COLUMNS]
  const requestedStatuses = (searchParams.get("status") ?? "")
    .split(",")
    .flatMap((value) => {
      const option = STATUS_OPTIONS.find((candidate) => candidate.value === value)
      return option ? [option.value] : []
    })
  const [view, setView] = useState<View>(initialView)
  const [orderMode, setOrderMode] =
    useState<ScheduleOrderMode>(() => {
      const requestedOrder = searchParams.get("order")
      return isScheduleOrderMode(requestedOrder)
        ? requestedOrder
        : "chronological"
    })
  const [taskFormOpen, setTaskFormOpen] = useState(initialTaskFormOpen)
  const [filters, setFilters] = useState<TaskFilters>(() => ({
    status: requestedStatuses,
    phase: (searchParams.get("phase") ?? "").split(",").filter(Boolean),
    assignedTo: searchParams.get("assignee") ?? "",
    search: searchParams.get("q") ?? "",
  }))
  const [preset, setPreset] = useState<ScheduleViewPreset>(initialPreset)
  const [groupMode, setGroupMode] =
    useState<ScheduleGroupMode>(initialGroup)
  const [visibleColumns, setVisibleColumns] =
    useState<readonly ScheduleListColumn[]>(initialColumns)
  const [savedViews, setSavedViews] =
    useState<readonly SavedScheduleViewData[]>(initialSavedViews)
  const [saveViewOpen, setSaveViewOpen] = useState(false)
  const [saveViewName, setSaveViewName] = useState("")
  const [saveViewShared, setSaveViewShared] = useState(false)
  const [isSavingView, startSaveViewTransition] = useTransition()
  const [baselinesOpen, setBaselinesOpen] = useState(false)
  const [exceptionsOpen, setExceptionsOpen] = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [printDialogOpen, setPrintDialogOpen] = useState(false)
  const [printSelection, setPrintSelection] =
    useState<SchedulePrintSelection | null>(null)
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false)
  const [bulkTemplateDialogOpen, setBulkTemplateDialogOpen] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [publicationStatus, setPublicationStatus] =
    useState<SchedulePublicationStatus | null>(initialPublicationStatus)
  const [publishOpen, setPublishOpen] = useState(false)
  const [publishReason, setPublishReason] = useState("")
  const [isPublishing, startPublishTransition] = useTransition()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const preferenceScopeKey = projectId ?? "unified"

  function handlePublish(): void {
    if (!projectId) return
    startPublishTransition(async () => {
      const result = await publishSchedule(projectId, publishReason)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setPublicationStatus({
        hasPublishedSchedule: true,
        hasUnpublishedChanges: false,
        publishedAt: result.publishedAt,
        publishedBy: null,
        changeReason: publishReason.trim(),
      })
      setPublishReason("")
      setPublishOpen(false)
      toast.success("Schedule published to owner and subcontractor views.")
      router.refresh()
    })
  }

  useEffect(() => {
    const requestedOrder = searchParams.get("order")
    if (isScheduleOrderMode(requestedOrder)) {
      setOrderMode(requestedOrder)
      return
    }
    const storedMode = window.localStorage.getItem(
      scheduleOrderStorageKey(preferenceScopeKey)
    )
    setOrderMode(
      isScheduleOrderMode(storedMode) ? storedMode : "chronological"
    )
  }, [preferenceScopeKey, searchParams])

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString())
    params.set("view", view)
    params.set("order", orderMode)

    const setOrDelete = (key: string, value: string): void => {
      if (value) params.set(key, value)
      else params.delete(key)
    }
    setOrDelete("status", filters.status.join(","))
    setOrDelete("phase", filters.phase.join(","))
    setOrDelete("assignee", filters.assignedTo)
    setOrDelete("q", filters.search)
    setOrDelete("preset", preset === "all" ? "" : preset)
    setOrDelete("group", groupMode === "none" ? "" : groupMode)
    setOrDelete(
      "columns",
      visibleColumns.length === SCHEDULE_LIST_COLUMNS.length
        ? ""
        : visibleColumns.join(",")
    )

    const nextQuery = params.toString()
    const currentQuery = searchParams.toString()
    if (nextQuery !== currentQuery) {
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, {
        scroll: false,
      })
    }
  }, [
    filters,
    groupMode,
    orderMode,
    pathname,
    preset,
    router,
    searchParams,
    view,
    visibleColumns,
  ])

  const handleOrderModeChange = (value: string): void => {
    if (!isScheduleOrderMode(value)) return
    setOrderMode(value)
    window.localStorage.setItem(
      scheduleOrderStorageKey(preferenceScopeKey),
      value
    )
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
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    if (preset === "my-items") {
      const terms = currentUserAssigneeTerms
        .map((term) => term.trim().toLowerCase())
        .filter(Boolean)
      tasks = tasks.filter((task) => {
        const assignee = task.assignedTo?.trim().toLowerCase() ?? ""
        return terms.some(
          (term) => assignee === term || assignee.includes(term)
        )
      })
    } else if (preset === "past-due") {
      tasks = tasks.filter(
        (task) =>
          task.status !== "COMPLETE" &&
          new Date(`${task.endDateCalculated}T00:00:00`).getTime() <
            today.getTime()
      )
    } else if (
      preset === "next-7" ||
      preset === "next-30" ||
      preset === "next-90"
    ) {
      const dayCount =
        preset === "next-7" ? 7 : preset === "next-30" ? 30 : 90
      const horizon = new Date(today)
      horizon.setDate(horizon.getDate() + dayCount)
      tasks = tasks.filter(
        (task) =>
          new Date(`${task.startDate}T00:00:00`).getTime() <=
            horizon.getTime() &&
          new Date(`${task.endDateCalculated}T00:00:00`).getTime() >=
            today.getTime()
      )
    }

    const ordered = orderScheduleTasks(tasks, orderMode)
    if (groupMode === "none") return ordered

    const projectById = new Map(
      scheduleProjects.map((project) => [project.id, project])
    )
    const groupKey = (task: (typeof ordered)[number]): string => {
      if (groupMode === "phase") return task.phase
      if (groupMode === "status") return task.status
      const project = projectById.get(task.projectId)
      return project?.projectNumber ?? project?.name ?? task.projectId
    }
    return [...ordered].sort((left, right) =>
      groupKey(left).localeCompare(groupKey(right))
    )
  }, [
    currentUserAssigneeTerms,
    filters,
    groupMode,
    initialData.tasks,
    orderMode,
    preset,
    scheduleProjects,
  ])
  const printItems = useMemo(
    () =>
      filteredTasks.map((task) => ({
        id: task.id,
        projectId: task.projectId,
        title: task.title,
        startDate: task.startDate,
        endDate: task.endDateCalculated,
        workdays: task.workdays,
        status: task.status,
        phase: task.phase,
        displayColor: task.displayColor,
        assignedTo: task.assignedTo,
        percentComplete: task.percentComplete,
        isMilestone: task.isMilestone,
      })),
    [filteredTasks]
  )

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

  const currentViewDefinition = (): ScheduleViewDefinition => ({
    view,
    orderMode,
    groupMode,
    preset,
    status: [...filters.status],
    phase: [...filters.phase],
    assignedTo: filters.assignedTo,
    search: filters.search,
    columns: [...visibleColumns],
  })

  const applySavedView = (savedView: SavedScheduleViewData): void => {
    const definition = savedView.definition
    setView(definition.view)
    setOrderMode(definition.orderMode)
    setGroupMode(definition.groupMode)
    setPreset(definition.preset)
    setFilters({
      status: definition.status,
      phase: definition.phase,
      assignedTo: definition.assignedTo,
      search: definition.search,
    })
    setVisibleColumns(definition.columns)
    toast.success(`Applied “${savedView.name}”.`)
  }

  const handleSaveView = (): void => {
    const name = saveViewName.trim()
    if (!name) return
    startSaveViewTransition(async () => {
      const result = await saveScheduleView({
        name,
        visibility: saveViewShared ? "shared" : "personal",
        definition: currentViewDefinition(),
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setSavedViews((current) => [
        ...current.filter((savedView) => savedView.id !== result.view.id),
        result.view,
      ])
      setSaveViewOpen(false)
      setSaveViewName("")
      setSaveViewShared(false)
      toast.success(`Saved “${result.view.name}”.`)
    })
  }

  const handleDeleteView = (savedView: SavedScheduleViewData): void => {
    startSaveViewTransition(async () => {
      const result = await deleteScheduleView(savedView.id)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setSavedViews((current) =>
        current.filter((candidate) => candidate.id !== savedView.id)
      )
      toast.success(`Deleted “${savedView.name}”.`)
    })
  }

  // CSV export
  const handleExportCSV = () => {
    const includeProject = scheduleProjects.length > 1
    const headers = [
      ...(includeProject ? ["Project"] : []),
      "Title", "Phase", "Status", "Start Date", "End Date",
      "Duration (days)", "% Complete", "Assigned To",
      "Critical Path", "Milestone",
    ]
    const rows = filteredTasks.map((task) => [
      ...(includeProject
        ? [
            scheduleProjects.find(
              (project) => project.id === task.projectId
            )?.projectNumber ??
              scheduleProjects.find(
                (project) => project.id === task.projectId
              )?.name ??
              task.projectId,
          ]
        : []),
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

  function printSchedule(selection: SchedulePrintSelection): void {
    // Commit the selected print layout before invoking the synchronous iOS
    // print path. Keep the chooser mounted so it returns after print preview
    // and only closes when the user explicitly dismisses it.
    flushSync(() => {
      setPrintSelection(selection)
    })
    void printScheduleDocument().finally(() => setPrintSelection(null))
  }

  return (
    <div
      className="flex min-h-full min-w-[960px] flex-col"
      data-schedule-workspace
    >
      <SchedulePrintDocument
        audienceLabel={projectId ? "Project schedule" : "Company schedule"}
        brand={printBrand}
        items={printItems}
        layout={printSelection?.layout}
        paletteScopeId={preferenceScopeKey}
        projectName={projectName}
        projectNumber={activeProject?.projectNumber}
        projects={scheduleProjects}
        range={printSelection?.range}
      />
      <SchedulePrintDialog
        defaultLayout={view}
        items={printItems}
        onOpenChange={setPrintDialogOpen}
        onPrint={printSchedule}
        open={printDialogOpen}
      />
      <div
        className="mb-1 flex h-8 w-max min-w-full shrink-0 flex-nowrap items-center gap-1"
        data-schedule-controls
        data-schedule-toolbar
      >
        <nav className="flex shrink-0 items-center gap-1.5 text-sm">
          <Link
            href={
              globalMode || !projectId
                ? "/dashboard/schedule"
                : `/dashboard/projects/${projectId}`
            }
            className="text-muted-foreground hover:text-foreground truncate transition-colors"
          >
            {globalMode ? "Scheduling" : projectName}
          </Link>
          <IconChevronRight className="size-3.5 text-muted-foreground/60 shrink-0" />
          <span className="font-medium">
            {globalMode ? "Project schedules" : "Schedule"}
          </span>
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {globalMode && scope ? (
            <>
              <Button asChild variant="outline" size="sm" className="h-8">
                <Link href="/dashboard/schedule">Work calendar</Link>
              </Button>
              <ScheduleScopeSwitcher
                projects={allProjects}
                scheduleProjects={scheduleProjects}
                scope={scope}
              />
            </>
          ) : (
            <>
              <ProjectQuickSwitcher
                projects={allProjects}
                currentProjectId={projectId}
                targetSection="schedule"
                placeholder="Switch schedule project..."
                className="h-8 w-full sm:w-[300px]"
              />
              <Button asChild variant="outline" size="sm" className="h-8">
                <Link href="/dashboard/schedule?mode=projects&scope=all&view=gantt">
                  All project schedules
                </Link>
              </Button>
            </>
          )}

          {projectId && (
            <OwnerScheduleVisibilityControl
              projectId={projectId}
              initialValue={ownerScheduleView}
            />
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label="Schedule view"
                className="h-8 shrink-0 px-2 text-xs"
                size="sm"
                variant="outline"
              >
                {(() => {
                  const activeView = VIEW_OPTIONS.find(
                    (option) => option.value === view
                  )
                  const ActiveIcon = activeView?.icon ?? IconCalendar
                  return (
                    <>
                      <ActiveIcon className="size-3.5" />
                      <span className="ml-1.5">{activeView?.label}</span>
                    </>
                  )
                })()}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup
                value={view}
                onValueChange={(value) => setView(value as View)}
              >
                {VIEW_OPTIONS.map(({ value, icon: Icon, label }) => (
                  <DropdownMenuRadioItem key={value} value={value}>
                    <Icon className="mr-2 size-4" />
                    {label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            size="sm"
            onClick={() => setTaskFormOpen(true)}
            className="h-8"
            disabled={!projectId}
            title={
              projectId
                ? "Create a schedule item"
                : "Choose one project before creating a schedule item"
            }
          >
            <IconPlus className="size-3.5" />
            <span className="hidden sm:inline ml-1.5">New Schedule Item</span>
          </Button>
        </div>
      </div>

      {projectId && publicationStatus && (
        <div
          className="mb-1 flex h-8 shrink-0 min-w-0 flex-nowrap items-center gap-2 overflow-x-auto text-xs print:hidden"
          data-schedule-publication-controls
        >
          <span className="shrink-0 text-muted-foreground">
            {publicationStatus.hasPublishedSchedule
              ? `Published ${new Date(
                  publicationStatus.publishedAt ?? ""
                ).toLocaleString()}`
              : "Not published"}
          </span>
          {publicationStatus.hasUnpublishedChanges && (
            <span className="shrink-0 text-amber-700 dark:text-amber-300">
              Unpublished changes
            </span>
          )}
          <Button
            className="ml-auto h-7 shrink-0 px-2 text-xs"
            size="sm"
            variant={
              publicationStatus.hasUnpublishedChanges
                ? "default"
                : "outline"
            }
            onClick={() => setPublishOpen(true)}
          >
            <IconSend className="mr-1 size-3.5" />
            Publish
          </Button>
        </div>
      )}

      {/* Action bar: search, filters, overflow */}
      <div className="mb-1 flex h-8 shrink-0 min-w-0 flex-nowrap items-center gap-1.5 overflow-x-auto print:hidden">
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

        <Select
          value={preset}
          onValueChange={(value) => {
            const nextPreset = SCHEDULE_VIEW_PRESETS.find(
              (candidate) => candidate === value
            )
            if (nextPreset) setPreset(nextPreset)
          }}
        >
          <SelectTrigger className="h-8 w-[126px] shrink-0 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All dates</SelectItem>
            <SelectItem value="my-items">My items</SelectItem>
            <SelectItem value="past-due">Past due</SelectItem>
            <SelectItem value="next-7">Next 7 days</SelectItem>
            <SelectItem value="next-30">Next 30 days</SelectItem>
            <SelectItem value="next-90">Next 90 days</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={groupMode}
          onValueChange={(value) => {
            const nextGroup = SCHEDULE_GROUP_MODES.find(
              (candidate) => candidate === value
            )
            if (nextGroup) setGroupMode(nextGroup)
          }}
        >
          <SelectTrigger className="h-8 w-[118px] shrink-0 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No grouping</SelectItem>
            <SelectItem value="phase">By phase</SelectItem>
            <SelectItem value="project">By project</SelectItem>
            <SelectItem value="status">By status</SelectItem>
          </SelectContent>
        </Select>

        {view === "list" ? (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 text-xs">
                Columns
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-52 p-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                Visible columns
              </p>
              <div className="space-y-1.5">
                {SCHEDULE_LIST_COLUMNS.map((column) => (
                  <label
                    key={column}
                    className="flex cursor-pointer items-center gap-2 text-sm"
                  >
                    <Checkbox
                      checked={visibleColumns.includes(column)}
                      onCheckedChange={() =>
                        setVisibleColumns((current) =>
                          current.includes(column)
                            ? current.filter((value) => value !== column)
                            : [...current, column]
                        )
                      }
                    />
                    <span className="capitalize">
                      {column
                        .replace("endDateCalculated", "End date")
                        .replace("startDate", "Start date")
                        .replace("assignedTo", "Responsible")}
                    </span>
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        ) : null}

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-xs">
              <IconBookmark className="size-3.5" />
              Views
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-2">
            <div className="flex items-center justify-between px-2 py-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Saved views
              </p>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => setSaveViewOpen(true)}
              >
                <IconDeviceFloppy className="size-3.5" />
                Save current
              </Button>
            </div>
            <div className="mt-1 max-h-64 overflow-y-auto">
              {savedViews.map((savedView) => (
                <div
                  key={savedView.id}
                  className="flex items-center gap-1 hover:bg-muted"
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 px-2 py-2 text-left text-sm"
                    onClick={() => applySavedView(savedView)}
                  >
                    <span className="block truncate">{savedView.name}</span>
                    <span className="text-[11px] capitalize text-muted-foreground">
                      {savedView.visibility}
                    </span>
                  </button>
                  {savedView.isOwner ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      disabled={isSavingView}
                      onClick={() => handleDeleteView(savedView)}
                      aria-label={`Delete ${savedView.name}`}
                    >
                      <IconTrash className="size-3.5" />
                    </Button>
                  ) : null}
                </div>
              ))}
              {savedViews.length === 0 ? (
                <p className="px-2 py-4 text-xs text-muted-foreground">
                  Save a personal view or share one with the team.
                </p>
              ) : null}
            </div>
          </PopoverContent>
        </Popover>

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
              {projectId && (
                <>
                  <DropdownMenuItem onClick={() => setBulkTemplateDialogOpen(true)}>
                    <IconTemplate className="size-4 mr-2" />
                    Import schedule items
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setTemplateDialogOpen(true)}>
                    <IconTemplate className="size-4 mr-2" />
                    Add full project setup
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuItem asChild>
                <Link href="/dashboard/templates">
                  <IconTemplate className="size-4 mr-2" />
                  Template Library
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleExportCSV}>
                <IconDownload className="size-4 mr-2" />
                Export CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setImportDialogOpen(true)}>
                <IconUpload className="size-4 mr-2" />
                Import CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setPrintDialogOpen(true)}>
                <IconPrinter className="size-4 mr-2" />
                Print timeframe…
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

      {/* The schedule is a document-scrolling workspace: preserve a useful view height
          after the compact toolbars, then let the dashboard scroll region carry it. */}
      <div
        className="flex min-h-[calc(100dvh-3.5rem)] flex-1 flex-col"
        data-schedule-view-content
      >
        {view === "calendar" && (
          isMobile && !globalMode ? (
            <ScheduleMobileView
              projectId={projectId ?? preferenceScopeKey}
              tasks={filteredTasks}
              exceptions={initialData.exceptions}
            />
          ) : (
            <ScheduleCalendarView
              projectId={projectId ?? preferenceScopeKey}
              tasks={filteredTasks}
              exceptions={initialData.exceptions}
              projects={scheduleProjects}
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
            projects={scheduleProjects}
            visibleColumns={visibleColumns}
          />
        )}
        {view === "gantt" && (
          <ScheduleGanttView
            projectId={projectId}
            tasks={filteredTasks}
            dependencies={initialData.dependencies}
            exceptions={initialData.exceptions}
            assigneeOptions={assigneeOptions}
            projects={scheduleProjects}
            ganttScrollMode={ganttScrollMode}
            groupByPhase={groupMode === "phase"}
            onGroupByPhaseChange={(grouped) =>
              setGroupMode(grouped ? "phase" : "none")
            }
          />
        )}
      </div>

      <div
        aria-hidden="true"
        className="h-[100dvh] shrink-0"
        data-schedule-scroll-reserve
      />

      {/* New schedule item dialog */}
      {projectId && (
        <>
          <ScheduleItemFormDialog
            open={taskFormOpen}
            onOpenChange={setTaskFormOpen}
            projectId={projectId}
            editingTask={null}
            allTasks={initialData.tasks.filter(
              (task) => task.projectId === projectId
            )}
            dependencies={initialData.dependencies}
            exceptions={initialData.exceptions.filter(
              (exception) => exception.projectId === projectId
            )}
            assigneeOptions={assigneeOptions}
            onBulkTemplateImport={() => {
              setTaskFormOpen(false)
              setBulkTemplateDialogOpen(true)
            }}
          />
          <ScheduleTemplateBulkImportDialog
            open={bulkTemplateDialogOpen}
            onOpenChange={setBulkTemplateDialogOpen}
            projectId={projectId}
          />
          <ScheduleTemplateDialog
            open={templateDialogOpen}
            onOpenChange={setTemplateDialogOpen}
            projectId={projectId}
          />
        </>
      )}

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

      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Publish schedule</DialogTitle>
            <DialogDescription>
              Owner and subcontractor workspaces will receive this schedule
              snapshot. Internal edits made afterward remain unpublished until
              the next release.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="schedule-publish-reason">Change reason</Label>
            <Textarea
              id="schedule-publish-reason"
              value={publishReason}
              onChange={(event) => setPublishReason(event.currentTarget.value)}
              placeholder="Summarize what changed and why..."
              rows={4}
              maxLength={500}
            />
            <p className="text-xs text-muted-foreground">
              This reason appears in the internal activity history.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setPublishOpen(false)}
              disabled={isPublishing}
            >
              Cancel
            </Button>
            <Button
              onClick={handlePublish}
              disabled={isPublishing || publishReason.trim().length < 3}
            >
              {isPublishing && (
                <IconLoader2 className="mr-1.5 size-4 animate-spin" />
              )}
              Publish
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={saveViewOpen} onOpenChange={setSaveViewOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save schedule view</DialogTitle>
            <DialogDescription>
              Save the current scope, filters, grouping, ordering, and columns.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="schedule-view-name">View name</Label>
              <Input
                id="schedule-view-name"
                value={saveViewName}
                onChange={(event) => setSaveViewName(event.target.value)}
                placeholder="Example: Wes · next 30 days"
                className="mt-1.5"
              />
            </div>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={saveViewShared}
                onCheckedChange={(checked) =>
                  setSaveViewShared(checked === true)
                }
              />
              <span>
                Share with internal staff
                <span className="block text-xs text-muted-foreground">
                  Personal views are visible only to you.
                </span>
              </span>
            </label>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setSaveViewOpen(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSaveView}
                disabled={!saveViewName.trim() || isSavingView}
              >
                {isSavingView ? (
                  <IconLoader2 className="size-4 animate-spin" />
                ) : (
                  <IconDeviceFloppy className="size-4" />
                )}
                Save view
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Baselines sheet */}
      <Sheet open={baselinesOpen} onOpenChange={setBaselinesOpen}>
        <SheetContent
          side="right"
          className="w-full overflow-y-auto sm:max-w-3xl xl:max-w-5xl"
        >
          <SheetHeader>
            <SheetTitle>Baselines</SheetTitle>
            <SheetDescription>
              Save and compare schedule snapshots.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4">
            {projectId ? (
              <ScheduleBaselineView
                projectId={projectId}
                baselines={baselines}
                currentTasks={initialData.tasks}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Choose one project to manage its baselines.
              </p>
            )}
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
            {projectId ? (
              <WorkdayExceptionsView
                projectId={projectId}
                exceptions={initialData.exceptions}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Choose one project to manage its workday exceptions.
              </p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
