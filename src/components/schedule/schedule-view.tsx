"use client"

import {
  findScheduleConflicts,
  NO_CONFLICT_SETTINGS,
  type ScheduleConflictSettings,
} from "@/lib/schedule/conflicts"
import { useDepartmentProfiles } from "@/components/branding/department-profiles-provider"
import { useQuickAddEntry } from "@/hooks/use-quick-add-entry"

import {
  useState,
  useMemo,
} from "react"
import { flushSync } from "react-dom"
import { useIsMobile } from "@/hooks/use-mobile"
import { toast } from "sonner"
import {
  previewScheduleDocument,
  SchedulePrintDocument,
} from "./schedule-print-document"
import {
  SchedulePrintDialog,
  type SchedulePrintSelection,
} from "./schedule-print-dialog"
import type { ProjectListItem } from "@/app/actions/projects"
import type { ProjectTaskAssigneeOption } from "@/lib/domain/contacts/types"
import type {
  ScheduleProjectData,
  ScheduleScope,
} from "@/lib/schedule/project-scope"
import type {
  ScheduleData,
  ScheduleBaselineData,
} from "@/lib/schedule/types"
import type { OwnerScheduleView } from "@/lib/schedule/owner-visibility"
import type { GanttScrollMode } from "@/lib/schedule/gantt-interaction-mode"
import { projectBrandFor } from "@/lib/project-branding"
import type { SchedulePublicationStatus } from "@/app/actions/schedule-publications"
import type { SavedScheduleViewData } from "@/lib/schedule/saved-views"
import {
  scheduleCsv,
  schedulePhaseOptions,
  schedulePrintItems,
  visibleScheduleTasks,
  type View,
} from "./schedule-view/schedule-view-rules"
import { useScheduleViewState } from "./schedule-view/use-schedule-view-state"
import { useSchedulePublication } from "./schedule-view/use-schedule-publication"
import { useSavedScheduleViews } from "./schedule-view/use-saved-schedule-views"
import { ScheduleHeaderToolbar } from "./schedule-view/schedule-header-toolbar"
import { SchedulePublicationBar } from "./schedule-view/schedule-publication-bar"
import { ScheduleActionBar } from "./schedule-view/schedule-action-bar"
import { ScheduleCsvImportDialog } from "./schedule-view/schedule-csv-import-dialog"
import { SchedulePublishDialogs } from "./schedule-view/schedule-publish-dialogs"
import { SaveScheduleViewDialog } from "./schedule-view/save-schedule-view-dialog"
import { ScheduleSideSheets } from "./schedule-view/schedule-side-sheets"
import { ScheduleProjectDialogs } from "./schedule-view/schedule-project-dialogs"
import { ScheduleViewContent } from "./schedule-view/schedule-view-content"

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
  readonly canManagePublication?: boolean
  /** Names never flagged and other spellings, for cross-job conflict markers. */
  readonly conflictSettings?: ScheduleConflictSettings
}

// Stable default: a fresh [] per render invalidated the Gantt task memo and
// rebuilt the chart.
const NO_SCHEDULE_PROJECTS: readonly ScheduleProjectData[] = []

export function ScheduleView({
  projectId,
  projectName,
  initialData,
  baselines,
  allProjects = [],
  scheduleProjects = NO_SCHEDULE_PROJECTS,
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
  canManagePublication = false,
  conflictSettings = NO_CONFLICT_SETTINGS,
}: ScheduleViewProps) {
  const isMobile = useIsMobile()
  const activeProject = projectId
    ? allProjects.find((project) => project.id === projectId) ??
      scheduleProjects.find((project) => project.id === projectId)
    : undefined
  const departmentProfiles = useDepartmentProfiles()
  const printBrand = projectId
    ? projectBrandFor({
        profiles: departmentProfiles,
        projectId,
        projectNumber: activeProject?.projectNumber,
      })
    : null
  const preferenceScopeKey = projectId ?? "unified"
  const viewState = useScheduleViewState(initialView, preferenceScopeKey)
  const {
    view,
    setView,
    orderMode,
    filters,
    preset,
    conflictsOnly,
    setConflictsOnly,
    groupMode,
    setGroupMode,
    visibleColumns,
  } = viewState
  const [taskFormOpen, setTaskFormOpen] = useState(initialTaskFormOpen)
  useQuickAddEntry("schedule-item", () => setTaskFormOpen(true))
  const savedViewsState = useSavedScheduleViews(
    initialSavedViews,
    viewState.currentViewDefinition
  )
  const [baselinesOpen, setBaselinesOpen] = useState(false)
  const [exceptionsOpen, setExceptionsOpen] = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [printDialogOpen, setPrintDialogOpen] = useState(false)
  const [printSelection, setPrintSelection] =
    useState<SchedulePrintSelection | null>(null)
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false)
  const [bulkTemplateDialogOpen, setBulkTemplateDialogOpen] = useState(false)
  const [saveTemplateDialogOpen, setSaveTemplateDialogOpen] = useState(false)
  const publication = useSchedulePublication(projectId, initialPublicationStatus)
  const { publicationStatus } = publication

  const projectTaskIds = useMemo(
    () =>
      new Set(
        initialData.tasks
          .filter((task) => task.projectId === projectId)
          .map((task) => task.id)
      ),
    [initialData.tasks, projectId]
  )
  // Unknown (several projects at once) keeps asking; the server decides.
  const shiftReasonRequired = publicationStatus?.shiftReasonRequired ?? true

  const phaseOptions = useMemo(
    () => schedulePhaseOptions(initialData.tasks),
    [initialData.tasks]
  )

  // Conflicts look at the whole schedule, not just what the filters show.
  const conflicts = useMemo(
    () => findScheduleConflicts(initialData.tasks, conflictSettings),
    [conflictSettings, initialData.tasks]
  )
  const multipleJobs = scheduleProjects.length > 1

  const filteredTasks = useMemo(
    () =>
      visibleScheduleTasks({
        tasks: initialData.tasks,
        conflicts,
        conflictsOnly,
        filters,
        preset,
        currentUserAssigneeTerms,
        orderMode,
        groupMode,
        scheduleProjects,
        conflictSettings,
        now: new Date(),
      }),
    [
      conflictSettings,
      conflicts,
      conflictsOnly,
      currentUserAssigneeTerms,
      filters,
      groupMode,
      initialData.tasks,
      orderMode,
      preset,
      scheduleProjects,
    ]
  )
  const printItems = useMemo(
    () => schedulePrintItems(filteredTasks),
    [filteredTasks]
  )

  // CSV export
  const handleExportCSV = () => {
    const csvContent = scheduleCsv(filteredTasks, scheduleProjects)
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
    const link = document.createElement("a")
    link.download = `${projectName.replace(/\s+/g, "-")}-schedule-${new Date().toISOString().split("T")[0]}.csv`
    link.href = URL.createObjectURL(blob)
    link.click()
    URL.revokeObjectURL(link.href)
  }

  function printSchedule(selection: SchedulePrintSelection): void {
    // Commit the selected layout and timeframe so the print document holds
    // them before its markup is saved for the preview.
    flushSync(() => {
      setPrintSelection(selection)
    })
    void previewScheduleDocument({ projectId: projectId ?? null, title: projectName })
      .then((result) => {
        if (!result.success) toast.error(result.error)
      })
      .finally(() => setPrintSelection(null))
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
      <ScheduleHeaderToolbar
        projectId={projectId}
        projectName={projectName}
        globalMode={globalMode}
        scope={scope}
        allProjects={allProjects}
        scheduleProjects={scheduleProjects}
        ownerScheduleView={ownerScheduleView}
        view={view}
        setView={setView}
        setTaskFormOpen={setTaskFormOpen}
      />

      {projectId && publicationStatus && (
        <SchedulePublicationBar
          publicationStatus={publicationStatus}
          canManagePublication={canManagePublication}
          setPublishOpen={publication.setPublishOpen}
          setMoveToDraftOpen={publication.setMoveToDraftOpen}
        />
      )}

      {/* Action bar: search, filters, overflow */}
      <ScheduleActionBar
        viewState={viewState}
        savedViewsState={savedViewsState}
        phaseOptions={phaseOptions}
        visibleCount={filteredTasks.length}
        overflowMenu={{
          projectId,
          setBulkTemplateDialogOpen,
          setTemplateDialogOpen,
          setSaveTemplateDialogOpen,
          handleExportCSV,
          setImportDialogOpen,
          setPrintDialogOpen,
          setBaselinesOpen,
          setExceptionsOpen,
        }}
      />

      <ScheduleViewContent
        view={view}
        isMobile={isMobile}
        globalMode={globalMode}
        projectId={projectId}
        preferenceScopeKey={preferenceScopeKey}
        filteredTasks={filteredTasks}
        initialData={initialData}
        scheduleProjects={scheduleProjects}
        multipleJobs={multipleJobs}
        conflicts={conflicts}
        conflictsOnly={conflictsOnly}
        setConflictsOnly={setConflictsOnly}
        assigneeOptions={assigneeOptions}
        focusTaskId={focusTaskId}
        visibleColumns={visibleColumns}
        shiftReasonRequired={shiftReasonRequired}
        ganttScrollMode={ganttScrollMode}
        groupMode={groupMode}
        setGroupMode={setGroupMode}
        conflictSettings={conflictSettings}
      />

      <div
        aria-hidden="true"
        className="h-[100dvh] shrink-0"
        data-schedule-scroll-reserve
      />

      {/* New schedule item dialog */}
      {projectId && (
        <ScheduleProjectDialogs
          projectId={projectId}
          projectName={projectName}
          initialData={initialData}
          assigneeOptions={assigneeOptions}
          projectTaskIds={projectTaskIds}
          shiftReasonRequired={shiftReasonRequired}
          taskFormOpen={taskFormOpen}
          setTaskFormOpen={setTaskFormOpen}
          bulkTemplateDialogOpen={bulkTemplateDialogOpen}
          setBulkTemplateDialogOpen={setBulkTemplateDialogOpen}
          templateDialogOpen={templateDialogOpen}
          setTemplateDialogOpen={setTemplateDialogOpen}
          saveTemplateDialogOpen={saveTemplateDialogOpen}
          setSaveTemplateDialogOpen={setSaveTemplateDialogOpen}
        />
      )}

      {/* Import dialog */}
      <ScheduleCsvImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
      />

      <SchedulePublishDialogs publication={publication} />

      <SaveScheduleViewDialog savedViewsState={savedViewsState} />

      <ScheduleSideSheets
        projectId={projectId}
        baselines={baselines}
        initialData={initialData}
        shiftReasonRequired={shiftReasonRequired}
        baselinesOpen={baselinesOpen}
        setBaselinesOpen={setBaselinesOpen}
        exceptionsOpen={exceptionsOpen}
        setExceptionsOpen={setExceptionsOpen}
      />
    </div>
  )
}
