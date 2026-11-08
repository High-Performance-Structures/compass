"use server"

import { revalidatePath } from "next/cache"

import { actionFailure, type ActionResult } from "@/lib/action-result"
import type { ArInvoicePlannedLine } from "@/lib/domain/sage-bridge/ar-invoice-rules"
import { loadArInvoiceExport, loadArInvoiceSource, queueArInvoiceSageExport, type ArInvoiceExportView } from "@/lib/sage/ar-invoice-sync"
import { sageArInvoiceWritesEnabled } from "@/lib/sage/ar-invoice-write"
import { canSendToSage } from "@/lib/sage/sage-send-access"
import { projectContext } from "@/lib/server/action-context"

/*
 * The pay request's Sage AR invoice on the pay request page: what goes to
 * Sage line by line, its status, what stopped it, and Send to Sage / Retry
 * for office staff with finance access. Approving for billing queues it
 * automatically; this is the manual way.
 */

export type PayRequestSageInvoiceState = {
  readonly writesEnabled: boolean
  readonly sageJobNumber: string | null
  readonly applicationStatus: string
  readonly export: ArInvoiceExportView | null
  readonly notApplicable: string | null
  readonly invoice: {
    readonly number: string
    readonly date: string | null
    readonly dueDate: string | null
    readonly description: string
    readonly lines: readonly ArInvoicePlannedLine[]
    readonly linesTotalCents: number
    readonly expectedSalesTaxCents: number
    readonly taxDistrictName: string | null
    readonly retentionCents: number
    readonly netDueCents: number
    readonly currentPaymentDueCents: number
    readonly blockers: readonly string[]
  }
  /** Server-decided: staff may send (or retry) now. */
  readonly canSend: boolean
}

const OFFICE_STAFF_ONLY = "Only office staff with finance access can send pay requests to Sage."

export async function getPayRequestSageInvoiceState(projectId: string, applicationId: string): Promise<ActionResult<PayRequestSageInvoiceState>> {
  const context = await projectContext(projectId, { scope: "organization" })
  if (!context.success) return context
  const { db, env, user, organizationId } = context.data
  if (!organizationId) return actionFailure("No active organization")
  if (!canSendToSage(user)) return actionFailure(OFFICE_STAFF_ONLY)
  const [source, exported] = await Promise.all([
    loadArInvoiceSource(db, { organizationId, projectId, applicationId }),
    loadArInvoiceExport(db, projectId, applicationId),
  ])
  if (!source) return actionFailure("Pay request not found")
  const writesEnabled = sageArInvoiceWritesEnabled(env)
  const open = exported ? ["queued", "running", "succeeded"].includes(exported.status) : false
  const { plan } = source
  return {
    success: true,
    data: {
      writesEnabled,
      sageJobNumber: source.sageJobNumber,
      applicationStatus: source.application.status,
      export: exported ?? null,
      notApplicable: source.notApplicable,
      invoice: {
        number: exported?.invoiceNumber && open ? exported.invoiceNumber : plan.invoiceNumber,
        date: plan.invoiceDate,
        dueDate: plan.dueDate,
        description: plan.description,
        lines: plan.lines,
        linesTotalCents: plan.linesTotalCents,
        expectedSalesTaxCents: plan.expectedSalesTaxCents,
        taxDistrictName: plan.taxDistrict?.name ?? null,
        retentionCents: plan.retentionCents,
        netDueCents: plan.netDueCents,
        currentPaymentDueCents: plan.currentPaymentDueCents,
        blockers: plan.blockers,
      },
      canSend: writesEnabled && !source.notApplicable && source.application.status === "billed" && !open,
    },
  }
}

/** Sends (or retries) the billed pay request's Sage AR invoice; guards still flag it instead of sending. */
export async function sendPayRequestToSage(
  projectId: string,
  applicationId: string
): Promise<ActionResult<{ readonly status: string; readonly reason: string | null }>> {
  const context = await projectContext(projectId, { scope: "organization", mutation: true })
  if (!context.success) return context
  const { db, user, organizationId } = context.data
  if (!organizationId) return actionFailure("No active organization")
  if (!canSendToSage(user)) return actionFailure(OFFICE_STAFF_ONLY)
  const result = await queueArInvoiceSageExport({ db, organizationId, projectId, applicationId, actor: user, automatic: false })
  revalidatePath(`/dashboard/projects/${projectId}/financials/pay-applications/${applicationId}`)
  if (result.status === "off" || result.status === "skipped") return actionFailure(result.reason)
  return { success: true, data: { status: result.status, reason: result.reason } }
}
