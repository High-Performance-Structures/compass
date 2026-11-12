import "server-only"

import { and, asc, desc, eq } from "drizzle-orm"

import { projectBudgetApplications, projectBudgetLines, projects } from "@/db/schema"
import { companiesView, membershipsView, peopleView } from "@/lib/domain/identity/views"
import { payApplicationSageChecks } from "@/db/schema-sage"
import { recordActivityEvent, type ActivityActor } from "@/lib/activity-log"
import {
  checkSageBilling,
  planEnterInSage,
  sageBillingCheckFingerprint,
  sageBillingCheckSummary,
  type BillingLineInput,
  type EnterInSageChecklist,
  type PostedSageInvoice,
  type SageBillingCheck,
} from "@/lib/domain/budget/sage-billing-check-rules"
import { insertPayApplicationSageCheck } from "@/lib/domain/budget/store"
import { COMPASS_DRAW_SOURCE } from "@/lib/domain/financials/rules"
import { arInvoiceDescription } from "@/lib/domain/sage-bridge/ar-invoice-rules"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { applicationSequence } from "@/lib/financials/sage-export-preview"
import { formatSageInvoiceNumber } from "@/lib/financials/sage-invoice-number"
import { latestSnapshotForPayApplication, mappedSnapshotLines, type SageSnapshotRecord } from "@/lib/financials/sage-pay-request-sync"
import { loadUnbilledShopTickets } from "@/lib/financials/sage-pay-request-tickets"
import { toCents } from "@/lib/format"
import { createSystemNotificationEvent } from "@/lib/notifications/create-event"
import { getPermissions } from "@/lib/permissions"
import type { SageArInvoiceRead } from "@/lib/sage/pay-application-snapshot"
import { loadChangeOrderParts, loadChangeOrderTax, loadContractTax, loadTaxDistrict } from "@/lib/sage/contract-tax-server"
import type { Db } from "@/lib/server/action-context"
import { isInternalStaffRole } from "@/lib/user-roles"

const memberships = membershipsView()
const companies = companiesView()
const accounts = peopleView()

/*
 * Pay requests built in Sage: the "Enter in Sage" checklist for each pay
 * request and the Sage check of the AR invoice Sage creates on posting.
 * Reads Compass and the stored Sage snapshots; never writes to Sage. Each
 * sync records a changed check in Activity and tells office finance staff
 * when a posted invoice needs attention.
 */

const cents = (dollars: number): number => toCents(dollars) ?? 0

export type SageBillingCheckView = {
  readonly applicationNumber: string
  readonly checklist: EnterInSageChecklist
  readonly check: SageBillingCheck
  /** Sage's progress billing as last synced; null before the first sync. */
  readonly sage: {
    readonly status: string
    readonly capturedAt: string
    /** Sage's own tax district on the billing, when the bridge sends it. */
    readonly billingTaxDistrict: string | null
    readonly invoice: SageArInvoiceRead | null
  } | null
  readonly unbilledShopTickets: readonly { readonly ticketNumber: string; readonly ticketDate: string; readonly totalCents: number }[]
  readonly snapshotId: string | null
}

function postedInvoice(snapshot: SageSnapshotRecord): PostedSageInvoice | null | undefined {
  const invoice = snapshot.header.invoice
  if (invoice === undefined || invoice === null) return invoice
  return {
    invoiceNumber: invoice.invoiceNumber,
    taxDistrictCode: invoice.taxDistrict?.code ?? null,
    taxDistrictName: invoice.taxDistrict?.name ?? null,
    salesTaxCents: cents(invoice.salesTax),
    retentionCents: cents(invoice.retention),
    totalCents: cents(invoice.total),
  }
}

/** Sage's Taxable flag for each Compass line, by the Sage line it came from (else the only Sage line on its cost code). */
async function sageFlags(
  db: Db,
  projectId: string,
  snapshot: SageSnapshotRecord | null
): Promise<{ readonly bySourceLine: ReadonlyMap<string, boolean>; readonly byCostCode: ReadonlyMap<string, boolean> }> {
  const bySourceLine = new Map<string, boolean>()
  const byCostCode = new Map<string, boolean>()
  if (!snapshot) return { bySourceLine, byCostCode }
  const { lines } = await mappedSnapshotLines(db, projectId, snapshot)
  const counts = new Map<string, number>()
  for (const line of lines) counts.set(line.compassCostCode, (counts.get(line.compassCostCode) ?? 0) + 1)
  for (const line of lines) {
    if (line.taxable === undefined) continue
    bySourceLine.set(line.sourceLineId, line.taxable)
    if (counts.get(line.compassCostCode) === 1) byCostCode.set(line.compassCostCode, line.taxable)
  }
  return { bySourceLine, byCostCode }
}

/** The checklist and Sage check for one pay request, or null when it isn't an owner pay request of the project. */
export async function loadSageBillingCheck(
  db: Db,
  input: { readonly organizationId: string; readonly projectId: string; readonly applicationId: string; readonly snapshot?: SageSnapshotRecord | null }
): Promise<SageBillingCheckView | null> {
  const { projectId } = input
  const [project, application] = await Promise.all([
    db
      .select({ projectNumber: projects.projectNumber, sageJobNumber: projects.sageJobNumber })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.organizationId, input.organizationId)))
      .get(),
    db
      .select()
      .from(projectBudgetApplications)
      .where(
        and(
          eq(projectBudgetApplications.id, input.applicationId),
          eq(projectBudgetApplications.projectId, projectId),
          eq(projectBudgetApplications.sourceSystem, COMPASS_DRAW_SOURCE)
        )
      )
      .get(),
  ])
  if (!project || !application) return null
  const snapshot = input.snapshot !== undefined ? input.snapshot : await latestSnapshotForPayApplication(db, projectId, application.id)
  const [lines, parts, contractTax, settings, exportSettings, flags, tickets] = await Promise.all([
    db
      .select()
      .from(projectBudgetLines)
      .where(and(eq(projectBudgetLines.projectId, projectId), eq(projectBudgetLines.applicationId, application.id)))
      .orderBy(asc(projectBudgetLines.csiDivision), asc(projectBudgetLines.sortOrder)),
    loadChangeOrderParts(db, projectId, application.budgetRevisionId),
    loadContractTax(db, application.budgetRevisionId),
    readFeatureSettings(db, input.organizationId, "sage-pay-request-check"),
    readFeatureSettings(db, input.organizationId, "sage-export"),
    sageFlags(db, projectId, snapshot),
    loadUnbilledShopTickets(db, projectId),
  ])
  const changeOrderTax = await loadChangeOrderTax(db, [...new Set(parts.map((part) => part.changeOrderId))])
  const district = await loadTaxDistrict(db, [...contractTax.taxEntityIds, ...changeOrderTax.taxEntityIds], contractTax.acceptedEstimateId)
  const sequence = applicationSequence(application.applicationNumber)
  const periodTo = application.periodTo?.slice(0, 10) ?? null
  const billingDate = settings.billingDate === "billed_date" ? (application.billedAt?.slice(0, 10) ?? null) : periodTo
  // Retention held this period: held to date less what the previous draws held.
  const previousCompleted = lines.reduce((sum, line) => sum + cents(line.previousWorkCompleted), 0)
  const retentionCents = cents(application.retainageHeld) - (previousCompleted - cents(application.previousCertificates))
  const billingLines: BillingLineInput[] = lines.map((line) => ({
    key: line.id,
    costCode: line.costCode,
    description: line.description,
    thisPeriodCents: cents(line.currentWorkCompleted) + cents(line.storedMaterials),
    sageTaxable: (line.sourceRecordId ? flags.bySourceLine.get(line.sourceRecordId) : undefined) ?? flags.byCostCode.get(line.costCode) ?? null,
  }))
  const checklist = planEnterInSage({
    invoiceNumber: formatSageInvoiceNumber(exportSettings.payRequestInvoiceFormat, {
      projectNumber: project.projectNumber,
      sageJobNumber: project.sageJobNumber?.trim() || null,
      number: sequence,
    }),
    billingDate,
    periodTo,
    description: arInvoiceDescription(settings.descriptionFormat, { date: periodTo, sequence, projectNumber: project.projectNumber }),
    billingCycle: exportSettings.billingCycle,
    lines: billingLines,
    changeOrders: parts,
    contractTax: contractTax.profiles,
    changeOrderTax: changeOrderTax.byChangeOrder,
    taxDistrict: district ? { code: district.sageRecordNumber, name: district.name, rateBasisPoints: district.rateBasisPoints } : null,
    retentionCents,
    amountDueCents: cents(application.currentPaymentDue),
  })
  const check: SageBillingCheck = snapshot
    ? checkSageBilling({ checklist, sageStatus: snapshot.header.status, invoice: postedInvoice(snapshot), taxToleranceCentsPerLine: settings.taxToleranceCentsPerLine })
    : { status: "not_posted", findings: [] }
  const billingDistrict = snapshot?.header.taxDistrict
  return {
    applicationNumber: application.applicationNumber,
    checklist,
    check,
    sage: snapshot
      ? {
          status: snapshot.header.status,
          capturedAt: snapshot.capturedAt,
          billingTaxDistrict: billingDistrict ? (billingDistrict.name ?? billingDistrict.code) : null,
          invoice: snapshot.header.invoice ?? null,
        }
      : null,
    unbilledShopTickets: tickets
      .filter((ticket) => ticket.budgetApplicationId === null || ticket.budgetApplicationId === application.id)
      .map((ticket) => ({ ticketNumber: ticket.ticketNumber, ticketDate: ticket.ticketDate, totalCents: ticket.totalCents })),
    snapshotId: snapshot?.id ?? null,
  }
}

/** Active office staff of the company with finance update access: who hears about a check that needs attention. */
async function officeFinanceStaff(db: Db, organizationId: string): Promise<readonly { readonly userId: string; readonly email: string }[]> {
  const members = await db
    .select({ userId: accounts.id, email: accounts.email, googleEmail: accounts.googleEmail, role: memberships.role })
    .from(memberships)
    .innerJoin(accounts, eq(accounts.id, memberships.userId))
    .innerJoin(companies, eq(companies.id, memberships.organizationId))
    .where(and(eq(memberships.organizationId, organizationId), eq(companies.type, "internal"), eq(accounts.isActive, true)))
  return members
    .filter((member) => isInternalStaffRole(member.role) && getPermissions(member.role, "finance").includes("update"))
    .map((member) => ({ userId: member.userId, email: member.googleEmail?.trim() || member.email }))
}

const SAGE_CHECK_ACTOR: ActivityActor = { id: null, email: "sage-sync", displayName: "Sage sync", firstName: null, lastName: null, role: "system" }

/**
 * After a sync: checks the pay request against Sage's snapshot and, when the
 * result changed since the last recorded check, records it in Activity and
 * notifies office finance staff of a new "Needs attention". Never throws.
 */
export async function recordSageBillingCheck(
  db: Db,
  input: {
    readonly organizationId: string
    readonly projectId: string
    readonly applicationId: string
    readonly snapshot: SageSnapshotRecord
    readonly actor: ActivityActor | null
  }
): Promise<SageBillingCheck | null> {
  try {
    const view = await loadSageBillingCheck(db, input)
    if (!view) return null
    const fingerprint = sageBillingCheckFingerprint(view.check)
    const previous = await db
      .select({ fingerprint: payApplicationSageChecks.fingerprint })
      .from(payApplicationSageChecks)
      .where(eq(payApplicationSageChecks.applicationId, input.applicationId))
      .orderBy(desc(payApplicationSageChecks.createdAt))
      .get()
    if (previous?.fingerprint === fingerprint) return view.check
    const now = new Date().toISOString()
    await insertPayApplicationSageCheck(db, {
      id: crypto.randomUUID(),
      projectId: input.projectId,
      applicationId: input.applicationId,
      snapshotId: input.snapshot.id,
      status: view.check.status,
      fingerprint,
      findingsJson: JSON.stringify(view.check.findings),
      createdAt: now,
    })
    const summary = sageBillingCheckSummary(view.check, view.applicationNumber)
    await recordActivityEvent({
      db,
      organizationId: input.organizationId,
      projectId: input.projectId,
      actor: input.actor ?? SAGE_CHECK_ACTOR,
      category: "financial",
      action: `pay_application_sage_check_${view.check.status}`,
      entityType: "project_budget_application",
      entityId: input.applicationId,
      summary,
      metadata: { status: view.check.status, findings: view.check.findings.map((finding) => finding.key), sageInvoiceNumber: view.sage?.invoice?.invoiceNumber ?? null },
      createdAt: now,
    })
    if (view.check.status === "needs_attention") {
      const settings = await readFeatureSettings(db, input.organizationId, "sage-pay-request-check")
      const recipients = settings.notifyOnNeedsAttention ? await officeFinanceStaff(db, input.organizationId) : []
      if (recipients.length > 0) {
        await createSystemNotificationEvent({
          organizationId: input.organizationId,
          projectId: input.projectId,
          eventType: "pay_application_sage_check",
          sourceType: "project_budget_application",
          sourceId: input.applicationId,
          title: `Sage invoice needs attention: pay application ${view.applicationNumber}`,
          body: view.check.findings.map((finding) => finding.message).join(" "),
          href: `/dashboard/projects/${input.projectId}/financials/pay-applications/${input.applicationId}`,
          priority: "high",
          audience: "internal",
          recipients,
          delivery: { inApp: true, email: true, push: false },
        })
      }
    }
    return view.check
  } catch (error) {
    console.error("The Sage check of the pay request could not be recorded", error)
    return null
  }
}
