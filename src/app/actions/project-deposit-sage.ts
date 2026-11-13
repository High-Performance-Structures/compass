"use server"

import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { projectContractDeposits } from "@/db/schema"
import { actionFailure, errorMessage, type ActionResult } from "@/lib/action-result"
import { loadDepositSageExports, loadDepositSageSource, queueDepositSageExport, type DepositSageExportView } from "@/lib/financials/deposit-sage"
import { recordActivityEvent } from "@/lib/activity-log"
import { confirmSageArExportNotInSage } from "@/lib/domain/sage-bridge/ar-invoice-store"
import { requirePermission } from "@/lib/permissions"
import { sageArInvoiceWritesEnabled } from "@/lib/sage/ar-invoice-write"
import { canSendToSage } from "@/lib/sage/sage-send-access"
import { projectContext } from "@/lib/server/action-context"
import { isInternalStaffRole } from "@/lib/user-roles"

/*
 * Deposit requests → Sage AR invoices (<job>-DEP1): the state the deposits
 * panel shows, and the staff Send to Sage action. Queueing and the writer
 * live in src/lib/financials/deposit-sage.ts.
 */

export type DepositSageRow = {
  readonly invoiceNumber: string
  readonly export: DepositSageExportView | null
  /** Why it can't go to Sage yet (empty when it can). */
  readonly blockers: readonly string[]
}

export type DepositSageState = {
  readonly canSend: boolean
  readonly writesEnabled: boolean
  readonly sageJobNumber: string | null
  /** By deposit id: Compass deposit requests only. */
  readonly deposits: Readonly<Record<string, DepositSageRow>>
}

async function staffProject(projectId: string) {
  const context = await projectContext(projectId, { scope: "organization" })
  if (!context.success) return context
  const { user, organizationId } = context.data
  if (!isInternalStaffRole(user.role) || !organizationId) return actionFailure("Only staff can send deposit requests to Sage.")
  requirePermission(user, "project", "read")
  return { success: true as const, data: { ...context.data, organizationId } }
}

/** The Sage state of the project's deposit requests, for office staff with finance access; null for everyone else. */
export async function getProjectDepositSageState(projectId: string, depositIds: readonly string[]): Promise<DepositSageState | null> {
  const context = await staffProject(projectId)
  if (!context.success || !canSendToSage(context.data.user)) return null
  const { db, organizationId, env } = context.data
  const exports = await loadDepositSageExports(db, organizationId, projectId)
  const deposits: Record<string, DepositSageRow> = {}
  let sageJobNumber: string | null = null
  for (const depositId of depositIds.slice(0, 100)) {
    const source = await loadDepositSageSource(db, { organizationId, projectId, depositId })
    if (!source || source.status === "void") continue
    sageJobNumber = source.sageJobNumber
    deposits[depositId] = { invoiceNumber: source.plan.invoiceNumber, export: exports.get(depositId) ?? null, blockers: source.plan.blockers }
  }
  return { canSend: true, writesEnabled: sageArInvoiceWritesEnabled(env), sageJobNumber, deposits }
}

/** Office staff send a deposit request to Sage as its own AR invoice. Compass shows the result at once; Sage follows. */
export async function sendProjectDepositToSage(
  projectId: string,
  depositId: string
): Promise<ActionResult<{ readonly status: string; readonly reason: string | null }>> {
  try {
    const context = await staffProject(projectId)
    if (!context.success) return context
    const { db, user, organizationId, env } = context.data
    if (!canSendToSage(user)) return actionFailure("Only office staff with finance access can send deposit requests to Sage.")
    const result = await queueDepositSageExport({ db, env, organizationId, projectId, depositId, actor: { ...user, id: user.id } })
    revalidatePath(`/dashboard/projects/${projectId}/financials`)
    if (result.status === "off" || result.status === "skipped") return actionFailure(result.reason)
    return { success: true, data: { status: result.status, reason: result.reason } }
  } catch (error) {
    return actionFailure(errorMessage(error, "Unable to send the deposit request to Sage."))
  }
}

/**
 * Staff checked Sage and this deposit request's AR invoice isn't there: its
 * export stops counting as possibly in Sage (compare-and-set on that state).
 * Nothing is sent to Sage.
 */
export async function confirmProjectDepositNotInSage(projectId: string, depositId: string): Promise<ActionResult<{ readonly depositId: string }>> {
  try {
    const context = await staffProject(projectId)
    if (!context.success) return context
    const { db, user, organizationId } = context.data
    requirePermission(user, "project", "update")
    if (!canSendToSage(user)) return actionFailure("Only office staff with finance access can record a Sage check on deposit requests.")
    const deposit = await db
      .select({ id: projectContractDeposits.id })
      .from(projectContractDeposits)
      .where(and(eq(projectContractDeposits.id, depositId), eq(projectContractDeposits.projectId, projectId)))
      .get()
    if (!deposit) return actionFailure("Deposit request not found.")
    const now = new Date().toISOString()
    const who = user.displayName ?? user.email
    const note = `${who} checked Sage on ${now.slice(0, 10)}: the invoice isn't there.`
    if (!(await confirmSageArExportNotInSage(db, { kind: "deposit", organizationId, sourceId: depositId, note, now }))) {
      return actionFailure("This deposit request isn't waiting on a Sage check (Sage has it, or it changed). Refresh to see where it is.")
    }
    await recordActivityEvent({
      db,
      organizationId,
      projectId,
      actor: user,
      category: "financial",
      action: "deposit_sage_checked_absent",
      entityType: "project_contract_deposit",
      entityId: depositId,
      summary: `Deposit request: ${who} checked Sage and its AR invoice isn't there.`,
      createdAt: now,
    })
    revalidatePath(`/dashboard/projects/${projectId}/financials`)
    return { success: true, data: { depositId } }
  } catch (error) {
    return actionFailure(errorMessage(error, "Unable to record the Sage check."))
  }
}

