"use server"

import { and, eq, gt, isNull, notInArray, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/sqlite-core"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import { projectBudgetApplications, projectOperations, projects } from "@/db/schema"
import { activityActorName, recordActivityEvent } from "@/lib/activity-log"
import { batchGuardStatement, isBatchGuardFailure } from "@/lib/d1-query"
import { compassDrawStatusIs, movePayApplicationStatus, updateBudgetApplicationsStatement } from "@/lib/domain/budget/store"
import { drawHasNoActivePayments, payApplicationHasActivePayments } from "@/lib/domain/financials/receivables"
import { operationUpdateQuery } from "@/lib/domain/operations/store"
import { arExportNotPossiblyInSage, arExportPossiblyInSage, cancelSageArInvoiceExportStatement } from "@/lib/domain/sage-bridge/ar-invoice-store"
import { queueArInvoiceSageExport } from "@/lib/sage/ar-invoice-sync"
import type { AuthUser } from "@/lib/auth"
import { requireOrg } from "@/lib/org-scope"
import { requirePermission } from "@/lib/permissions"
import { isInternalStaffRole } from "@/lib/user-roles"
import { requireUserContext } from "@/lib/server/action-context"

/*
 * After review, staff approve a Compass pay application for billing: it is
 * marked billed, locked, and published to the owner. When the company sends
 * billed pay requests to Sage, approving also queues the Sage AR invoice, and
 * the Sage invoice number is recorded once Sage has it; otherwise staff
 * record it after entering the draw in Sage.
 */

type BillingActionResult =
  | { readonly success: true; readonly id: string }
  | { readonly success: false; readonly error: string }

async function billingAccess(projectId: string): Promise<{
  readonly db: ReturnType<typeof getDb>
  readonly user: AuthUser
  readonly organizationId: string
}> {
  const { user, db } = await requireUserContext()
  requirePermission(user, "project", "update")
  if (!isInternalStaffRole(user.role)) throw new Error("Only staff can bill pay applications.")
  const organizationId = requireOrg(user)
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

/** Another draw of the same project, for the undo's write-time check. */
const laterDraw = alias(projectBudgetApplications, "later_draw")

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
  applicationId: string,
  /** The version staff reviewed; a draw changed since (Sage's amounts applied, say) is refused. */
  expectedUpdatedAt: string
): Promise<BillingActionResult> {
  try {
    const { db, user, organizationId } = await billingAccess(projectId)
    const application = await compassApplication(db, projectId, applicationId)
    if (!application || application.status !== "internal_review") {
      throw new Error("Mark the pay application ready for review before approving it for billing.")
    }
    const changedMessage = "This pay application changed since you opened it. Refresh, check its amounts, and approve again."
    if (expectedUpdatedAt !== application.updatedAt) throw new Error(changedMessage)
    const now = new Date().toISOString()
    // Compare-and-set on the status and the version read: a double click or a
    // second person approving lands once (only that one logs Activity and
    // queues Sage), and a draw whose amounts changed meanwhile isn't billed.
    const moved = await movePayApplicationStatus(db, {
      projectId,
      applicationId,
      event: "approve",
      also: eq(projectBudgetApplications.updatedAt, application.updatedAt),
      values: { ownerVisible: true, billedAt: now, billedBy: user.id, syncStatus: "awaiting_sage_invoice", updatedAt: now },
      alongWith: [
        operationUpdateQuery(db, operationFor(projectId, applicationId), {
          status: "billed",
          syncStatus: "awaiting_sage_invoice",
          updatedAt: now,
        }),
      ],
    })
    if (!moved) throw new Error("This pay application was already approved or changed by someone else. Refresh to see where it stands.")
    await recordActivityEvent({
      db, organizationId, projectId, actor: user, category: "financial",
      action: "pay_application_billed", entityType: "project_budget_application", entityId: applicationId,
      summary: `Approved pay application ${application.applicationNumber} for billing and published it to the owner.`,
      metadata: { currentPaymentDue: application.currentPaymentDue, approvedBy: activityActorName(user) },
    })
    // Sage gets the bill as an AR invoice; never fails the approval.
    await queueArInvoiceSageExport({ db, organizationId, projectId, applicationId, actor: user, automatic: true })
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
    if (await payApplicationHasActivePayments(db, applicationId)) {
      throw new Error("Payments are recorded against this draw. Void them first.")
    }
    if (await arExportPossiblyInSage(db, { kind: "pay", organizationId, sourceId: applicationId })) {
      throw new Error("This draw is being sent to Sage as an AR invoice (or Sage already has it). Wait for it to finish, then void the invoice in Sage first.")
    }
    const now = new Date().toISOString()
    // The undo and the cancel of its queued Sage AR invoice land together, and
    // only while no Sage invoice number is recorded and Sage hasn't started on it.
    const moved = await movePayApplicationStatus(db, {
      projectId,
      applicationId,
      event: "undo_billing",
      also: and(
        isNull(projectBudgetApplications.sageInvoiceNumber),
        arExportNotPossiblyInSage({ kind: "pay", organizationId, sourceId: applicationId }),
        // The checks above, again at write time: no payment recorded and no later draw started meanwhile.
        drawHasNoActivePayments(applicationId),
        // An alias renders as its name only, so the table is named here.
        sql`NOT EXISTS (SELECT 1 FROM ${projectBudgetApplications} AS later_draw WHERE ${and(
          eq(laterDraw.projectId, projectId),
          eq(laterDraw.sourceSystem, "compass_contract_budget"),
          gt(laterDraw.createdAt, application.createdAt),
          notInArray(laterDraw.status, ["building", "void"]),
        )})`,
      ),
      values: { ownerVisible: false, billedAt: null, billedBy: null, syncStatus: "needs_review", updatedAt: now },
      alongWith: [
        operationUpdateQuery(db, operationFor(projectId, applicationId), {
          status: "internal_review",
          syncStatus: "needs_review",
          updatedAt: now,
        }),
        cancelSageArInvoiceExportStatement(db, { organizationId, applicationId, now }),
      ],
    })
    if (!moved) {
      throw new Error("This billing approval was already taken back, or meanwhile a Sage invoice number or a payment was recorded, a later draw was started, or Sage started adding the invoice. Refresh to see where it stands.")
    }
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
    try {
      await db.batch([
        // Only while it is still billed (not taken back meanwhile).
        batchGuardStatement(db, compassDrawStatusIs(projectId, applicationId, ["billed"]), "pay application still billed"),
        updateBudgetApplicationsStatement(db, eq(projectBudgetApplications.id, applicationId), {
          sageInvoiceNumber: number,
          syncStatus,
          updatedAt: now,
        }),
        operationUpdateQuery(db, operationFor(projectId, applicationId), { syncStatus, updatedAt: now }),
      ])
    } catch (error) {
      if (isBatchGuardFailure(error)) throw new Error("The billing approval was taken back meanwhile. Approve the pay application for billing first.")
      throw error
    }
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
