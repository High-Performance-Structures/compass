import { and, eq, inArray } from "drizzle-orm"
import { getDb } from "@/db"
import { projectJobStatuses, projects } from "@/db/schema"
import { getCloudflareContext } from "@/lib/db"
import { projectJobStatusLabel } from "@/lib/project-profile"
import type { PortfolioMapJob } from "@/lib/portfolio-map/model"
import { audienceMapJobs } from "@/lib/portfolio-map/audience-model"

/**
 * Map jobs for the owner and sub/vendor dashboards. Callers pass project ids
 * the viewer already has (their project switcher or the current project,
 * resolved server-side for that viewer), so the map never reveals a job they
 * could not already open. Server-only: not a server action, so clients cannot
 * pass arbitrary ids.
 */
export async function getAudienceJobMap(
  projectIds: readonly string[],
): Promise<readonly PortfolioMapJob[]> {
  if (projectIds.length === 0) return []
  try {
    const { env } = await getCloudflareContext()
    if (!env?.DB) return []
    const rows = await getDb(env.DB)
      .select({
        id: projects.id,
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
    return audienceMapJobs(
      rows.map(({ customJobStatusLabel, ...row }) => ({
        ...row,
        statusLabel: projectJobStatusLabel({
          jobStatusId: row.jobStatusId,
          customLabel: customJobStatusLabel,
        }),
      })),
    )
  } catch (error) {
    console.error("Vendor job map failed", error)
    return []
  }
}
