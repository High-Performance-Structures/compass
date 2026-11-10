"use server"

import { and, eq } from "drizzle-orm"

import { projectBudgetApplications } from "@/db/schema"
import { payApplicationLineChangeOrders } from "@/lib/financials/pay-application-change-orders"
import type { LineChangeOrder } from "@/lib/financials/pay-application-line-checks"
import { projectContext } from "@/lib/server/action-context"
import { isInternalStaffRole } from "@/lib/user-roles"

/**
 * The change orders behind each pay application row's change, keyed by cost
 * code and assembly, for office staff editing the draw. Empty for anyone else.
 */
export async function getPayApplicationLineChangeOrders(
  projectId: string,
  applicationId: string
): Promise<Readonly<Record<string, readonly LineChangeOrder[]>>> {
  const context = await projectContext(projectId, { scope: "organization", feature: "financials" })
  if (!context.success || !isInternalStaffRole(context.data.user.role)) return {}
  const { db } = context.data
  const application = await db
    .select({ budgetRevisionId: projectBudgetApplications.budgetRevisionId })
    .from(projectBudgetApplications)
    .where(and(eq(projectBudgetApplications.id, applicationId), eq(projectBudgetApplications.projectId, projectId)))
    .get()
  return payApplicationLineChangeOrders(db, application?.budgetRevisionId ?? null)
}
