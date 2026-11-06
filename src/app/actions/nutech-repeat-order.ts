"use server"

import { and, desc, eq, inArray } from "drizzle-orm"

import { projects } from "@/db/schema"
import { nuTechOrderWorkflows } from "@/db/schema-nutech"
import { isNuTechJob, nuTechOrgContext } from "@/lib/domain/nutech/access"
import { requireFeaturePermission } from "@/lib/permission-enforcement"

export type NuTechRepeatOrderTarget = {
  readonly projectId: string
  /** The number the repeat order would get on that job. */
  readonly nextOrderNumber: number
  readonly lastOrder: { readonly orderNumber: number; readonly title: string | null; readonly orderStatus: string } | null
}

/**
 * For an N intake that matches existing N jobs: what adding the order to each
 * of them would look like, so a repeat order for the same site stays on its job
 * instead of taking a new N number.
 */
export async function getNuTechRepeatOrderTargets(projectIds: readonly string[]): Promise<readonly NuTechRepeatOrderTarget[]> {
  if (projectIds.length === 0) return []
  const { db, user, organizationId } = await nuTechOrgContext()
  await requireFeaturePermission(user, "nutech-orders", "read")
  const jobs = await db
    .select({ id: projects.id, projectNumber: projects.projectNumber })
    .from(projects)
    .where(and(eq(projects.organizationId, organizationId), inArray(projects.id, [...projectIds.slice(0, 20)])))
  const nuTechJobIds = jobs.filter(isNuTechJob).map((job) => job.id)
  if (nuTechJobIds.length === 0) return []
  const orders = await db
    .select({
      projectId: nuTechOrderWorkflows.projectId,
      orderNumber: nuTechOrderWorkflows.orderNumber,
      title: nuTechOrderWorkflows.title,
      orderStatus: nuTechOrderWorkflows.orderStatus,
    })
    .from(nuTechOrderWorkflows)
    .where(inArray(nuTechOrderWorkflows.projectId, nuTechJobIds))
    .orderBy(desc(nuTechOrderWorkflows.orderNumber))
  return nuTechJobIds.map((projectId) => {
    // Sorted newest first, so the first order found is the job's latest.
    const lastOrder = orders.find((order) => order.projectId === projectId) ?? null
    return {
      projectId,
      nextOrderNumber: (lastOrder?.orderNumber ?? 0) + 1,
      lastOrder: lastOrder ? { orderNumber: lastOrder.orderNumber, title: lastOrder.title, orderStatus: lastOrder.orderStatus } : null,
    }
  })
}
