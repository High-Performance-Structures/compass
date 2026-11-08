import "server-only"

import { and, eq } from "drizzle-orm"

import { sageTaxEntities } from "@/db/schema-estimates"
import { sageInvoiceArExports } from "@/db/schema-sage"
import { recordActivityEvent, type ActivityActor } from "@/lib/activity-log"
import { loadProjectCostCodeCatalog } from "@/lib/cost-codes/catalog-server"
import { getCloudflareContext } from "@/lib/db"
import { planSimpleInvoiceForSage, type InvoiceLineComputed } from "@/lib/domain/financials/simple-invoice-rules"
import type { ArInvoicePlan, ArInvoiceTaxDistrict } from "@/lib/domain/sage-bridge/ar-invoice-rules"
import { upsertSageInvoiceArExport } from "@/lib/domain/sage-bridge/ar-invoice-store"
import type { SageArInvoiceExportStatus } from "@/lib/domain/sage-bridge/statuses"
import { incomeAccountFor } from "@/lib/feature-settings/sage-ar-invoice-settings"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { indexSageCatalog, mapToSageCostCode } from "@/lib/financials/sage-export-codes"
import { loadSimpleInvoice, loadSimpleInvoiceProject, type SimpleInvoiceRecord } from "@/lib/financials/simple-invoices-server"
import { isCreditMemoKind } from "@/lib/domain/financials/statuses"
import { formatCents } from "@/lib/format"
import { sageArInvoiceWritePayload, sageArInvoiceWritesEnabled, type SageArInvoiceWritePayload } from "@/lib/sage/ar-invoice-write"
import type { Db } from "@/lib/server/action-context"

/*
 * Simple Compass invoice → Sage AR invoice, through the same writer, payload
 * and result route as billed pay requests (PR #1209). Office staff press Send
 * to Sage on a final invoice; Sage posts an AR invoice when it is saved.
 * Guards stop it as "Needs attention" instead of sending something that
 * doesn't tie.
 */

/** Sage's tax district record number: the entity's Sage record, else its code's digits ("04-0017" is 40017). */
function districtRecordNumber(entity: { readonly sourceRecordId: string | null; readonly code: string }): string | null {
  const source = entity.sourceRecordId?.trim() ?? ""
  if (/^\d{1,12}$/.test(source)) return String(Number(source))
  const digits = entity.code.replaceAll(/[^\d]/g, "")
  return /^\d{1,12}$/.test(digits) && Number(digits) > 0 ? String(Number(digits)) : null
}

async function loadDistrict(db: Db, taxEntityId: string | null): Promise<{ readonly district: ArInvoiceTaxDistrict | null; readonly unmapped: boolean }> {
  if (!taxEntityId) return { district: null, unmapped: false }
  const entity = await db
    .select({ sourceRecordId: sageTaxEntities.sourceRecordId, code: sageTaxEntities.code, name: sageTaxEntities.name, rateBasisPoints: sageTaxEntities.rateBasisPoints })
    .from(sageTaxEntities)
    .where(eq(sageTaxEntities.id, taxEntityId))
    .get()
  if (!entity) return { district: null, unmapped: false }
  const record = districtRecordNumber(entity)
  return record ? { district: { sageRecordNumber: record, name: entity.name, rateBasisPoints: entity.rateBasisPoints }, unmapped: false } : { district: null, unmapped: true }
}

export type SimpleInvoiceSageSource = {
  readonly invoice: SimpleInvoiceRecord
  readonly sageJobNumber: string | null
  readonly sageJobId: string | null
  readonly plan: ArInvoicePlan
  readonly invoiceType: number
  readonly invoiceStatus: number
}

/** The invoice as Compass would send it to Sage now. */
export async function loadSimpleInvoiceSageSource(
  db: Db,
  input: { readonly organizationId: string; readonly projectId: string; readonly invoiceId: string }
): Promise<SimpleInvoiceSageSource | null> {
  const [project, invoice, catalog, settings] = await Promise.all([
    loadSimpleInvoiceProject(db, input.organizationId, input.projectId),
    loadSimpleInvoice(db, input.organizationId, input.projectId, input.invoiceId),
    loadProjectCostCodeCatalog(db),
    readFeatureSettings(db, input.organizationId, "sage-ar-invoices"),
  ])
  if (!project || !invoice) return null
  const { district, unmapped } = await loadDistrict(db, invoice.taxEntityId)
  const index = indexSageCatalog(catalog)
  const lines: InvoiceLineComputed[] = invoice.lines.map((line) => ({ ...line }))
  const plan = planSimpleInvoiceForSage({
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.issueDate.slice(0, 10),
    dueDays: settings.dueDays,
    title: invoice.title ?? "",
    lines,
    taxDistrict: district,
    taxDistrictUnmapped: unmapped,
    incomeAccount: incomeAccountFor(settings, project.department),
    sageJobNumber: project.sageJobNumber,
    mapCostCode: (costCode) => mapToSageCostCode(costCode, index),
    credit: isCreditMemoKind(invoice.invoiceKind),
  })
  return { invoice, sageJobNumber: project.sageJobNumber, sageJobId: project.sageJobId, plan, invoiceType: settings.invoiceType, invoiceStatus: settings.invoiceStatus }
}

export type QueueSimpleInvoiceSageResult =
  | { readonly status: "off" | "skipped"; readonly reason: string }
  | { readonly status: Extract<SageArInvoiceExportStatus, "queued" | "needs_attention">; readonly reason: string | null }

/** Queues a final invoice for Sage, or flags what needs attention. */
export async function queueSimpleInvoiceSageExport(input: {
  readonly db: Db
  readonly organizationId: string
  readonly projectId: string
  readonly invoiceId: string
  readonly actor: ActivityActor & { readonly id: string }
}): Promise<QueueSimpleInvoiceSageResult> {
  const { env } = await getCloudflareContext()
  if (!sageArInvoiceWritesEnabled(env)) return { status: "off", reason: "Sending invoices to Sage isn't turned on for this company yet." }
  const { db, organizationId, projectId, invoiceId } = input
  const source = await loadSimpleInvoiceSageSource(db, { organizationId, projectId, invoiceId })
  if (!source) return { status: "skipped", reason: "Invoice not found." }
  if (source.invoice.status === "draft") return { status: "skipped", reason: "Finalize the invoice first." }
  if (source.invoice.status === "void") return { status: "skipped", reason: "This invoice is void." }
  const label = isCreditMemoKind(source.invoice.invoiceKind) ? "Credit memo" : "Invoice"
  const blocker = source.plan.blockers.length > 0 ? source.plan.blockers.join(" ") : null
  const status = blocker ? "needs_attention" : "queued"
  const now = new Date().toISOString()
  const written = await upsertSageInvoiceArExport(db, {
    organizationId,
    projectId,
    invoiceId,
    status,
    invoiceNumber: source.plan.invoiceNumber || "(none)",
    requestedByUserId: input.actor.id,
    errorMessage: blocker,
    now,
  })
  if (!written) return { status: "skipped", reason: "This invoice is already on its way to Sage or in Sage." }
  await recordActivityEvent({
    db,
    organizationId,
    projectId,
    actor: input.actor,
    category: "financial",
    action: status === "needs_attention" ? "invoice_sage_needs_attention" : "invoice_sage_queued",
    entityType: "invoice",
    entityId: invoiceId,
    summary:
      status === "needs_attention"
        ? `${label} ${source.plan.invoiceNumber}: Sage AR invoice needs attention. ${blocker ?? ""}`.trim()
        : `${label} ${source.plan.invoiceNumber}: sent to Sage as an AR invoice (${source.plan.lines.length} lines, ${formatCents(source.plan.netDueCents)}).`,
    metadata: { status, invoiceNumber: source.plan.invoiceNumber, totalCents: source.plan.netDueCents },
    createdAt: now,
  })
  return { status, reason: blocker }
}

export type SimpleInvoiceWriterRequest =
  | { readonly kind: "ready"; readonly payload: SageArInvoiceWritePayload }
  | { readonly kind: "needs_attention"; readonly reason: string }

/** Builds the writer request for a claimed invoice export from the invoice as it is now. */
export async function buildSimpleInvoiceWriterRequest(
  db: Db,
  row: { readonly organizationId: string; readonly projectId: string; readonly invoiceId: string; readonly invoiceNumber: string }
): Promise<SimpleInvoiceWriterRequest> {
  const source = await loadSimpleInvoiceSageSource(db, row)
  if (!source) return { kind: "needs_attention", reason: "The invoice wasn't found." }
  if (source.invoice.status === "draft" || source.invoice.status === "void") {
    return { kind: "needs_attention", reason: "The invoice is no longer final." }
  }
  if (source.plan.blockers.length > 0) return { kind: "needs_attention", reason: source.plan.blockers.join(" ") }
  if (source.plan.invoiceNumber !== row.invoiceNumber) {
    return { kind: "needs_attention", reason: `The invoice number changed from ${row.invoiceNumber} to ${source.plan.invoiceNumber}; send it again.` }
  }
  if (!source.sageJobNumber) return { kind: "needs_attention", reason: "The project isn't linked to a Sage job." }
  // The writer ignores compassApplicationId (it logs the export id); the
  // invoice id rides there so the payload shape stays the writer's.
  const payload = sageArInvoiceWritePayload(source.plan, {
    projectId: row.projectId,
    applicationId: row.invoiceId,
    applicationNumber: source.plan.invoiceNumber,
    sageJobNumber: source.sageJobNumber,
    sageJobId: source.sageJobId,
    invoiceType: source.invoiceType,
    invoiceStatus: source.invoiceStatus,
  })
  if (!payload) return { kind: "needs_attention", reason: "The invoice's Sage details aren't complete." }
  const memo = `Compass ${isCreditMemoKind(source.invoice.invoiceKind) ? "credit memo" : "invoice"} ${source.plan.invoiceNumber}`
  return { kind: "ready", payload: { ...payload, invoice: { ...payload.invoice, memo: memo.slice(0, 200) } } }
}

export type SimpleInvoiceExportView = {
  readonly status: SageArInvoiceExportStatus
  readonly invoiceNumber: string
  readonly errorMessage: string | null
  readonly requestedAt: string
  readonly completedAt: string | null
  readonly sageRecordId: string | null
  readonly sageTotalCents: number | null
}

export async function loadSimpleInvoiceExport(db: Db, organizationId: string, invoiceId: string): Promise<SimpleInvoiceExportView | null> {
  const row = await db
    .select({
      status: sageInvoiceArExports.status,
      invoiceNumber: sageInvoiceArExports.invoiceNumber,
      errorMessage: sageInvoiceArExports.errorMessage,
      requestedAt: sageInvoiceArExports.requestedAt,
      completedAt: sageInvoiceArExports.completedAt,
      sageRecordId: sageInvoiceArExports.sageRecordId,
      sageTotalCents: sageInvoiceArExports.sageTotalCents,
    })
    .from(sageInvoiceArExports)
    .where(and(eq(sageInvoiceArExports.invoiceId, invoiceId), eq(sageInvoiceArExports.organizationId, organizationId)))
    .get()
  return row ?? null
}
