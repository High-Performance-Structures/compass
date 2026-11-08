import "server-only"

import { and, asc, desc, eq, inArray } from "drizzle-orm"

import { projectBudgetApplications, projectBudgetLines, projects } from "@/db/schema"
import { sageArInvoiceExports } from "@/db/schema-sage"
import { recordActivityEvent, type ActivityActor } from "@/lib/activity-log"
import { loadProjectCostCodeCatalog } from "@/lib/cost-codes/catalog-server"
import { getCloudflareContext } from "@/lib/db"
import { COMPASS_DRAW_SOURCE } from "@/lib/domain/financials/rules"
import { arInvoiceDescription, planSageArInvoice, type ArInvoicePlan } from "@/lib/domain/sage-bridge/ar-invoice-rules"
import { upsertSageArInvoiceExport } from "@/lib/domain/sage-bridge/ar-invoice-store"
import type { SageArInvoiceExportStatus } from "@/lib/domain/sage-bridge/statuses"
import { incomeAccountFor } from "@/lib/feature-settings/sage-ar-invoice-settings"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { indexSageCatalog, mapToSageCostCode } from "@/lib/financials/sage-export-codes"
import { applicationSequence } from "@/lib/financials/sage-export-preview"
import { formatSageInvoiceNumber } from "@/lib/financials/sage-invoice-number"
import { formatCents, toCents } from "@/lib/format"
import { loadChangeOrderParts, loadChangeOrderTax, loadContractTax, loadTaxDistrict } from "@/lib/sage/contract-tax-server"
import { sageArInvoiceWritePayload, sageArInvoiceWritesEnabled, type SageArInvoiceWritePayload } from "@/lib/sage/ar-invoice-write"
import type { Db } from "@/lib/server/action-context"

/*
 * Billed Compass pay request → Sage AR invoice. Approving a pay request for
 * billing queues it (Settings > Workflows > Sage AR invoices); office staff
 * can Send or Retry from the pay request. Guards stop it as "Needs attention"
 * instead of sending something that doesn't tie. Sage stays the back end:
 * Compass builds and sends the bill to the owner, Sage gets the invoice.
 */

const cents = (dollars: number): number => toCents(dollars) ?? 0

export type ArInvoiceSource = {
  readonly application: {
    readonly id: string
    readonly applicationNumber: string
    readonly status: string
    readonly billingSource: string
    readonly sageInvoiceNumber: string | null
  }
  readonly sageJobNumber: string | null
  readonly sageJobId: string | null
  readonly plan: ArInvoicePlan
  /** Why this pay request doesn't go to Sage as an invoice (built in Sage, Sage-created company). */
  readonly notApplicable: string | null
  readonly invoiceType: number
  readonly invoiceStatus: number
}

/** The pay request's AR invoice as Compass would send it now. */
export async function loadArInvoiceSource(
  db: Db,
  input: { readonly organizationId: string; readonly projectId: string; readonly applicationId: string }
): Promise<ArInvoiceSource | null> {
  const [project, application] = await Promise.all([
    db
      .select({
        projectNumber: projects.projectNumber,
        department: projects.department,
        sageJobNumber: projects.sageJobNumber,
        sageJobId: projects.sageJobId,
      })
      .from(projects)
      .where(and(eq(projects.id, input.projectId), eq(projects.organizationId, input.organizationId)))
      .get(),
    db
      .select()
      .from(projectBudgetApplications)
      .where(
        and(
          eq(projectBudgetApplications.id, input.applicationId),
          eq(projectBudgetApplications.projectId, input.projectId),
          eq(projectBudgetApplications.sourceSystem, COMPASS_DRAW_SOURCE)
        )
      )
      .get(),
  ])
  if (!project || !application) return null
  const [lines, adjustments, contractTax, catalog, settings, exportSettings] = await Promise.all([
    db
      .select()
      .from(projectBudgetLines)
      .where(and(eq(projectBudgetLines.projectId, input.projectId), eq(projectBudgetLines.applicationId, application.id)))
      .orderBy(asc(projectBudgetLines.csiDivision), asc(projectBudgetLines.sortOrder)),
    loadChangeOrderParts(db, input.projectId, application.budgetRevisionId),
    loadContractTax(db, application.budgetRevisionId),
    loadProjectCostCodeCatalog(db),
    readFeatureSettings(db, input.organizationId, "sage-ar-invoices"),
    readFeatureSettings(db, input.organizationId, "sage-export"),
  ])
  const changeOrderTax = await loadChangeOrderTax(db, [...new Set(adjustments.map((row) => row.changeOrderId))])
  const taxDistrict = await loadTaxDistrict(db, [...contractTax.taxEntityIds, ...changeOrderTax.taxEntityIds], contractTax.acceptedEstimateId)
  const index = indexSageCatalog(catalog)
  const sageJobNumber = project.sageJobNumber?.trim() || null
  const sequence = applicationSequence(application.applicationNumber)
  const invoiceDate = settings.invoiceDate === "billed_date" ? (application.billedAt?.slice(0, 10) ?? null) : (application.periodTo?.slice(0, 10) ?? null)
  // Retention held this period: held to date less what the previous draws held
  // (their completed-and-stored less the certificates already issued).
  const previousCompleted = lines.reduce((sum, line) => sum + cents(line.previousWorkCompleted), 0)
  const retentionCents = cents(application.retainageHeld) - (previousCompleted - cents(application.previousCertificates))
  const plan = planSageArInvoice({
    invoiceNumber: application.sageInvoiceNumber
      ? { value: application.sageInvoiceNumber, error: null }
      : formatSageInvoiceNumber(exportSettings.payRequestInvoiceFormat, { projectNumber: project.projectNumber, sageJobNumber, number: sequence }),
    invoiceDate,
    dueDays: settings.dueDays,
    description: arInvoiceDescription(settings.descriptionFormat, { date: invoiceDate, sequence, projectNumber: project.projectNumber }),
    changeOrderLineFormat: settings.changeOrderLineFormat,
    lines: lines.map((line) => ({
      costCode: line.costCode,
      description: line.description,
      scheduledCents: cents(line.originalEstimate),
      thisPeriodCents: cents(line.currentWorkCompleted) + cents(line.storedMaterials),
    })),
    changeOrders: adjustments,
    contractTax: contractTax.profiles,
    changeOrderTax: changeOrderTax.byChangeOrder,
    taxDistrict,
    retentionCents,
    depositAppliedCents: cents(application.depositApplied),
    currentPaymentDueCents: cents(application.currentPaymentDue),
    incomeAccount: incomeAccountFor(settings, project.department),
    depositAccount: settings.depositAccount,
    sageJobNumber,
    mapCostCode: (costCode) => mapToSageCostCode(costCode, index),
  })
  const notApplicable =
    application.billingSource === "sage"
      ? "This pay request was built in Sage, so Sage already has its billing."
      : exportSettings.payRequestsCreatedIn === "sage"
        ? "Pay requests are created in Sage for this company (Settings > Workflows > Sage export)."
        : null
  return {
    application: {
      id: application.id,
      applicationNumber: application.applicationNumber,
      status: application.status,
      billingSource: application.billingSource,
      sageInvoiceNumber: application.sageInvoiceNumber,
    },
    sageJobNumber,
    sageJobId: project.sageJobId?.trim() || null,
    plan,
    notApplicable,
    invoiceType: settings.invoiceType,
    invoiceStatus: settings.invoiceStatus,
  }
}

export type QueueArInvoiceResult =
  | { readonly status: "off" | "skipped"; readonly reason: string }
  | { readonly status: Extract<SageArInvoiceExportStatus, "queued" | "needs_attention">; readonly reason: string | null }

/**
 * Queues a billed pay request's AR invoice for Sage, or flags what needs
 * attention. Never throws: approving for billing must not fail because of Sage.
 */
export async function queueArInvoiceSageExport(input: {
  readonly db: Db
  readonly organizationId: string
  readonly projectId: string
  readonly applicationId: string
  readonly actor: ActivityActor | null
  readonly automatic: boolean
}): Promise<QueueArInvoiceResult> {
  try {
    const { env } = await getCloudflareContext()
    if (!sageArInvoiceWritesEnabled(env)) return { status: "off", reason: "Sending pay requests to Sage isn't turned on for this company yet." }
    const { db, organizationId } = input
    if (input.automatic) {
      const settings = await readFeatureSettings(db, organizationId, "sage-ar-invoices")
      if (!settings.sendBilledPayRequests) return { status: "off", reason: "Sending billed pay requests to Sage is off in Settings." }
    }
    const source = await loadArInvoiceSource(db, { organizationId, projectId: input.projectId, applicationId: input.applicationId })
    if (!source) return { status: "skipped", reason: "Pay request not found." }
    if (source.notApplicable) return { status: "skipped", reason: source.notApplicable }
    if (source.application.status !== "billed") return { status: "skipped", reason: "Approve the pay request for billing first." }
    const blocker = source.plan.blockers.length > 0 ? source.plan.blockers.join(" ") : null
    const status = blocker ? "needs_attention" : "queued"
    const now = new Date().toISOString()
    const written = await upsertSageArInvoiceExport(db, {
      organizationId,
      projectId: input.projectId,
      applicationId: input.applicationId,
      status,
      invoiceNumber: source.plan.invoiceNumber || "(none)",
      requestedByUserId: input.actor?.id ?? null,
      automatic: input.automatic,
      errorMessage: blocker,
      now,
    })
    if (!written) return { status: "skipped", reason: "This pay request is already on its way to Sage or in Sage." }
    if (input.actor) {
      const label = `Pay application ${source.application.applicationNumber}`
      await recordActivityEvent({
        db,
        organizationId,
        projectId: input.projectId,
        actor: input.actor,
        category: "financial",
        action: status === "needs_attention" ? "pay_application_sage_invoice_needs_attention" : "pay_application_sage_invoice_queued",
        entityType: "project_budget_application",
        entityId: input.applicationId,
        summary:
          status === "needs_attention"
            ? `${label}: Sage AR invoice needs attention. ${blocker ?? ""}`.trim()
            : `${label}: ${input.automatic ? "queued for Sage automatically" : "sent to Sage"} as AR invoice ${source.plan.invoiceNumber} (${source.plan.lines.length} lines, ${formatCents(source.plan.netDueCents)} due).`,
        metadata: { status, automatic: input.automatic, invoiceNumber: source.plan.invoiceNumber, netDueCents: source.plan.netDueCents },
        createdAt: now,
      })
    }
    return { status, reason: blocker }
  } catch (error) {
    console.error("Pay request Sage AR invoice could not be queued", error)
    return { status: "skipped", reason: "The Sage invoice couldn't be queued; use Send to Sage on the pay request." }
  }
}

export type ArInvoiceWriterRequest =
  | { readonly kind: "ready"; readonly payload: SageArInvoiceWritePayload; readonly invoiceNumber: string }
  | { readonly kind: "needs_attention"; readonly reason: string }

/** Builds the writer request for a claimed export from the pay request as it is now. */
export async function buildArInvoiceWriterRequest(
  db: Db,
  row: { readonly organizationId: string; readonly projectId: string; readonly applicationId: string; readonly invoiceNumber: string }
): Promise<ArInvoiceWriterRequest> {
  const source = await loadArInvoiceSource(db, row)
  if (!source) return { kind: "needs_attention", reason: "The pay request wasn't found." }
  if (source.notApplicable) return { kind: "needs_attention", reason: source.notApplicable }
  if (source.application.status !== "billed") return { kind: "needs_attention", reason: "The pay request is no longer billed." }
  if (source.plan.blockers.length > 0) return { kind: "needs_attention", reason: source.plan.blockers.join(" ") }
  if (source.plan.invoiceNumber !== row.invoiceNumber) {
    return { kind: "needs_attention", reason: `The invoice number changed from ${row.invoiceNumber} to ${source.plan.invoiceNumber}; send it again.` }
  }
  if (!source.sageJobNumber) return { kind: "needs_attention", reason: "The project isn't linked to a Sage job." }
  const payload = sageArInvoiceWritePayload(source.plan, {
    projectId: row.projectId,
    applicationId: row.applicationId,
    applicationNumber: source.application.applicationNumber,
    sageJobNumber: source.sageJobNumber,
    sageJobId: source.sageJobId,
    invoiceType: source.invoiceType,
    invoiceStatus: source.invoiceStatus,
  })
  return payload ? { kind: "ready", payload, invoiceNumber: source.plan.invoiceNumber } : { kind: "needs_attention", reason: "The invoice's Sage details aren't complete." }
}

export type ArInvoiceExportView = {
  readonly status: SageArInvoiceExportStatus
  readonly invoiceNumber: string
  readonly errorMessage: string | null
  readonly requestedAt: string
  readonly completedAt: string | null
  readonly automatic: boolean
  readonly sageRecordId: string | null
  readonly sageTotalCents: number | null
}

/** The pay request's current export row, for the pay request page. */
export async function loadArInvoiceExport(db: Db, projectId: string, applicationId: string): Promise<ArInvoiceExportView | undefined> {
  return db
    .select({
      status: sageArInvoiceExports.status,
      invoiceNumber: sageArInvoiceExports.invoiceNumber,
      errorMessage: sageArInvoiceExports.errorMessage,
      requestedAt: sageArInvoiceExports.requestedAt,
      completedAt: sageArInvoiceExports.completedAt,
      automatic: sageArInvoiceExports.automatic,
      sageRecordId: sageArInvoiceExports.sageRecordId,
      sageTotalCents: sageArInvoiceExports.sageTotalCents,
    })
    .from(sageArInvoiceExports)
    .where(and(eq(sageArInvoiceExports.projectId, projectId), eq(sageArInvoiceExports.applicationId, applicationId)))
    .orderBy(desc(sageArInvoiceExports.requestedAt))
    .get()
}
