import { and, eq, inArray, isNotNull, sql } from "drizzle-orm"

import { projectChangeOrders, projects } from "@/db/schema"
import { projectEstimates } from "@/db/schema-estimates"
import { authorizeSageChangeOrderBridge, PRIME_CHANGE_ORDER_READER } from "@/lib/sage/change-order-bridge"

/** Jobs read per poll; Sage holds few prime change orders, so this is generous. */
const MAX_JOBS = 300

/**
 * The read-only Sage reader asks which Sage jobs to read prime change orders
 * and proposals for: every linked job of the company that has an approved
 * change order or variance, or an accepted estimate, in Compass.
 */
export async function GET(request: Request): Promise<Response> {
  const bridge = await authorizeSageChangeOrderBridge(request, "", PRIME_CHANGE_ORDER_READER)
  if (!bridge.success) return bridge.response
  const { db, organizationId } = bridge
  const jobs = await db
    .select({ projectId: projects.id, sageJobNumber: projects.sageJobNumber })
    .from(projects)
    .where(
      and(
        eq(projects.organizationId, organizationId),
        isNotNull(projects.sageJobNumber),
        sql`(EXISTS (SELECT 1 FROM ${projectChangeOrders} WHERE ${projectChangeOrders.projectId} = ${projects.id}
          AND ${inArray(projectChangeOrders.status, ["executed", "sage_pending", "synced", "closed"])})
          OR EXISTS (SELECT 1 FROM ${projectEstimates} WHERE ${projectEstimates.projectId} = ${projects.id}
          AND ${projectEstimates.status} = 'accepted'))`
      )
    )
    .limit(MAX_JOBS)
  return Response.json({
    organizationId,
    jobs: jobs.filter((job) => job.sageJobNumber && /^\d+$/.test(job.sageJobNumber.trim())).map((job) => ({
      projectId: job.projectId,
      sageJobNumber: (job.sageJobNumber ?? "").trim(),
    })),
  })
}
