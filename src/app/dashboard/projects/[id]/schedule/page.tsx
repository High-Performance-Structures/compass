export const dynamic = "force-dynamic"

import { decodeProjectRouteId } from "@/lib/project-route-id"
import { getCloudflareContext } from "@/lib/db"
import { getDb } from "@/db"
import { projects } from "@/db/schema"
import { eq } from "drizzle-orm"
import { notFound } from "next/navigation"
import { getSchedule } from "@/app/actions/schedule"
import { getBaselines } from "@/app/actions/baselines"
import { getProjects, type ProjectListItem } from "@/app/actions/projects"
import {
  getProjectTaskAssigneeOptions,
  type ProjectTaskAssigneeOption,
} from "@/app/actions/project-contacts"
import { ScheduleView } from "@/components/schedule/schedule-view"
import type { ScheduleData, ScheduleBaselineData } from "@/lib/schedule/types"
import type { OwnerScheduleView } from "@/lib/schedule/owner-visibility"
import { getScheduleSavedViews } from "@/app/actions/schedule-saved-views"
import { getUserSchedulePreferences } from "@/app/actions/user-schedule-preferences"
import {
  getSchedulePublicationStatus,
  type SchedulePublicationStatus,
} from "@/app/actions/schedule-publications"
import { getCurrentUser } from "@/lib/auth"
import { scheduleAssigneeTerms } from "@/lib/schedule/saved-views"

const emptySchedule: ScheduleData = {
  tasks: [],
  dependencies: [],
  exceptions: [],
}

export default async function SchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{
    readonly view?: string | readonly string[]
    readonly item?: string | readonly string[]
  }>
}) {
  const [{ id: rawProjectId }, query] = await Promise.all([params, searchParams])
  const id = decodeProjectRouteId(rawProjectId)
  const requestedView =
    typeof query.view === "string" ? query.view : query.view?.[0]
  const initialView =
    requestedView === "calendar" ||
    requestedView === "list" ||
    requestedView === "gantt"
      ? requestedView
      : undefined
  const focusTaskId =
    typeof query.item === "string" ? query.item : query.item?.[0] ?? null

  let projectName = "Project"
  let schedule: ScheduleData = emptySchedule
  let baselines: ScheduleBaselineData[] = []
  let allProjects: ProjectListItem[] = []
  let assigneeOptions: ProjectTaskAssigneeOption[] = []
  let ownerScheduleView: OwnerScheduleView = "items"
  let publicationStatus: SchedulePublicationStatus | null = null
  const [savedViews, currentUser, schedulePreferences] = await Promise.all([
    getScheduleSavedViews(),
    getCurrentUser(),
    getUserSchedulePreferences(),
  ])

  try {
    const { env } = await getCloudflareContext()
    if (!env?.DB) throw new Error("D1 not available")

    const db = getDb(env.DB)
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, id))
      .limit(1)

    if (!project) notFound()

    projectName = project.projectNumber ?? project.name
    ownerScheduleView =
      project.ownerScheduleView === "phases" ? "phases" : "items"
    ;[schedule, baselines, allProjects, publicationStatus] = await Promise.all([
      getSchedule(id),
      getBaselines(id),
      getProjects(),
      getSchedulePublicationStatus(id),
    ])
  } catch (e: unknown) {
    if (e && typeof e === "object" && "digest" in e && e.digest === "NEXT_NOT_FOUND") throw e
    console.warn("D1 unavailable in dev mode, using empty data")
  }

  try {
    const assigneeData = await getProjectTaskAssigneeOptions(id)
    assigneeOptions = [
      ...assigneeData.projectContacts,
      ...assigneeData.directoryContacts,
    ]
  } catch (error) {
    console.warn("Unable to load schedule assignee options", error)
  }

  return (
    <div className="flex min-h-full flex-col px-3 py-2 sm:px-4 lg:px-6">
      <ScheduleView
        projectId={id}
        projectName={projectName}
        initialData={schedule}
        baselines={baselines}
        allProjects={allProjects}
        assigneeOptions={assigneeOptions}
        initialView={focusTaskId ? "list" : initialView}
        focusTaskId={focusTaskId}
        ownerScheduleView={ownerScheduleView}
        savedViews={savedViews}
        ganttScrollMode={schedulePreferences.ganttScrollMode}
        currentUserAssigneeTerms={scheduleAssigneeTerms(currentUser)}
        publicationStatus={publicationStatus}
      />
    </div>
  )
}
