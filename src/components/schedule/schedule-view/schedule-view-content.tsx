"use client"

import { ScheduleWorkloadStrip } from "@/components/schedule/schedule-workload-strip"
import type { ScheduleConflict, ScheduleConflictSettings } from "@/lib/schedule/conflicts"
import type { ProjectTaskAssigneeOption } from "@/lib/domain/contacts/types"
import type { ScheduleProjectData } from "@/lib/schedule/project-scope"
import type { ScheduleData, ScheduleTaskData } from "@/lib/schedule/types"
import type { GanttScrollMode } from "@/lib/schedule/gantt-interaction-mode"
import type { ScheduleGroupMode, ScheduleListColumn } from "@/lib/schedule/saved-views"
import { ScheduleListView } from "../schedule-list-view"
import { ScheduleGanttView } from "../schedule-gantt-view"
import { ScheduleCalendarView } from "../schedule-calendar-view"
import { ScheduleMobileView } from "../schedule-mobile-view"
import type { View } from "./schedule-view-rules"

/** The calendar, list or Gantt view of the visible items. */
export function ScheduleViewContent({
  view,
  isMobile,
  globalMode,
  projectId,
  preferenceScopeKey,
  filteredTasks,
  initialData,
  scheduleProjects,
  multipleJobs,
  conflicts,
  conflictsOnly,
  setConflictsOnly,
  assigneeOptions,
  focusTaskId,
  visibleColumns,
  shiftReasonRequired,
  ganttScrollMode,
  groupMode,
  setGroupMode,
  conflictSettings,
}: {
  readonly view: View
  readonly isMobile: boolean
  readonly globalMode: boolean
  readonly projectId: string | null
  readonly preferenceScopeKey: string
  readonly filteredTasks: ScheduleTaskData[]
  readonly initialData: ScheduleData
  readonly scheduleProjects: readonly ScheduleProjectData[]
  readonly multipleJobs: boolean
  readonly conflicts: ReadonlyMap<string, readonly ScheduleConflict[]>
  readonly conflictsOnly: boolean
  readonly setConflictsOnly: (conflictsOnly: boolean) => void
  readonly assigneeOptions: readonly ProjectTaskAssigneeOption[]
  readonly focusTaskId: string | null
  readonly visibleColumns: readonly ScheduleListColumn[]
  readonly shiftReasonRequired: boolean
  readonly ganttScrollMode: GanttScrollMode
  readonly groupMode: ScheduleGroupMode
  readonly setGroupMode: (groupMode: ScheduleGroupMode) => void
  readonly conflictSettings: ScheduleConflictSettings
}) {
  // The schedule is a document-scrolling workspace: preserve a useful view height
  // after the compact toolbars, then let the dashboard scroll region carry it.
  return (
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
      {multipleJobs && view !== "calendar" ? (
        <ScheduleWorkloadStrip
          tasks={initialData.tasks}
          conflicts={conflicts}
          conflictsOnly={conflictsOnly}
          onConflictsOnlyChange={setConflictsOnly}
        />
      ) : null}
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
          conflicts={conflicts}
          shiftReasonRequired={shiftReasonRequired}
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
          groupByCrew={groupMode === "crew"}
          conflictSettings={conflictSettings}
          conflicts={conflicts}
          onGroupByPhaseChange={(grouped) =>
            setGroupMode(grouped ? "phase" : "none")
          }
          shiftReasonRequired={shiftReasonRequired}
        />
      )}
    </div>
  )
}
