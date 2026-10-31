"use server"

import { and, eq, gt, notInArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import { projectBudgetApplications, projectOperations, projects } from "@/db/schema"
import { activityActorName, recordActivityEvent } from "@/lib/activity-log"
import { updateBudgetApplicationsStatement } from "@/lib/domain/budget/store"
import { operationUpdateQuery } from "@/lib/domain/operations/store"
import { requireAuth, type AuthUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { requireOrg } from "@/lib/org-scope"
import { requirePermission } from "@/lib/permissions"
import { isInternalStaffRole } from "@/lib/user-roles"

/*
 * After review, staff approve a Compass pay application for billing: it is
 * marked billed, locked, and published to the owner. The Sage invoice number
 * is recorded once the draw is entered in Sage (Compass doesn't write it).
 */

type BillingActionResult =
  | { readonly success: true; readonly id: string }
  | { readonly success: false; readonly error: string }

async function billingAccess(projectId: string): Promise<{
  readonly db: ReturnType<typeof getDb>
  readonly user: AuthUser
  readonly organizationId: string
}> {
  const user = await requireAuth()
  requirePermission(user, "project", "update")
  if (!isInternalStaffRole(user.role)) throw new Error("Only staff can bill pay applications.")
  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const project = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
    .get()
  if (!project) throw new Error("Project not found")
  return { db, user, organizationId }
}

async function compassApplication(db: ReturnType<typeof getDb>, projectId: string, applicationId: string) {
  return db
    .select()
    .from(projectBudgetApplications)
    .where(and(
      eq(projectBudgetApplications.id, applicationId),
      eq(projectBudgetApplications.projectId, projectId),
      eq(projectBudgetApplications.sourceSystem, "compass_contract_budget"),
    ))
    .get()
}

function operationFor(projectId: string, applicationId: string) {
  return and(
    eq(projectOperations.projectId, projectId),
    eq(projectOperations.sourceRecordType, "owner_pay_application"),
    eq(projectOperations.sourceRecordId, applicationId),
  )
}

function revalidateBillingPaths(projectId: string, applicationId: string): void {
  revalidatePath(`/dashboard/projects/${projectId}`)
  revalidatePath(`/dashboard/projects/${projectId}/financials`)
  revalidatePath(`/dashboard/projects/${projectId}/financials/pay-applications/${applicationId}`)
  revalidatePath(`/dashboard/projects/${projectId}/budget`)
  revalidatePath(`/preview/projects/${projectId}/owner/budget`)
  revalidatePath("/dashboard/financials")
  revalidatePath("/dashboard")
}

/** Marks a reviewed pay application billed and publishes it to the owner. */
export async function approveProjectOwnerPayApplicationForBilling(
  projectId: string,
  applicationId: string
): Promise<BillingActionResult> {
  try {
    const { db, user, organizationId } = await billingAccess(projectId)
    const application = await compassApplication(db, projectId, applicationId)
    if (!application || application.status !== "internal_review") {
      throw new Error("Mark the pay application ready for review before approving it for billing.")
    }
    const now = new Date().toISOString()
    await db.batch([
      updateBudgetApplicationsStatement(
        db,
        and(eq(projectBudgetApplications.id, applicationId), eq(projectBudgetApplications.status, "internal_review")),
        { status: "billed", ownerVisible: true, billedAt: now, billedBy: user.id, syncStatus: "awaiting_sage_invoice", updatedAt: now }
      ),
      operationUpdateQuery(db, operationFor(projectId, applicationId), {
        status: "billed",
        syncStatus: "awaiting_sage_invoice",
        updatedAt: now,
      }),
    ])
    await recordActivityEvent({
      db, organizationId, projectId, actor: user, category: "financial",
      action: "pay_application_billed", entityType: "project_budget_application", entityId: applicationId,
      summary: `Approved pay application ${application.applicationNumber} for billing and published it to the owner.`,
      metadata: { currentPaymentDue: application.currentPaymentDue, approvedBy: activityActorName(user) },
    })
    revalidateBillingPaths(projectId, applicationId)
    return { success: true, id: applicationId }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to approve the pay application." }
  }
}

/**
 * Takes back a billing approval: back to review and hidden from the owner.
 * Not once a later draw has been started from it.
 */
export async function undoProjectOwnerPayApplicationBilling(
  projectId: string,
  applicationId: string
): Promise<BillingActionResult> {
  try {
    const { db, user, organizationId } = await billingAccess(projectId)
    const application = await compassApplication(db, projectId, applicationId)
    if (!application || application.status !== "billed") throw new Error("Only a billed pay application can be taken back.")
    const later = await db
      .select({ applicationNumber: projectBudgetApplications.applicationNumber })
      .from(projectBudgetApplications)
      .where(and(
        eq(projectBudgetApplications.projectId, projectId),
        eq(projectBudgetApplications.sourceSystem, "compass_contract_budget"),
        gt(projectBudgetApplications.createdAt, application.createdAt),
        notInArray(projectBudgetApplications.status, ["building", "void"]),
      ))
      .get()
    if (later) {
      throw new Error(`Pay application ${later.applicationNumber} was started after this one. Delete it first, or bill a correction on the next draw.`)
    }
    if (application.sageInvoiceNumber) {
      throw new Error(`This draw is invoiced in Sage as ${application.sageInvoiceNumber}. Clear the Sage invoice number first.`)
    }
    const now = new Date().toISOString()
    await db.batch([
      updateBudgetApplicationsStatement(
        db,
        and(eq(projectBudgetApplications.id, applicationId), eq(projectBudgetApplications.status, "billed")),
        { status: "internal_review", ownerVisible: false, billedAt: null, billedBy: null, syncStatus: "needs_review", updatedAt: now }
      ),
      operationUpdateQuery(db, operationFor(projectId, applicationId), {
        status: "internal_review",
        syncStatus: "needs_review",
        updatedAt: now,
      }),
    ])
    await recordActivityEvent({
      db, organizationId, projectId, actor: user, category: "financial",
      action: "pay_application_billing_undone", entityType: "project_budget_application", entityId: applicationId,
      summary: `Took back billing approval for pay application ${application.applicationNumber}; it is hidden from the owner again.`,
      metadata: {},
    })
    revalidateBillingPaths(projectId, applicationId)
    return { success: true, id: applicationId }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to take back the billing approval." }
  }
}

/** Records (or clears, with an empty value) the Sage invoice number of a billed draw. */
export async function setProjectOwnerPayApplicationSageInvoice(
  projectId: string,
  applicationId: string,
  invoiceNumber: string
): Promise<BillingActionResult> {
  try {
    const { db, user, organizationId } = await billingAccess(projectId)
    const application = await compassApplication(db, projectId, applicationId)
    if (!application || application.status !== "billed") throw new Error("Approve the pay application for billing first.")
    const number = invoiceNumber.trim().slice(0, 60) || null
    const syncStatus = number ? "synced" : "awaiting_sage_invoice"
    const now = new Date().toISOString()
    await db.batch([
      updateBudgetApplicationsStatement(db, eq(projectBudgetApplications.id, applicationId), {
        sageInvoiceNumber: number,
        syncStatus,
        updatedAt: now,
      }),
      operationUpdateQuery(db, operationFor(projectId, applicationId), { syncStatus, updatedAt: now }),
    ])
    await recordActivityEvent({
      db, organizationId, projectId, actor: user, category: "financial",
      action: "pay_application_sage_invoice_recorded", entityType: "project_budget_application", entityId: applicationId,
      summary: number
        ? `Recorded Sage invoice ${number} for pay application ${application.applicationNumber}.`
        : `Cleared the Sage invoice number for pay application ${application.applicationNumber}.`,
      metadata: { sageInvoiceNumber: number },
    })
    revalidateBillingPaths(projectId, applicationId)
    return { success: true, id: applicationId }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to record the Sage invoice number." }
  }
}
