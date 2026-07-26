export const dynamic = "force-dynamic"

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

const emptySchedule: ScheduleData = {
  tasks: [],
  dependencies: [],
  exceptions: [],
}

export default async function SchedulePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  let projectName = "Project"
  let schedule: ScheduleData = emptySchedule
  let baselines: ScheduleBaselineData[] = []
  let allProjects: ProjectListItem[] = []
  let assigneeOptions: ProjectTaskAssigneeOption[] = []

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
    ;[schedule, baselines, allProjects] = await Promise.all([
      getSchedule(id),
      getBaselines(id),
      getProjects(),
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
    <div className="px-4 py-2 flex flex-col flex-1 min-h-0">
      <ScheduleView
        projectId={id}
        projectName={projectName}
        initialData={schedule}
        baselines={baselines}
        allProjects={allProjects}
        assigneeOptions={assigneeOptions}
      />
    </div>
  )
}
