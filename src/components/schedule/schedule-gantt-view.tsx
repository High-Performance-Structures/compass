"use client"

import {
  NO_CONFLICT_SETTINGS,
  type ScheduleConflict,
  type ScheduleConflictSettings,
} from "@/lib/schedule/conflicts"
import {
  useState,
  useCallback,
  useEffect,
  useMemo,
} from "react"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { useIsMobile } from "@/hooks/use-mobile"
import { GanttChart } from "./gantt-chart"
import { ScheduleItemFormDialog } from "./schedule-item-form-dialog"
import type { FrappeTask } from "@/lib/schedule/gantt-transform"
import type { GanttScrollMode } from "@/lib/schedule/gantt-interaction-mode"
import type {
  ScheduleTaskData,
  TaskDependencyData,
  WorkdayExceptionData,
} from "@/lib/schedule/types"
import type { ProjectTaskAssigneeOption } from "@/lib/domain/contacts/types"
import type { ScheduleProjectData } from "@/lib/schedule/project-scope"
import {
  DEFAULT_COLUMN_WIDTHS,
  ganttDisplay,
  zoomedColumnWidth,
  type ViewMode,
} from "./schedule-gantt/gantt-view-rules"
import { useGanttPalette } from "./schedule-gantt/use-gantt-palette"
import { useGanttScrollSync } from "./schedule-gantt/use-gantt-scroll-sync"
import { GanttTaskTable } from "./schedule-gantt/gantt-task-table"
import { GanttScheduleKey } from "./schedule-gantt/gantt-schedule-key"
import { GanttControls } from "./schedule-gantt/gantt-controls"
import { useGanttDateChange } from "./schedule-gantt/use-gantt-date-change"

// Stable empty list: a fresh [] per render rebuilt the whole Gantt chart.
const NO_EXCEPTIONS: readonly WorkdayExceptionData[] = []

interface ScheduleGanttViewProps {
  readonly projectId: string | null
  readonly tasks: readonly ScheduleTaskData[]
  readonly dependencies: readonly TaskDependencyData[]
  readonly exceptions: readonly WorkdayExceptionData[]
  readonly assigneeOptions: readonly ProjectTaskAssigneeOption[]
  readonly projects?: readonly ScheduleProjectData[]
  readonly ganttScrollMode?: GanttScrollMode
  readonly groupByPhase?: boolean
  /** One group per crew or company (the item's first "Assigned to" name). */
  readonly groupByCrew?: boolean
  readonly conflictSettings?: ScheduleConflictSettings
  /** Items whose crew is booked on another job over the same days. */
  readonly conflicts?: ReadonlyMap<string, readonly ScheduleConflict[]>
  readonly onGroupByPhaseChange?: (grouped: boolean) => void
  /** False until the schedule is first published; drafts need no shift reason. */
  readonly shiftReasonRequired?: boolean
}

const NO_CONFLICTS: ReadonlyMap<string, readonly ScheduleConflict[]> = new Map()

export function ScheduleGanttView({
  projectId,
  tasks,
  dependencies,
  exceptions,
  assigneeOptions,
  projects = [],
  groupByPhase = false,
  groupByCrew = false,
  conflictSettings = NO_CONFLICT_SETTINGS,
  conflicts = NO_CONFLICTS,
  onGroupByPhaseChange,
  shiftReasonRequired = true,
}: ScheduleGanttViewProps) {
  const isMobile = useIsMobile()
  const [viewMode, setViewMode] = useState<ViewMode>("Week")
  const [phaseGrouping, setPhaseGrouping] = useState(false)
  const [collapsedPhases, setCollapsedPhases] = useState<Set<string>>(
    new Set()
  )
  const [showCriticalPath, setShowCriticalPath] = useState(false)
  const [showScheduleKey, setShowScheduleKey] = useState(false)
  const [editingScheduleKey, setEditingScheduleKey] = useState(false)
  const [taskFormOpen, setTaskFormOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<ScheduleTaskData | null>(
    null
  )
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null)
  const [mobileView, setMobileView] = useState<"tasks" | "chart">("chart")
  const [ganttRevision, setGanttRevision] = useState(0)
  const [panMode] = useState(false)
  const preferenceScopeKey = projectId ?? "unified"
  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects]
  )
  const multipleProjects = projectById.size > 1

  useEffect(() => {
    setPhaseGrouping(groupByPhase)
  }, [groupByPhase])

  const palette = useGanttPalette(preferenceScopeKey)
  const [columnWidth, setColumnWidth] = useState(DEFAULT_COLUMN_WIDTHS[viewMode])

  const handleZoom = useCallback((direction: "in" | "out") => {
    setColumnWidth((prev) => zoomedColumnWidth(prev, direction))
  }, [])

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode)
    setColumnWidth(DEFAULT_COLUMN_WIDTHS[mode])
  }

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

  const { frappeTasks, displayItems } = useMemo(
    () =>
      ganttDisplay({
        tasks,
        dependencies,
        collapsedPhases,
        groupByCrew,
        phaseGrouping,
        conflictSettings,
        conflicts,
        multipleProjects,
        projectById,
      }),
    [
      conflictSettings,
      conflicts,
      groupByCrew,
      collapsedPhases,
      dependencies,
      tasks,
      multipleProjects,
      phaseGrouping,
      projectById,
    ]
  )
  const scroll = useGanttScrollSync({
    projectId,
    isMobile,
    displayItems,
    setFocusedTaskId,
  })
  const togglePhase = (phase: string) => {
    setCollapsedPhases((prev) => {
      const next = new Set(prev)
      if (next.has(phase)) next.delete(phase)
      else next.add(phase)
      return next
    })
  }

  const handleDateChange = useGanttDateChange({
    tasks,
    exceptions,
    shiftReasonRequired,
    setGanttRevision,
  })

  const taskTable = (
    <GanttTaskTable
      displayItems={displayItems}
      togglePhase={togglePhase}
      projectById={projectById}
      multipleProjects={multipleProjects}
      conflicts={conflicts}
      focusedTaskId={focusedTaskId}
      focusTaskOnTimeline={scroll.focusTaskOnTimeline}
      phaseGrouping={phaseGrouping}
      groupByCrew={groupByCrew}
      assigneeOptions={assigneeOptions}
      projectId={projectId}
      onEditTask={(task) => {
        setFocusedTaskId(task.id)
        setEditingTask(task)
        setTaskFormOpen(true)
      }}
      onAddTask={() => {
        setEditingTask(null)
        setTaskFormOpen(true)
      }}
    />
  )

  const scheduleKey = (
    <GanttScheduleKey
      palette={palette}
      showScheduleKey={showScheduleKey}
      setShowScheduleKey={setShowScheduleKey}
      editingScheduleKey={editingScheduleKey}
      setEditingScheduleKey={setEditingScheduleKey}
    />
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <GanttControls
        isMobile={isMobile}
        mobileView={mobileView}
        setMobileView={setMobileView}
        viewMode={viewMode}
        handleViewModeChange={handleViewModeChange}
        scrollToToday={scroll.scrollToToday}
        handleZoom={handleZoom}
        phaseGrouping={phaseGrouping}
        setPhaseGrouping={setPhaseGrouping}
        onGroupByPhaseChange={onGroupByPhaseChange}
        showCriticalPath={showCriticalPath}
        setShowCriticalPath={setShowCriticalPath}
      />

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
                key={`mobile-gantt-${ganttRevision}`}
                tasks={frappeTasks}
                exceptions={multipleProjects ? NO_EXCEPTIONS : exceptions}
                viewMode={viewMode}
                columnWidth={columnWidth}
                panMode={panMode}
                onDateChange={handleDateChange}
                criticalPathMode={showCriticalPath}
                focusedTaskId={focusedTaskId}
                displayColorPalette={palette.displayColorPalette}
                onZoom={handleZoom}
                onTaskDoubleClick={openTaskEditor}
                onContainerReady={scroll.handleGanttContainerReady}
                onScrollPositionChange={scroll.handleGanttScroll}
                onTodayClick={scroll.scrollToToday}
                onTodayScrollReady={scroll.handleTodayScrollReady}
                onDateScrollReady={scroll.handleDateScrollReady}
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
              ref={scroll.taskListRef}
              className="schedule-gantt-task-list h-full min-w-0 overflow-auto"
              onScroll={scroll.handleTaskListScroll}
            >
              {taskTable}
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize="70%" minSize="40%">
            <div className="relative h-full min-w-0 overflow-hidden">
              <GanttChart
                key={`desktop-gantt-${ganttRevision}`}
                tasks={frappeTasks}
                exceptions={multipleProjects ? NO_EXCEPTIONS : exceptions}
                viewMode={viewMode}
                columnWidth={columnWidth}
                panMode={panMode}
                onDateChange={handleDateChange}
                criticalPathMode={showCriticalPath}
                focusedTaskId={focusedTaskId}
                displayColorPalette={palette.displayColorPalette}
                onZoom={handleZoom}
                onTaskDoubleClick={openTaskEditor}
                onContainerReady={scroll.handleGanttContainerReady}
                onScrollPositionChange={scroll.handleGanttScroll}
                onTodayClick={scroll.scrollToToday}
                onTodayScrollReady={scroll.handleTodayScrollReady}
                onDateScrollReady={scroll.handleDateScrollReady}
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
          shiftReasonRequired={shiftReasonRequired}
        />
      )}
    </div>
  )
}
