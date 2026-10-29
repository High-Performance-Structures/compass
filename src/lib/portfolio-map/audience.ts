import { and, eq, inArray } from "drizzle-orm"
import { getDb } from "@/db"
import { projectJobStatuses, projects } from "@/db/schema"
import { getCloudflareContext } from "@/lib/db"
import { projectJobStatusLabel } from "@/lib/project-profile"
import { COLORADO_PLACES, type PortfolioMapJob } from "@/lib/portfolio-map/model"
import { audienceMapJobs } from "@/lib/portfolio-map/audience-model"
import { placeIndexResolver } from "@/lib/portfolio-map/places-server"
import { readPortfolioMapRules } from "@/lib/portfolio-map/rules-server"
import { DEFAULT_MAP_STATE, type MapStateCode } from "@/lib/portfolio-map/states"

export type AudienceJobMap = {
  readonly jobs: readonly PortfolioMapJob[]
  /** The contractor's map state (of the first project passed). */
  readonly mapState: MapStateCode
}

const EMPTY: AudienceJobMap = { jobs: [], mapState: DEFAULT_MAP_STATE }

/**
 * Map jobs for the owner and sub/vendor dashboards. Callers pass project ids
 * the viewer already has (their project switcher or the current project,
 * resolved server-side for that viewer), so the map never reveals a job they
 * could not already open. Server-only: not a server action, so clients cannot
 * pass arbitrary ids.
 */
export async function getAudienceJobMap(projectIds: readonly string[]): Promise<AudienceJobMap> {
  const first = projectIds[0]
  if (!first) return EMPTY
  try {
    const { env } = await getCloudflareContext()
    if (!env?.DB) return EMPTY
    const db = getDb(env.DB)
    const rows = await db
      .select({
        id: projects.id,
        organizationId: projects.organizationId,
        name: projects.name,
        projectNumber: projects.projectNumber,
        address: projects.address,
        publicLocationCity: projects.publicLocationCity,
        jobStatusId: projects.jobStatusId,
        customJobStatusLabel: projectJobStatuses.label,
      })
      .from(projects)
      .leftJoin(
        projectJobStatuses,
        and(
          eq(projectJobStatuses.id, projects.jobStatusId),
          eq(projectJobStatuses.organizationId, projects.organizationId),
        ),
      )
      .where(inArray(projects.id, [...projectIds]))
    // Each contractor's map state decides which towns an address without a state means.
    const organizationIds = [...new Set(rows.flatMap((row) => (row.organizationId ? [row.organizationId] : [])))]
    const states = new Map(
      await Promise.all(
        organizationIds.map(async (id) => [id, (await readPortfolioMapRules(db, id)).mapState] as const),
      ),
    )
    const firstOrganization = rows.find((row) => row.id === first)?.organizationId
    const mapState = (firstOrganization ? states.get(firstOrganization) : undefined) ?? DEFAULT_MAP_STATE
    const resolvers = new Map(
      await Promise.all(
        [...new Set([mapState, ...states.values()])].map(
          async (state) => [state, await placeIndexResolver(rows.map((row) => row.address), state)] as const,
        ),
      ),
    )
    const jobs = audienceMapJobs(
      rows.map(({ customJobStatusLabel, organizationId, ...row }) => ({
        ...row,
        mapState: (organizationId ? states.get(organizationId) : undefined) ?? mapState,
        statusLabel: projectJobStatusLabel({
          jobStatusId: row.jobStatusId,
          customLabel: customJobStatusLabel,
        }),
      })),
      (row) => {
        const resolver = resolvers.get(row.mapState) ?? resolvers.get(mapState)
        return resolver ? resolver(row.address) : COLORADO_PLACES
      },
    )
    return { jobs, mapState }
  } catch (error) {
    console.error("Vendor job map failed", error)
    return EMPTY
  }
}
