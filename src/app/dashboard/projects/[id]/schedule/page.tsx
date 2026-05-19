export const dynamic = "force-dynamic"

import { getCloudflareContext } from "@/lib/db"
import { getDb } from "@/db"
import { projects } from "@/db/schema"
import { eq, asc } from "drizzle-orm"
import { notFound } from "next/navigation"
import { getSchedule } from "@/app/actions/schedule"
import { getBaselines } from "@/app/actions/baselines"
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
  let allProjects: { id: string; name: string; projectNumber: string | null }[] = []

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
      db
        .select({
          id: projects.id,
          name: projects.name,
          projectNumber: projects.projectNumber,
        })
        .from(projects)
        .orderBy(asc(projects.projectNumber), asc(projects.name)),
    ])
  } catch (e: unknown) {
    if (e && typeof e === "object" && "digest" in e && e.digest === "NEXT_NOT_FOUND") throw e
    console.warn("D1 unavailable in dev mode, using empty data")
  }

  return (
    <div className="px-4 py-2 flex flex-col flex-1 min-h-0">
      <ScheduleView
        projectId={id}
        projectName={projectName}
        initialData={schedule}
        baselines={baselines}
        allProjects={allProjects}
      />
    </div>
  )
}
