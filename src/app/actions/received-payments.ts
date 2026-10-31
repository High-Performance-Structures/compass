"use server"

import { revalidatePath } from "next/cache"

import { actionFailure, errorMessage, type ActionDone, type ActionResult } from "@/lib/action-result"
import { recordActivityEvent } from "@/lib/activity-log"
import {
  readActivePaymentAllocations,
  readOwnerPayApplicationBalances,
  readProjectClient,
  readProjectReceivables,
  readProjectReceivedPayments,
  readReceivedPayment,
  type ReceivableRow,
  type ReceivedPaymentView,
} from "@/lib/domain/financials/receivables"
import {
  focusCustomerId,
  invoicePaidValues,
  invoiceUnpaidStatus,
  paidCentsAfterRelease,
  parseVoidReason,
  paymentVoidBlocker,
  planPaymentAllocations,
  receivablesForCustomer,
  storedDollarsToCents,
  type PlannedAllocation,
  type RequestedAllocation,
} from "@/lib/domain/financials/rules"
import { RECEIVABLE_ITEM_KINDS, RECEIVED_PAYMENT_METHODS, type ReceivableItemKind } from "@/lib/domain/financials/statuses"
import {
  applyReceivedPayment,
  voidReceivedPayment,
  type PaymentAllocationWrite,
} from "@/lib/domain/financials/store"
import { formatCents, parseDateOnly, toCents } from "@/lib/format"
import { canFeature } from "@/lib/permission-enforcement"
import { isListValue } from "@/lib/shared/statuses"
import { projectContext, type ProjectContext } from "@/lib/server/action-context"

/*
 * Staff record a payment received from a customer against a billed pay
 * application or invoice, and may split it across that customer's other open
 * items on the same project. Voiding (with a reason) releases what it applied.
 * Compass never posts these receipts to Sage: the receipt is entered in Sage
 * by accounting, and only Square card payments reach Sage through the Square
 * bridge's own approval-gated flow.
 */

const FEATURE = "financials"
const STALE = "A balance changed while you were recording this. Refresh and try again."
const NOT_FOUND = "Payment not found or access denied"
const REFERENCE_MAX = 100
const MEMO_MAX = 500

export type ReceivableFocus = { readonly kind: ReceivableItemKind; readonly id: string }

export type ProjectReceivablesData = {
  readonly projectName: string
  readonly clientName: string | null
  readonly receivables: readonly ReceivableRow[]
  readonly payments: readonly ReceivedPaymentView[]
  readonly canRecord: boolean
  readonly canVoid: boolean
}

export type RecordPaymentOptions = {
  readonly customerId: string | null
  readonly customerName: string | null
  /** The customer's open items on the project; the focused item first. */
  readonly openItems: readonly ReceivableRow[]
  /** For applying an existing payment: what it still has unapplied. */
  readonly payment: { readonly id: string; readonly unappliedCents: number } | null
}

export type RecordPaymentInput = {
  readonly projectId: string
  readonly focus: ReceivableFocus
  readonly amount: string
  readonly paymentDate: string
  readonly method: string
  readonly reference: string
  readonly memo: string
  readonly allocations: readonly { readonly kind: string; readonly id: string; readonly amount: string }[]
}

function revalidatePayments(projectId: string, applicationIds: readonly string[]): void {
  revalidatePath(`/dashboard/projects/${projectId}/financials`)
  for (const id of applicationIds) revalidatePath(`/dashboard/projects/${projectId}/financials/pay-applications/${id}`)
  revalidatePath(`/preview/projects/${projectId}/owner/budget`)
  revalidatePath("/dashboard/financials")
}

async function staffContext(projectId: string, action: "read" | "create" | "update"): Promise<ActionResult<ProjectContext & { readonly organizationId: string }>> {
  const context = await projectContext(projectId, {
    scope: "organization",
    feature: FEATURE,
    action,
    mutation: action !== "read",
  })
  if (!context.success) return context
  const { organizationId } = context.data
  if (!organizationId) return actionFailure("No active organization")
  return { success: true, data: { ...context.data, organizationId } }
}

/** Billed items, balances and received payments for a project's financials and pay application pages. */
export async function getProjectReceivablePayments(projectId: string): Promise<ActionResult<ProjectReceivablesData>> {
  try {
    const context = await staffContext(projectId, "read")
    if (!context.success) return context
    const { db, organizationId, user } = context.data
    const scope = { organizationId, projectId }
    const [client, receivables, payments, canRecord, canVoid] = await Promise.all([
      readProjectClient(db, scope),
      readProjectReceivables(db, scope),
      readProjectReceivedPayments(db, scope),
      canFeature(user, FEATURE, "create"),
      canFeature(user, FEATURE, "update"),
    ])
    if (!client) return actionFailure("Project not found")
    return {
      success: true,
      data: { projectName: client.projectName, clientName: client.clientName, receivables, payments, canRecord, canVoid },
    }
  } catch (error) {
    return actionFailure(errorMessage(error, "Unable to load payments."))
  }
}

function focusFirst(items: readonly ReceivableRow[], focus: ReceivableFocus | null): ReceivableRow[] {
  const open = items.filter((item) => item.openCents > 0)
  if (!focus) return open
  return [
    ...open.filter((item) => item.kind === focus.kind && item.id === focus.id),
    ...open.filter((item) => !(item.kind === focus.kind && item.id === focus.id)),
  ]
}

async function customerItems(
  context: ProjectContext & { readonly organizationId: string },
  projectId: string,
  select: { readonly focus: ReceivableFocus } | { readonly customerId: string | null },
): Promise<{ readonly customerId: string | null; readonly customerName: string | null; readonly items: readonly ReceivableRow[] } | null> {
  const scope = { organizationId: context.organizationId, projectId }
  const [client, all] = await Promise.all([readProjectClient(context.db, scope), readProjectReceivables(context.db, scope)])
  if (!client) return null
  let customerId: string | null
  if ("focus" in select) {
    const focused = all.find((item) => item.kind === select.focus.kind && item.id === select.focus.id)
    if (!focused) return null
    customerId = focusCustomerId(focused, client.clientCustomerId)
  } else {
    customerId = select.customerId
  }
  const items = receivablesForCustomer(all, client.clientCustomerId, customerId)
  if (!items) return null
  const customerName = customerId === client.clientCustomerId ? client.clientName : null
  return { customerId, customerName, items }
}

/** What the Record payment dialog offers: the customer's open items on the project. */
export async function getRecordPaymentOptions(
  projectId: string,
  target: { readonly focus: ReceivableFocus } | { readonly paymentId: string },
): Promise<ActionResult<RecordPaymentOptions>> {
  try {
    const context = await staffContext(projectId, "create")
    if (!context.success) return context
    if ("paymentId" in target) {
      const payment = await readReceivedPayment(context.data.db, context.data.organizationId, target.paymentId)
      if (!payment || payment.projectId !== projectId) return actionFailure(NOT_FOUND)
      if (payment.voidedAt) return actionFailure("This payment is void.")
      const scope = { organizationId: context.data.organizationId, projectId }
      const [found, active] = await Promise.all([
        customerItems(context.data, projectId, { customerId: payment.customerId }),
        readActivePaymentAllocations(context.data.db, scope, payment.id),
      ])
      const applied = [...active.payApplications, ...active.invoices].reduce((sum, row) => sum + row.cents, 0)
      return {
        success: true,
        data: {
          customerId: payment.customerId,
          customerName: found?.customerName ?? null,
          openItems: focusFirst(found?.items ?? [], null),
          payment: { id: payment.id, unappliedCents: Math.max(payment.amountCents - applied, 0) },
        },
      }
    }
    const found = await customerItems(context.data, projectId, { focus: target.focus })
    if (!found) return actionFailure("That pay application or invoice is not open for payment.")
    return {
      success: true,
      data: {
        customerId: found.customerId,
        customerName: found.customerName,
        openItems: focusFirst(found.items, target.focus),
        payment: null,
      },
    }
  } catch (error) {
    return actionFailure(errorMessage(error, "Unable to load open items."))
  }
}

function parseRequested(
  rows: RecordPaymentInput["allocations"],
): { readonly ok: true; readonly requested: RequestedAllocation[] } | { readonly ok: false; readonly error: string } {
  const requested: RequestedAllocation[] = []
  for (const row of rows) {
    if (!isListValue(RECEIVABLE_ITEM_KINDS, row.kind)) return { ok: false, error: "Unknown item." }
    if (row.amount.trim() === "") continue
    const cents = toCents(row.amount)
    if (cents === null) return { ok: false, error: "Enter each applied amount as dollars and cents." }
    requested.push({ kind: row.kind, id: row.id, cents })
  }
  return { ok: true, requested }
}

function allocationWrites(planned: readonly PlannedAllocation[]): PaymentAllocationWrite[] {
  return planned.map((allocation) => {
    const allocationId = crypto.randomUUID()
    if (allocation.kind === "pay_application") {
      return {
        kind: "pay_application",
        allocationId,
        applicationId: allocation.id,
        cents: allocation.cents,
        expectedPaidCents: allocation.item.paidCents,
      }
    }
    return {
      kind: "invoice",
      allocationId,
      invoiceId: allocation.id,
      cents: allocation.cents,
      expectedPaidCents: allocation.item.paidCents,
      invoice: invoicePaidValues({
        totalDollars: allocation.item.billedCents / 100,
        paidCents: allocation.item.paidCents + allocation.cents,
        unpaidStatus: invoiceUnpaidStatus(allocation.item.sourceSystem),
      }),
    }
  })
}

function appliedSummary(planned: readonly PlannedAllocation[]): string {
  return planned.map((allocation) => `${formatCents(allocation.cents)} to ${allocation.item.label}`).join(", ")
}

/** Records a received payment and applies it to the focused item and any of the customer's other open items. */
export async function recordReceivedPayment(input: RecordPaymentInput): Promise<ActionResult<{ readonly paymentId: string }>> {
  try {
    const context = await staffContext(input.projectId, "create")
    if (!context.success) return context
    const { db, organizationId, user } = context.data
    const paymentCents = toCents(input.amount)
    if (paymentCents === null || paymentCents <= 0) return actionFailure("Enter a payment amount greater than zero.")
    if (!parseDateOnly(input.paymentDate)) return actionFailure("Enter the date the payment was received.")
    if (!isListValue(RECEIVED_PAYMENT_METHODS, input.method)) return actionFailure("Choose check, cash, ACH or card.")
    const parsed = parseRequested(input.allocations)
    if (!parsed.ok) return actionFailure(parsed.error)
    const found = await customerItems(context.data, input.projectId, { focus: input.focus })
    if (!found) return actionFailure("That pay application or invoice is not open for payment.")
    const plan = planPaymentAllocations({
      paymentCents,
      alreadyAppliedCents: 0,
      openItems: found.items,
      requested: parsed.requested,
    })
    if (!plan.ok) return actionFailure(plan.error)
    const paymentId = crypto.randomUUID()
    const now = new Date().toISOString()
    const billingScope = plan.allocations[0]?.item.billingScope ?? "construction"
    const result = await applyReceivedPayment(context.data.env.DB, {
      organizationId,
      projectId: input.projectId,
      paymentId,
      actorId: user.id,
      now,
      expectedAppliedCents: 0,
      newPayment: {
        customerId: found.customerId,
        amountCents: paymentCents,
        paymentDate: input.paymentDate,
        paymentMethod: input.method,
        referenceNumber: input.reference.trim().slice(0, REFERENCE_MAX) || null,
        memo: input.memo.trim().slice(0, MEMO_MAX) || null,
        billingScope,
      },
      allocations: allocationWrites(plan.allocations),
    })
    if (result === "stale") return actionFailure(STALE)
    await recordActivityEvent({
      db, organizationId, projectId: input.projectId, actor: user, category: "financial",
      action: "payment_received", entityType: "payment", entityId: paymentId,
      summary: `Recorded a ${formatCents(paymentCents)} payment: ${appliedSummary(plan.allocations)}.`,
      metadata: { method: input.method, unappliedCents: plan.unappliedCents },
    })
    revalidatePayments(input.projectId, applicationIds(plan.allocations))
    return { success: true, data: { paymentId } }
  } catch (error) {
    return actionFailure(errorMessage(error, "Unable to record the payment."))
  }
}

function applicationIds(planned: readonly PlannedAllocation[]): string[] {
  return planned.filter((allocation) => allocation.kind === "pay_application").map((allocation) => allocation.id)
}

/** Applies more of a payment's unapplied amount to the customer's open items. */
export async function applyReceivedPaymentToItems(
  projectId: string,
  paymentId: string,
  allocations: RecordPaymentInput["allocations"],
): Promise<ActionDone> {
  try {
    const context = await staffContext(projectId, "create")
    if (!context.success) return context
    const { db, organizationId, user } = context.data
    const payment = await readReceivedPayment(db, organizationId, paymentId)
    if (!payment || payment.projectId !== projectId) return actionFailure(NOT_FOUND)
    if (payment.voidedAt) return actionFailure("This payment is void.")
    const parsed = parseRequested(allocations)
    if (!parsed.ok) return actionFailure(parsed.error)
    const scope = { organizationId, projectId }
    const [found, active] = await Promise.all([
      customerItems(context.data, projectId, { customerId: payment.customerId }),
      readActivePaymentAllocations(db, scope, paymentId),
    ])
    const alreadyApplied = new Set([
      ...active.payApplications.map((row) => `pay_application:${row.applicationId}`),
      ...active.invoices.map((row) => `invoice:${row.invoiceId}`),
    ])
    if (parsed.requested.some((entry) => alreadyApplied.has(`${entry.kind}:${entry.id}`))) {
      return actionFailure("This payment is already applied to that item. Void it and record it again to change the split.")
    }
    const items = (found?.items ?? []).filter((item) => item.billingScope === payment.billingScope)
    const alreadyAppliedCents = [...active.payApplications, ...active.invoices].reduce((sum, row) => sum + row.cents, 0)
    const plan = planPaymentAllocations({
      paymentCents: payment.amountCents,
      alreadyAppliedCents,
      openItems: items,
      requested: parsed.requested,
    })
    if (!plan.ok) return actionFailure(plan.error)
    const now = new Date().toISOString()
    const result = await applyReceivedPayment(context.data.env.DB, {
      organizationId,
      projectId,
      paymentId,
      actorId: user.id,
      now,
      newPayment: null,
      expectedAppliedCents: alreadyAppliedCents,
      allocations: allocationWrites(plan.allocations),
    })
    if (result === "stale") return actionFailure(STALE)
    await recordActivityEvent({
      db, organizationId, projectId, actor: user, category: "financial",
      action: "payment_applied", entityType: "payment", entityId: paymentId,
      summary: `Applied ${appliedSummary(plan.allocations)} from a received payment.`,
      metadata: { unappliedCents: plan.unappliedCents },
    })
    revalidatePayments(projectId, applicationIds(plan.allocations))
    return { success: true }
  } catch (error) {
    return actionFailure(errorMessage(error, "Unable to apply the payment."))
  }
}

/** Voids a received payment with a reason, releasing what it applied. The payment stays as history. */
export async function voidReceivedPaymentWithReason(projectId: string, paymentId: string, reason: string): Promise<ActionDone> {
  try {
    const context = await staffContext(projectId, "update")
    if (!context.success) return context
    const { db, organizationId, user } = context.data
    const payment = await readReceivedPayment(db, organizationId, paymentId)
    if (!payment || payment.projectId !== projectId) return actionFailure(NOT_FOUND)
    const blocker = paymentVoidBlocker(payment)
    if (blocker) return actionFailure(blocker)
    const parsedReason = parseVoidReason(reason)
    if (!parsedReason.ok) return actionFailure(parsedReason.error)
    const active = await readActivePaymentAllocations(db, { organizationId, projectId }, paymentId)
    const now = new Date().toISOString()
    const result = await voidReceivedPayment(context.data.env.DB, {
      organizationId,
      projectId,
      paymentId,
      actorId: user.id,
      reason: parsedReason.reason,
      now,
      invoiceReleases: active.invoices.map((row) => {
        const paidCents = storedDollarsToCents(row.amountPaid)
        return {
          allocationId: row.id,
          invoiceId: row.invoiceId,
          expectedPaidCents: paidCents,
          invoice: invoicePaidValues({
            totalDollars: row.total,
            paidCents: paidCentsAfterRelease(paidCents, row.cents),
            unpaidStatus: invoiceUnpaidStatus(row.sourceSystem),
          }),
        }
      }),
    })
    if (result === "stale") return actionFailure("This payment changed or was already voided. Refresh and try again.")
    await recordActivityEvent({
      db, organizationId, projectId, actor: user, category: "financial",
      action: "payment_voided", entityType: "payment", entityId: paymentId,
      summary: `Voided a ${formatCents(payment.amountCents)} payment: ${parsedReason.reason}`,
      metadata: {
        releasedPayApplicationCents: active.payApplications.reduce((sum, row) => sum + row.cents, 0),
        releasedInvoiceCents: active.invoices.reduce((sum, row) => sum + row.cents, 0),
      },
    })
    revalidatePayments(projectId, active.payApplications.map((row) => row.applicationId))
    return { success: true }
  } catch (error) {
    return actionFailure(errorMessage(error, "Unable to void the payment."))
  }
}

/** Paid and open amounts of the billed pay applications the viewer can see (owner portal included). */
export async function getOwnerPayApplicationBalances(projectId: string): Promise<ActionResult<Awaited<ReturnType<typeof readOwnerPayApplicationBalances>>>> {
  try {
    const context = await projectContext(projectId, { scope: "member" })
    if (!context.success) return context
    return { success: true, data: await readOwnerPayApplicationBalances(context.data.db, projectId) }
  } catch (error) {
    return actionFailure(errorMessage(error, "Unable to load payment status."))
  }
}
