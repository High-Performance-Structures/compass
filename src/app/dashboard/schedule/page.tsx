export const dynamic = "force-dynamic"

import { getWorkCalendar } from "@/app/actions/work-calendar"
import {
  getOwnerScheduleView,
  getScopedSchedule,
} from "@/app/actions/schedule"
import { getProjects } from "@/app/actions/projects"
import {
  WorkCalendar,
  type WorkCalendarKindFilter,
  type WorkCalendarView,
} from "@/components/schedule/work-calendar"
import { ScheduleView } from "@/components/schedule/schedule-view"
import { isValidDateKey } from "@/lib/work-calendar"
import { projectDepartment } from "@/lib/project-branding"
import type {
  ScheduleScope,
  ScheduleScopeKind,
} from "@/lib/schedule/project-scope"
import type { ProjectDepartment } from "@/lib/project-branding"
import { getScheduleSavedViews } from "@/app/actions/schedule-saved-views"
import { getUserSchedulePreferences } from "@/app/actions/user-schedule-preferences"
import { getSchedulePublicationStatus } from "@/app/actions/schedule-publications"
import { getCurrentUser } from "@/lib/auth"
import { scheduleAssigneeTerms } from "@/lib/schedule/saved-views"

function kindFilter(
  value: string | readonly string[] | undefined
): WorkCalendarKindFilter {
  const selected = typeof value === "string" ? value : value?.[0]

  switch (selected) {
    case "schedule":
    case "event":
    case "task":
    case "rfi":
    case "purchase_order":
      return selected
    default:
      return "all"
  }
}

function calendarView(
  value: string | readonly string[] | undefined
): WorkCalendarView {
  const selected = typeof value === "string" ? value : value?.[0]

  switch (selected) {
    case "today":
    case "week":
    case "month":
    case "list":
      return selected
    default:
      return "week"
  }
}

function firstValue(
  value: string | readonly string[] | undefined
): string | undefined {
  return typeof value === "string" ? value : value?.[0]
}

function isScopeKind(value: string | undefined): value is ScheduleScopeKind {
  return (
    value === "project" ||
    value === "selected" ||
    value === "department" ||
    value === "all"
  )
}

function isDepartment(
  value: string | undefined
): value is ProjectDepartment {
  return value === "O" || value === "H" || value === "N" || value === "D"
}

export default async function SchedulePage({
  searchParams,
}: {
  readonly searchParams: Promise<{
    readonly kind?: string | readonly string[]
    readonly item?: string | readonly string[]
    readonly view?: string | readonly string[]
    readonly date?: string | readonly string[]
    readonly mode?: string | readonly string[]
    readonly scope?: string | readonly string[]
    readonly project?: string | readonly string[]
    readonly projects?: string | readonly string[]
    readonly department?: string | readonly string[]
  }>
}): Promise<React.ReactElement> {
  const query = await searchParams
  if (firstValue(query.mode) === "projects") {
    const [allProjects, savedViews, currentUser, schedulePreferences] = await Promise.all([
      getProjects(),
      getScheduleSavedViews(),
      getCurrentUser(),
      getUserSchedulePreferences(),
    ])
    const requestedScope = firstValue(query.scope)
    const scopeKind = isScopeKind(requestedScope) ? requestedScope : "all"
    const requestedProjectId = firstValue(query.project)
    const requestedProjectIds = (firstValue(query.projects) ?? "")
      .split(",")
      .map((projectId) => projectId.trim())
      .filter(Boolean)
    const requestedDepartment = firstValue(query.department)
    const department = isDepartment(requestedDepartment)
      ? requestedDepartment
      : "O"
    const accessibleIds = new Set(allProjects.map((project) => project.id))
    const scopeProjectIds =
      scopeKind === "project"
        ? requestedProjectId && accessibleIds.has(requestedProjectId)
          ? [requestedProjectId]
          : allProjects[0]
            ? [allProjects[0].id]
            : []
        : scopeKind === "selected"
          ? requestedProjectIds.filter((projectId) =>
              accessibleIds.has(projectId)
            )
          : scopeKind === "department"
            ? allProjects
                .filter(
                  (project) =>
                    projectDepartment({
                      projectId: project.id,
                      projectNumber: project.projectNumber,
                    }) === department
                )
                .map((project) => project.id)
            : allProjects.map((project) => project.id)
    const safeProjectIds =
      scopeKind === "selected" && scopeProjectIds.length === 0
        ? allProjects[0]
          ? [allProjects[0].id]
          : []
        : scopeProjectIds
    const data = await getScopedSchedule(safeProjectIds)
    const scope: ScheduleScope =
      scopeKind === "project" && safeProjectIds[0]
        ? {
            kind: "project",
            projectIds: [safeProjectIds[0]],
            department: null,
          }
        : scopeKind === "selected"
          ? {
              kind: "selected",
              projectIds: safeProjectIds,
              department: null,
            }
          : scopeKind === "department"
            ? {
                kind: "department",
                projectIds: safeProjectIds,
                department,
              }
            : {
                kind: "all",
                projectIds: safeProjectIds,
                department: null,
              }
    const requestedView = firstValue(query.view)
    const initialView =
      requestedView === "calendar" ||
      requestedView === "list" ||
      requestedView === "gantt"
        ? requestedView
        : "gantt"
    const primaryProject = data.projects[0] ?? null
    const ownerScheduleView =
      scope.kind === "project" && primaryProject
        ? await getOwnerScheduleView(primaryProject.id)
        : "items"
    const publicationStatus =
      scope.kind === "project" && primaryProject
        ? await getSchedulePublicationStatus(primaryProject.id)
        : null

    return (
      <div className="flex min-h-full flex-col px-3 py-2 sm:px-4 lg:px-6">
        <ScheduleView
          projectId={scope.kind === "project" ? primaryProject?.id ?? null : null}
          projectName={
            primaryProject
              ? primaryProject.projectNumber ?? primaryProject.name
              : "Project schedules"
          }
          initialData={data}
          baselines={[]}
          allProjects={allProjects}
          scheduleProjects={data.projects}
          scope={scope}
          initialView={initialView}
          globalMode
          ownerScheduleView={ownerScheduleView}
          savedViews={savedViews}
          ganttScrollMode={schedulePreferences.ganttScrollMode}
          currentUserAssigneeTerms={scheduleAssigneeTerms(currentUser)}
          publicationStatus={publicationStatus}
        />
      </div>
    )
  }

  const requestedDate =
    typeof query.date === "string" ? query.date : query.date?.[0]
  const initialDate =
    requestedDate && isValidDateKey(requestedDate) ? requestedDate : undefined
  const data = await getWorkCalendar(initialDate)

  const initialItemId =
    typeof query.item === "string" ? query.item : query.item?.[0] ?? null

  return (
    <WorkCalendar
      data={data}
      initialKind={kindFilter(query.kind)}
      initialItemId={initialItemId}
      initialView={calendarView(query.view)}
      initialDate={initialDate}
    />
  )
}
