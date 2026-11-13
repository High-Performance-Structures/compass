"use server"

import { and, eq, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { customers } from "@/db/schema"
import { sageTaxEntities } from "@/db/schema-estimates"
import { invoices } from "@/db/schema-netsuite"
import { actionFailure, errorMessage, type ActionDone, type ActionResult } from "@/lib/action-result"
import { recordActivityEvent } from "@/lib/activity-log"
import { simpleInvoiceContext } from "@/lib/domain/financials/access"
import {
  defaultSimpleInvoiceKind,
  estimateLineRemaining,
  invoiceTotals,
  normalizeInvoiceLines,
  overEstimateWarnings,
  squareEligibility,
  type EstimateLineBilling,
  type InvoiceLineInput,
} from "@/lib/domain/financials/simple-invoice-rules"
import {
  INVOICE_CUSTOMER_TYPES,
  INVOICE_PRICE_MODES,
  SIMPLE_INVOICE_KINDS,
  isCreditMemoKind,
  type InvoiceCustomerType,
  type InvoicePriceMode,
} from "@/lib/domain/financials/statuses"
import {
  cancelSquareInvoiceLink,
  deleteDraftSimpleInvoiceStatement,
  finalizeSimpleInvoice,
  simpleInvoiceMoveStatement,
  replaceInvoiceLinesStatements,
  simpleInvoiceInsertStatement,
  simpleInvoiceUpdateStatement,
  voidSimpleInvoice,
} from "@/lib/domain/financials/store"
import {
  arExportPossiblyInSage,
  cancelSageInvoiceArExport,
  confirmSageArExportNotInSage,
  cancelSageInvoiceArExportStatement,
  POSSIBLY_IN_SAGE_SQL,
} from "@/lib/domain/sage-bridge/ar-invoice-store"
import { addDays } from "@/lib/domain/sage-bridge/ar-invoice-rules"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { formatSageInvoiceNumber, simpleInvoiceNumberFormat } from "@/lib/financials/sage-invoice-number"
import { loadSimpleInvoiceExport, queueSimpleInvoiceSageExport } from "@/lib/financials/simple-invoice-sage"
import {
  loadCatalogProducts,
  loadEstimateForInvoice,
  loadSimpleInvoice,
  loadSimpleInvoiceProject,
  nextInvoiceSequence,
  priceInvoiceLines,
  projectInvoiceNumbers,
  readSimpleInvoiceSettings,
} from "@/lib/financials/simple-invoices-server"
import { formatCents } from "@/lib/format"
import { cancelSquareInvoice, squareInvoiceAccessToken } from "@/lib/sage/square-invoice-create"
import { canSendToSage } from "@/lib/sage/sage-send-access"

/*
 * Simple invoices on a job (Nu-Tech sales and one-off work): create (blank
 * or from an estimate, in part or in full), edit the draft with the shared
 * line editor, finalize (numbering), reopen, delete a draft, void a sent
 * one, and Send to Sage. Emailing (and Square) is in project-invoice-email.ts.
 */

function revalidateInvoice(projectId: string, invoiceId?: string): void {
  revalidatePath(`/dashboard/projects/${projectId}/financials`)
  if (invoiceId) revalidatePath(`/dashboard/projects/${projectId}/financials/invoices/${invoiceId}`)
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

async function validCustomer(db: Parameters<typeof loadSimpleInvoice>[0], organizationId: string, customerId: string): Promise<boolean> {
  const row = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.id, customerId), eq(customers.organizationId, organizationId))).get()
  return Boolean(row)
}

export type CreateProjectInvoiceInput = {
  readonly customerId: string
  /** Null: a blank invoice for one-off work. */
  readonly estimateId: string | null
  /** From an estimate: what's left on every line, or start with no lines and pick them in the editor. */
  readonly estimateLines: "remaining" | "none"
}

/** Creates a draft invoice and returns its id; staff finish it in the invoice editor. */
export async function createProjectInvoice(projectId: string, input: CreateProjectInvoiceInput): Promise<ActionResult<{ readonly invoiceId: string }>> {
  try {
    const context = await simpleInvoiceContext(projectId, "create")
    if (!context.success) return context
    const { db, user, organizationId } = context.data
    const [project, settings, sageSettings] = await Promise.all([
      loadSimpleInvoiceProject(db, organizationId, projectId),
      readSimpleInvoiceSettings(db, organizationId),
      readFeatureSettings(db, organizationId, "sage-ar-invoices"),
    ])
    if (!project) return actionFailure("Project not found.")
    if (!input.customerId || !(await validCustomer(db, organizationId, input.customerId))) return actionFailure("Choose who the invoice is billed to.")
    const issueDate = today()
    let lines: InvoiceLineInput[] = []
    let taxEntityId: string | null = null
    let title = ""
    let priceMode: InvoicePriceMode = "standard"
    let priceCustomerType: InvoiceCustomerType = "returning"
    if (input.estimateId) {
      const estimate = await loadEstimateForInvoice(db, projectId, input.estimateId, null)
      if (!estimate) return actionFailure("That estimate is no longer on this job.")
      taxEntityId = estimate.order?.taxEntityId ?? estimate.estimate.defaultTaxEntityId
      title = estimate.estimate.title.slice(0, 50)
      priceMode = estimate.order?.pricingMode ?? "standard"
      priceCustomerType = estimate.order?.customerType ?? "returning"
      if (input.estimateLines === "remaining") {
        lines = estimate.lines.flatMap((line): InvoiceLineInput[] => {
          const remaining = estimateLineRemaining(line)
          if (remaining.cents <= 0 || remaining.quantity <= 0) return []
          return [{
            source: "estimate",
            estimateLineId: line.estimateLineId,
            nutechProductId: line.nutechProductId,
            costCode: line.costCode,
            description: line.description,
            quantity: remaining.quantity,
            unit: line.unit,
            unitPriceCents: line.unitPriceCents,
            taxable: line.taxable,
          }]
        })
      }
    }
    const normalized = normalizeInvoiceLines(lines)
    if (!normalized.ok) return actionFailure(normalized.error)
    const rate = taxEntityId
      ? (await db.select({ rate: sageTaxEntities.rateBasisPoints }).from(sageTaxEntities).where(eq(sageTaxEntities.id, taxEntityId)).get())?.rate ?? null
      : null
    const totals = invoiceTotals(normalized.lines, rate)
    const now = new Date().toISOString()
    const invoiceId = crypto.randomUUID()
    await db.batch([
      simpleInvoiceInsertStatement(db, {
        id: invoiceId,
        organizationId,
        customerId: input.customerId,
        projectId,
        sourceSystem: "compass",
        status: "draft",
        invoiceKind: defaultSimpleInvoiceKind(project.department, settings.materialSaleDepartments),
        estimateId: input.estimateId,
        taxEntityId,
        title: title || null,
        issueDate,
        dueDate: addDays(issueDate, sageSettings.dueDays),
        subtotal: totals.subtotalCents / 100,
        tax: totals.taxCents / 100,
        total: totals.totalCents / 100,
        amountPaid: 0,
        amountDue: totals.totalCents / 100,
        priceMode,
        priceCustomerType,
        createdByUserId: user.id,
        createdAt: now,
        updatedAt: now,
      }),
      ...replaceInvoiceLinesStatements(db, invoiceId, normalized.lines.map((line, index) => ({ ...line, id: crypto.randomUUID(), invoiceId, sortOrder: index, createdAt: now, updatedAt: now }))),
    ])
    await recordActivityEvent({
      db,
      organizationId,
      projectId,
      actor: user,
      category: "financial",
      action: "invoice_created",
      entityType: "invoice",
      entityId: invoiceId,
      summary: `Draft invoice started${input.estimateId ? " from an estimate" : ""} (${normalized.lines.length} lines, ${formatCents(totals.totalCents)}).`,
      createdAt: now,
    })
    revalidateInvoice(projectId)
    return { success: true, data: { invoiceId } }
  } catch (error) {
    return actionFailure(errorMessage(error, "Unable to start the invoice."))
  }
}

export type SaveProjectInvoiceInput = {
  readonly expectedUpdatedAt: string
  readonly customerId: string
  readonly invoiceKind: string
  readonly title: string
  readonly memo: string
  readonly issueDate: string
  readonly dueDate: string
  readonly taxEntityId: string | null
  readonly isDeposit: boolean
  readonly priceMode: string
  readonly priceCustomerType: string
  readonly squareRequested: boolean
  readonly lines: readonly InvoiceLineInput[]
  /** Staff confirmed billing more than the estimate on some lines. */
  readonly allowOverEstimate: boolean
}

export type SaveProjectInvoiceResult =
  | { readonly kind: "saved"; readonly updatedAt: string; readonly totalCents: number }
  /** Some estimate lines go over the estimate; ask staff to confirm and save again with allowOverEstimate. */
  | { readonly kind: "over_estimate"; readonly warnings: readonly string[] }

/** Saves a draft's header and lines; totals and catalog prices are recomputed here. */
export async function saveProjectInvoiceDraft(projectId: string, invoiceId: string, input: SaveProjectInvoiceInput): Promise<ActionResult<SaveProjectInvoiceResult>> {
  try {
    const context = await simpleInvoiceContext(projectId, "update")
    if (!context.success) return context
    const { db, user, organizationId } = context.data
    const [invoice, project, settings] = await Promise.all([
      loadSimpleInvoice(db, organizationId, projectId, invoiceId),
      loadSimpleInvoiceProject(db, organizationId, projectId),
      readSimpleInvoiceSettings(db, organizationId),
    ])
    if (!invoice || !project) return actionFailure("Invoice not found.")
    if (invoice.status !== "draft") return actionFailure("Only a draft invoice can be edited. Reopen it first.")
    if (invoice.updatedAt !== input.expectedUpdatedAt) return actionFailure("Someone else changed this invoice. Refresh to see their changes.")
    const kind = SIMPLE_INVOICE_KINDS.find((value) => value === input.invoiceKind)
    const priceMode = INVOICE_PRICE_MODES.find((value) => value === input.priceMode)
    const customerType = INVOICE_CUSTOMER_TYPES.find((value) => value === input.priceCustomerType)
    if (!kind || !priceMode || !customerType) return actionFailure("Choose the invoice type and price list.")
    if (!DATE.test(input.issueDate) || !DATE.test(input.dueDate)) return actionFailure("Enter the invoice and due dates.")
    if (input.dueDate < input.issueDate) return actionFailure("The due date can't be before the invoice date.")
    if (input.title.trim().length > 50) return actionFailure("Keep the invoice description to 50 characters (Sage's limit).")
    if (input.memo.length > 2000) return actionFailure("Keep the note under 2,000 characters.")
    if (!(await validCustomer(db, organizationId, input.customerId))) return actionFailure("Choose who the invoice is billed to.")
    // A credit memo gives money back: no Square link, not a deposit, and only added lines (it never bills estimate lines).
    if (isCreditMemoKind(kind)) {
      if (input.squareRequested) return actionFailure("A credit memo can't have a Square invoice.")
      if (input.isDeposit) return actionFailure("A credit memo can't be a deposit invoice.")
      if (input.lines.some((line) => line.source === "estimate")) return actionFailure("A credit memo can't bill estimate lines. Remove them and add the credit as added lines.")
    }
    if (input.squareRequested) {
      const eligibility = squareEligibility({ isDeposit: input.isDeposit, department: project.department, blockedDepositDepartments: settings.squareBlockedDepositDepartments })
      if (!eligibility.allowed) return actionFailure(eligibility.reason)
    }
    let rate: number | null = null
    if (input.taxEntityId) {
      const district = await db.select({ rate: sageTaxEntities.rateBasisPoints }).from(sageTaxEntities).where(and(eq(sageTaxEntities.id, input.taxEntityId), eq(sageTaxEntities.active, true))).get()
      if (!district) return actionFailure("Choose an active sales tax district.")
      rate = district.rate
    }
    // Estimate lines must belong to the invoice's estimate.
    const estimate = invoice.estimateId ? await loadEstimateForInvoice(db, projectId, invoice.estimateId, invoice.id) : null
    const estimateLineIds = new Set(estimate?.lines.map((line) => line.estimateLineId) ?? [])
    if (input.lines.some((line) => line.source === "estimate" && (!line.estimateLineId || !estimateLineIds.has(line.estimateLineId)))) {
      return actionFailure("A line points at an estimate line that isn't on this invoice's estimate. Refresh and try again.")
    }
    const catalog = new Map((await loadCatalogProducts(db, organizationId)).map((product) => [product.id, product]))
    const priced = priceInvoiceLines(
      input.lines.map((line) => ({ ...line, nutechProductId: line.nutechProductId && catalog.has(line.nutechProductId) ? line.nutechProductId : null })),
      { squareRequested: input.squareRequested, priceMode, customerType, catalog }
    )
    const normalized = normalizeInvoiceLines(priced)
    if (!normalized.ok) return actionFailure(normalized.error)
    const billing = new Map<string, EstimateLineBilling>((estimate?.lines ?? []).map((line) => [line.estimateLineId, line]))
    const warnings = overEstimateWarnings(normalized.lines, billing)
    if (warnings.length > 0 && !input.allowOverEstimate) return { success: true, data: { kind: "over_estimate", warnings } }
    const totals = invoiceTotals(normalized.lines, rate)
    const now = new Date().toISOString()
    const [updated] = await db.batch([
      simpleInvoiceUpdateStatement(db, and(eq(invoices.id, invoiceId), eq(invoices.organizationId, organizationId), eq(invoices.status, "draft"), eq(invoices.updatedAt, input.expectedUpdatedAt)), {
        customerId: input.customerId,
        invoiceKind: kind,
        title: input.title.trim() || null,
        memo: input.memo.trim() || null,
        issueDate: input.issueDate,
        dueDate: input.dueDate,
        taxEntityId: input.taxEntityId,
        isDeposit: input.isDeposit,
        priceMode,
        priceCustomerType: customerType,
        squareRequested: input.squareRequested,
        subtotal: totals.subtotalCents / 100,
        tax: totals.taxCents / 100,
        total: totals.totalCents / 100,
        amountDue: totals.totalCents / 100,
        updatedAt: now,
      }).returning({ id: invoices.id }),
      ...replaceInvoiceLinesStatements(db, invoiceId, normalized.lines.map((line, index) => ({ ...line, id: crypto.randomUUID(), invoiceId, sortOrder: index, createdAt: now, updatedAt: now }))),
    ])
    if (updated.length !== 1) return actionFailure("Someone else changed this invoice. Refresh to see their changes.")
    if (warnings.length > 0) {
      await recordActivityEvent({
        db,
        organizationId,
        projectId,
        actor: user,
        category: "financial",
        action: "invoice_over_estimate",
        entityType: "invoice",
        entityId: invoiceId,
        summary: `Draft invoice bills more than the estimate (confirmed): ${warnings.join(" ")}`,
        createdAt: now,
      })
    }
    revalidateInvoice(projectId, invoiceId)
    return { success: true, data: { kind: "saved", updatedAt: now, totalCents: totals.totalCents } }
  } catch (error) {
    return actionFailure(errorMessage(error, "Unable to save the invoice."))
  }
}

/** Finalizes a draft: gives it its Sage invoice number. It can then go to Sage, be emailed and take payments. */
export async function finalizeProjectInvoice(projectId: string, invoiceId: string): Promise<ActionResult<{ readonly invoiceNumber: string }>> {
  try {
    const context = await simpleInvoiceContext(projectId, "update")
    if (!context.success) return context
    const { db, user, organizationId } = context.data
    const [invoice, project, exportSettings] = await Promise.all([
      loadSimpleInvoice(db, organizationId, projectId, invoiceId),
      loadSimpleInvoiceProject(db, organizationId, projectId),
      readFeatureSettings(db, organizationId, "sage-export"),
    ])
    if (!invoice || !project) return actionFailure("Invoice not found.")
    if (invoice.status !== "draft") return actionFailure("This invoice is already final.")
    if (invoice.lines.length === 0) return actionFailure("Add at least one line first.")
    if (invoice.totalCents <= 0) return actionFailure("The invoice total must be more than zero.")
    if (invoice.lines.some((line) => line.taxable) && !invoice.taxEntityId) return actionFailure("Some lines are taxable; choose the sales tax district first.")
    const format = simpleInvoiceNumberFormat(invoice.invoiceKind, exportSettings)
    const now = new Date().toISOString()
    // A reopened invoice keeps its number; a new one takes the next free number of its kind.
    let sequence = invoice.sequenceNumber ?? (await nextInvoiceSequence(db, projectId, invoice.invoiceKind))
    let number = formatSageInvoiceNumber(format, { projectNumber: project.projectNumber, sageJobNumber: project.sageJobNumber, number: String(sequence) })
    // Another invoice of the job finalized at the same moment may take the
    // same sequence number first (the unique index refuses the second): take the next one.
    for (let attempt = 0; ; attempt += 1) {
      if (invoice.sequenceNumber === null) {
        const taken = await projectInvoiceNumbers(db, organizationId, projectId)
        while (taken.has(number.value.trim().toUpperCase()) && sequence < 999) {
          sequence += 1
          number = formatSageInvoiceNumber(format, { projectNumber: project.projectNumber, sageJobNumber: project.sageJobNumber, number: String(sequence) })
        }
      }
      if (number.error) return actionFailure(number.error)
      const outcome = await finalizeSimpleInvoice(db, { invoiceId, organizationId, projectId, sequenceNumber: sequence, invoiceNumber: number.value, actorId: user.id, now })
      if (outcome === "finalized") break
      if (outcome === "changed") return actionFailure("Someone else changed this invoice. Refresh and try again.")
      if (invoice.sequenceNumber !== null || attempt >= 4) return actionFailure("Another invoice took this invoice number. Refresh and try again.")
      sequence = Math.max(sequence + 1, await nextInvoiceSequence(db, projectId, invoice.invoiceKind))
      number = formatSageInvoiceNumber(format, { projectNumber: project.projectNumber, sageJobNumber: project.sageJobNumber, number: String(sequence) })
    }
    await recordActivityEvent({
      db,
      organizationId,
      projectId,
      actor: user,
      category: "financial",
      action: "invoice_finalized",
      entityType: "invoice",
      entityId: invoiceId,
      summary: `${isCreditMemoKind(invoice.invoiceKind) ? "Credit memo" : "Invoice"} ${number.value} finalized (${formatCents(invoice.totalCents)}).`,
      createdAt: now,
    })
    revalidateInvoice(projectId, invoiceId)
    return { success: true, data: { invoiceNumber: number.value } }
  } catch (error) {
    return actionFailure(errorMessage(error, "Unable to finalize the invoice."))
  }
}

const SAGE_MAY_HAVE_IT = "Sage may already have this invoice; check Sage first, or void it instead."

/** Takes a final invoice back to draft, while nothing has gone out (Sage, email, Square) and nothing is paid. */
export async function reopenProjectInvoice(projectId: string, invoiceId: string): Promise<ActionDone> {
  try {
    const context = await simpleInvoiceContext(projectId, "update")
    if (!context.success) return context
    const { db, user, organizationId } = context.data
    const invoice = await loadSimpleInvoice(db, organizationId, projectId, invoiceId)
    if (!invoice) return actionFailure("Invoice not found.")
    if (invoice.emailedAt || invoice.squareState === "published" || invoice.amountPaidCents > 0) {
      return actionFailure("This invoice has gone out or been paid; void it instead.")
    }
    const mayBeInSage = () => arExportPossiblyInSage(db, { kind: "invoice", organizationId, sourceId: invoiceId })
    if (await mayBeInSage()) return actionFailure(SAGE_MAY_HAVE_IT)
    const now = new Date().toISOString()
    // One batch: the invoice goes back to draft (machine fence, nothing paid)
    // only while Sage can't have it (no export the writer ran or is running,
    // see POSSIBLY_IN_SAGE_SQL), and its queued export is cancelled only if
    // that reopen landed. Neither can happen without the other.
    const [reopened] = await db.batch([
      simpleInvoiceMoveStatement(db, { invoiceId, organizationId, projectId }, "reopen", { updatedAt: now }, and(
        eq(invoices.amountPaid, 0),
        sql`NOT EXISTS (SELECT 1 FROM sage_invoice_ar_exports WHERE invoice_id = ${invoiceId} AND ${sql.raw(POSSIBLY_IN_SAGE_SQL)})`,
      )),
      cancelSageInvoiceArExportStatement(db, {
        organizationId, invoiceId, now,
        when: sql`EXISTS (SELECT 1 FROM invoices WHERE id = ${invoiceId} AND status = 'draft' AND updated_at = ${now})`,
      }),
    ])
    if (reopened.length !== 1) {
      return actionFailure((await mayBeInSage()) ? SAGE_MAY_HAVE_IT : "Only a final, unpaid invoice can be reopened.")
    }
    await recordActivityEvent({
      db,
      organizationId,
      projectId,
      actor: user,
      category: "financial",
      action: "invoice_reopened",
      entityType: "invoice",
      entityId: invoiceId,
      summary: `Invoice ${invoice.invoiceNumber ?? ""} reopened as a draft.`.replace("  ", " "),
      createdAt: now,
    })
    revalidateInvoice(projectId, invoiceId)
    return { success: true }
  } catch (error) {
    return actionFailure(errorMessage(error, "Unable to reopen the invoice."))
  }
}

/** Deletes a draft invoice that never went anywhere. */
export async function deleteProjectInvoice(projectId: string, invoiceId: string): Promise<ActionDone> {
  try {
    const context = await simpleInvoiceContext(projectId, "delete")
    if (!context.success) return context
    const { db, user, organizationId } = context.data
    const invoice = await loadSimpleInvoice(db, organizationId, projectId, invoiceId)
    if (!invoice) return actionFailure("Invoice not found.")
    const exported = await loadSimpleInvoiceExport(db, organizationId, invoiceId)
    if (invoice.status !== "draft" || invoice.emailedAt || invoice.squareInvoiceId || (exported && ["running", "succeeded"].includes(exported.status))) {
      return actionFailure("Only a draft that hasn't gone out can be deleted; void this invoice instead.")
    }
    const deleted = await deleteDraftSimpleInvoiceStatement(db, { invoiceId, organizationId, projectId })
    if (deleted.length !== 1) return actionFailure("Only a draft invoice can be deleted.")
    await recordActivityEvent({
      db,
      organizationId,
      projectId,
      actor: user,
      category: "financial",
      action: "invoice_deleted",
      entityType: "invoice",
      entityId: invoiceId,
      summary: `Draft invoice deleted (${invoice.lines.length} lines, ${formatCents(invoice.totalCents)}).`,
      createdAt: new Date().toISOString(),
    })
    revalidateInvoice(projectId)
    return { success: true }
  } catch (error) {
    return actionFailure(errorMessage(error, "Unable to delete the invoice."))
  }
}

/**
 * "I checked Sage: it isn't there." Clears an export that may be in Sage (the
 * writer's last result was a failure that may have written), so reopen and
 * void behave normally. Same permission as reopen and void; who and when go
 * on the export and the Activity.
 */
export async function confirmProjectInvoiceNotInSage(projectId: string, invoiceId: string): Promise<ActionDone> {
  try {
    const context = await simpleInvoiceContext(projectId, "update")
    if (!context.success) return context
    const { db, user, organizationId } = context.data
    const invoice = await loadSimpleInvoice(db, organizationId, projectId, invoiceId)
    if (!invoice) return actionFailure("Invoice not found.")
    const now = new Date().toISOString()
    const who = user.displayName ?? user.email
    const note = `${who} checked Sage on ${now.slice(0, 10)}: the invoice isn't there.`
    if (!(await confirmSageArExportNotInSage(db, { kind: "invoice", organizationId, sourceId: invoiceId, note, now }))) {
      return actionFailure("This invoice isn't waiting on a Sage check (Sage has it, or it changed). Refresh to see where it is.")
    }
    await recordActivityEvent({
      db,
      organizationId,
      projectId,
      actor: user,
      category: "financial",
      action: "invoice_sage_checked_absent",
      entityType: "invoice",
      entityId: invoiceId,
      summary: `Invoice ${invoice.invoiceNumber ?? ""}: ${who} checked Sage and it isn't there.`,
      createdAt: now,
    })
    revalidateInvoice(projectId, invoiceId)
    return { success: true }
  } catch (error) {
    return actionFailure(errorMessage(error, "Unable to record the Sage check."))
  }
}

/**
 * Voids a final invoice (kept for the record, never deleted). A Sage export
 * that hasn't reached Sage is cancelled; an invoice already in Sage must be
 * voided in Sage too. A published Square invoice is cancelled in Square.
 */
export async function voidProjectInvoice(projectId: string, invoiceId: string, reason: string): Promise<ActionResult<{ readonly notes: readonly string[] }>> {
  try {
    const context = await simpleInvoiceContext(projectId, "update")
    if (!context.success) return context
    const { db, env, user, organizationId } = context.data
    const why = reason.trim()
    if (!why || why.length > 500) return actionFailure("Say why the invoice is void.")
    const invoice = await loadSimpleInvoice(db, organizationId, projectId, invoiceId)
    if (!invoice) return actionFailure("Invoice not found.")
    if (invoice.status === "draft") return actionFailure("Delete a draft instead of voiding it.")
    if (invoice.status === "void") return actionFailure("This invoice is already void.")
    if (invoice.amountPaidCents > 0) return actionFailure("This invoice has payments applied. Release them on the Financials page first.")
    const now = new Date().toISOString()
    // Void first: the Sage export and Square invoice are cancelled only once
    // the void landed, so a void that loses to a payment or a second click
    // never cancels anything behind an invoice that stays open.
    if (!(await voidSimpleInvoice(db, { invoiceId, organizationId, projectId, reason: why, actorId: user.id, now }))) {
      return actionFailure("Someone else changed this invoice (or a payment was applied). Refresh and try again.")
    }
    const notes: string[] = []
    if (await loadSimpleInvoiceExport(db, organizationId, invoiceId)) {
      // A queued export is withdrawn. Whether or not that lands, an export the
      // writer ran or is running may be in Sage (the writer can report a
      // failure for an invoice Sage took), so staff are told to check.
      const cancelled = await cancelSageInvoiceArExport(db, { organizationId, invoiceId, now })
      if (!cancelled || (await arExportPossiblyInSage(db, { kind: "invoice", organizationId, sourceId: invoiceId }))) {
        notes.push(`Invoice ${invoice.invoiceNumber ?? ""} may be in Sage (or being added): check Sage and void it there too.`)
      }
    }
    // The stored Square id, read again: a Square invoice created while this void ran is cancelled too.
    const squareInvoiceId = (await loadSimpleInvoice(db, organizationId, projectId, invoiceId))?.squareInvoiceId ?? invoice.squareInvoiceId
    if (squareInvoiceId) {
      const token = squareInvoiceAccessToken(env)
      try {
        if (!token) throw new Error("Square isn't connected.")
        await cancelSquareInvoice(token, squareInvoiceId)
        await cancelSquareInvoiceLink(db, { invoiceId, organizationId, projectId, now })
      } catch (error) {
        notes.push(`Cancel the Square invoice in Square: ${errorMessage(error, "Square didn't confirm.")}`)
      }
    }
    await recordActivityEvent({
      db,
      organizationId,
      projectId,
      actor: user,
      category: "financial",
      action: "invoice_voided",
      entityType: "invoice",
      entityId: invoiceId,
      summary: `Invoice ${invoice.invoiceNumber ?? ""} voided: ${why}${notes.length > 0 ? ` (${notes.join(" ")})` : ""}`,
      createdAt: now,
    })
    revalidateInvoice(projectId, invoiceId)
    return { success: true, data: { notes } }
  } catch (error) {
    return actionFailure(errorMessage(error, "Unable to void the invoice."))
  }
}

/** Sends (or retries) a final invoice to Sage as an AR invoice. Sage posts it when it is saved. */
export async function sendProjectInvoiceToSage(projectId: string, invoiceId: string): Promise<ActionResult<{ readonly status: string; readonly reason: string | null }>> {
  try {
    const context = await simpleInvoiceContext(projectId, "update")
    if (!context.success) return context
    const { db, user, organizationId } = context.data
    if (!canSendToSage(user)) return actionFailure("Only office staff with finance access can send invoices to Sage.")
    const result = await queueSimpleInvoiceSageExport({ db, organizationId, projectId, invoiceId, actor: { ...user, id: user.id } })
    revalidateInvoice(projectId, invoiceId)
    if (result.status === "off" || result.status === "skipped") return actionFailure(result.reason)
    return { success: true, data: { status: result.status, reason: result.reason } }
  } catch (error) {
    return actionFailure(errorMessage(error, "Unable to send the invoice to Sage."))
  }
}
