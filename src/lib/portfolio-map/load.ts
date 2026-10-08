import { and, asc, eq, gte, lt, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { projects, scheduleTasks } from "@/db/schema"
import { getProjects } from "@/app/actions/projects"
import { getCurrentUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { dateKeyInTimeZone } from "@/lib/work-calendar"
import {
  phaseForJobStatus,
  portfolioHealth,
  resolveTown,
  spreadSharedTowns,
  type PortfolioMapJob,
} from "@/lib/portfolio-map/model"

const TIME_ZONE = "America/Denver"

export type PortfolioMapData = {
  readonly jobs: readonly PortfolioMapJob[]
  /** Jobs in a mapped phase whose town could not be resolved. */
  readonly unplacedCount: number
}

const EMPTY: PortfolioMapData = { jobs: [], unplacedCount: 0 }

/**
 * Jobs for the office portfolio map. Visibility follows getProjects(), so the
 * map never shows a job the person cannot already open.
 */
export async function getPortfolioMapData(): Promise<PortfolioMapData> {
  try {
    const user = await getCurrentUser()
    if (!user?.organizationId) return EMPTY
    const visible = await getProjects()
    const phased = visible.flatMap((project) => {
      const phase = phaseForJobStatus(project.jobStatusId, project.jobStatusLabel)
      return phase ? [{ project, phase }] : []
    })
    if (phased.length === 0) return EMPTY

    const { env } = await getCloudflareContext()
    if (!env?.DB) return EMPTY
    const db = getDb(env.DB)
    const orgId = user.organizationId
    const today = dateKeyInTimeZone(new Date(), TIME_ZONE)

    const [locations, taskStats, upcoming] = await Promise.all([
      db
        .select({
          id: projects.id,
          address: projects.address,
          publicLocationCity: projects.publicLocationCity,
        })
        .from(projects)
        .where(eq(projects.organizationId, orgId)),
      // Aggregate in SQL rather than loading every task row.
      db
        .select({
          projectId: scheduleTasks.projectId,
          progress: sql<number | null>`avg(${scheduleTasks.percentComplete})`,
          pastDue: sql<number>`sum(case when ${scheduleTasks.endDateCalculated} < ${today} and ${scheduleTasks.percentComplete} < 100 then 1 else 0 end)`,
          stalled: sql<number>`sum(case when ${scheduleTasks.startDate} <= ${today} and ${scheduleTasks.endDateCalculated} >= ${today} and ${scheduleTasks.percentComplete} = 0 then 1 else 0 end)`,
        })
        .from(scheduleTasks)
        .innerJoin(projects, eq(scheduleTasks.projectId, projects.id))
        .where(eq(projects.organizationId, orgId))
        .groupBy(scheduleTasks.projectId),
      db
        .select({
          projectId: scheduleTasks.projectId,
          title: scheduleTasks.title,
          startDate: scheduleTasks.startDate,
        })
        .from(scheduleTasks)
        .innerJoin(projects, eq(scheduleTasks.projectId, projects.id))
        .where(
          and(
            eq(projects.organizationId, orgId),
            gte(scheduleTasks.endDateCalculated, today),
            lt(scheduleTasks.percentComplete, 100),
          ),
        )
        .orderBy(asc(scheduleTasks.startDate), asc(scheduleTasks.sortOrder)),
    ])

    const locationById = new Map(locations.map((row) => [row.id, row]))
    const statsById = new Map(taskStats.map((row) => [row.projectId, row]))
    const nextById = new Map<string, { readonly title: string; readonly startDate: string }>()
    for (const task of upcoming) {
      if (!nextById.has(task.projectId)) nextById.set(task.projectId, task)
    }

    let unplacedCount = 0
    const jobs: PortfolioMapJob[] = phased.map(({ project, phase }) => {
      const location = locationById.get(project.id)
      const town = resolveTown({
        publicLocationCity: location?.publicLocationCity ?? null,
        address: location?.address ?? null,
        name: project.name,
      })
      if (!town) unplacedCount += 1
      const stats = statsById.get(project.id)
      const pastDueCount = Number(stats?.pastDue ?? 0)
      const stalledCount = Number(stats?.stalled ?? 0)
      const next = nextById.get(project.id)
      return {
        id: project.id,
        name: project.name,
        projectNumber: project.projectNumber,
        phase,
        statusLabel: project.jobStatusLabel,
        town: town?.town ?? null,
        lon: town?.lon ?? null,
        lat: town?.lat ?? null,
        progress:
          stats?.progress === null || stats?.progress === undefined
            ? null
            : Math.round(Number(stats.progress)),
        pastDueCount,
        stalledCount,
        nextTaskTitle: next?.title ?? null,
        nextTaskStart: next?.startDate ?? null,
        health: portfolioHealth(pastDueCount, stalledCount),
      }
    })
    return { jobs: spreadSharedTowns(jobs), unplacedCount }
  } catch (error) {
    console.error("Portfolio map data failed", error)
    return EMPTY
  }
}
