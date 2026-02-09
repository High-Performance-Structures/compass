export const dynamic = "force-dynamic"

import { getDb } from "@/lib/db-universal"
import { projects } from "@/db/schema"
import { eq } from "drizzle-orm"
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

  try {
    const { env } = { env: { DB: null } }
    if (!db) throw new Error("D1 not available")

    const db = getDb(db)
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, id))
      .limit(1)

    if (!project) notFound()

    projectName = project.name
    ;[schedule, baselines] = await Promise.all([
      getSchedule(id),
      getBaselines(id),
    ])
  } catch (e: unknown) {
    if (e && typeof e === "object" && "digest" in e && e.digest === "NEXT_NOT_FOUND") throw e
    console.warn("D1 unavailable in dev mode, using empty data")
  }

  return (
    <div 
      className="px-4 py-2 flex flex-col flex-1 min-h-0"
      data-schedule-theme=""
    >
      <ScheduleView
        projectId={id}
        projectName={projectName}
        initialData={schedule}
        baselines={baselines}
      />
    </div>
  )
}
