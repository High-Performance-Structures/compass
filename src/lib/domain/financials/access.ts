import "server-only"

import { and, eq } from "drizzle-orm"

import { projects } from "@/db/schema"
import { actionFailure, type ActionFailure } from "@/lib/action-result"
import { isDemoUser } from "@/lib/demo"
import { can, type Action } from "@/lib/permissions"
import { orgContext, type Db, type OrgContext } from "@/lib/server/action-context"

/**
 * Financial records (invoices, bills, payments, credit memos) follow the
 * role table's "finance" permission (`can`/`requirePermission`), not the
 * per-company feature overrides, and only the demo *user* is read-only.
 * This keeps that rule while user, organization and database come from the
 * shared action context.
 */

type FinanceContextResult = { readonly success: true; readonly data: OrgContext } | ActionFailure

export const PROJECT_NOT_FOUND = "Project not found or access denied"

/** For writes: failures come back as an ActionFailure with today's messages. */
export async function financeContext(action: Action): Promise<FinanceContextResult> {
  const context = await orgContext()
  if (!context.success) return context
  const { user } = context.data
  if (action !== "read" && isDemoUser(user.id)) return actionFailure("DEMO_READ_ONLY")
  if (!can(user, "finance", action)) {
    return actionFailure(`Permission denied: ${user.role ?? "unknown"} cannot ${action} finance`)
  }
  return context
}

/** For reads, which have always thrown on a failed check. */
export async function financeReadContext(): Promise<OrgContext> {
  const context = await financeContext("read")
  if (!context.success) throw new Error(context.error)
  return context.data
}

/** Whether the project belongs to the organization. */
export async function isOrganizationProject(db: Db, organizationId: string, projectId: string): Promise<boolean> {
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
    .limit(1)
  return Boolean(project)
}
