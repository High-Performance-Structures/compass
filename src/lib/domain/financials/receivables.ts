import { and, asc, desc, eq, isNull, notInArray, or, sql, type SQL } from "drizzle-orm"

import { customers, projectBudgetApplications, projects, users } from "@/db/schema"
import {
  invoicePaymentAllocations,
  invoices,
  payApplicationPaymentAllocations,
  payApplicationPrepaidMarks,
  payments,
} from "@/db/schema-netsuite"
import {
  BUDGET_PROJECTION_SOURCE,
  COMPASS_DRAW_SOURCE,
  IMPORTED_DRAW_UNBILLED_STATUSES,
  drawPaymentTarget,
  drawSettled,
  importedDrawSourceLabel,
  invoiceAcceptsPayments,
  isImportedDraw,
  receivableOpenCents,
  receivablePaidState,
  receivableStaffStatus,
  sharedSageInvoiceLinks,
  storedDollarsToCents,
  type PrepaidMark,
  type ReceivableItem,
  type ReceivableStaffStatus,
} from "@/lib/domain/financials/rules"
import type { ReceivableItemKind, ReceivablePaidState } from "@/lib/domain/financials/statuses"
import type { Db } from "@/lib/server/action-context"

/*
 * Reads for received payments applied to pay applications and invoices. All
 * reads are scoped to one organization and project in SQL. Balances are
 * computed here (with rules.ts) from stored values, never sent by the browser.
 */

export type ReceivableRow = ReceivableItem & {
  readonly number: string
  readonly date: string | null
  readonly openCents: number
  readonly paidState: ReceivablePaidState
  /** Accounting reference: the Sage invoice number, when entered. */
  readonly sageInvoiceNumber: string | null
  readonly customerId: string | null
  /** Why this item can't take a payment (an imported draw with no usable billed amount), or null. */
  readonly paymentBlocker: string | null
  /** "Imported from Sage" or "Imported from Drive" for a historical draw; null otherwise. */
  readonly sourceLabel: string | null
  /** Whether this is an imported (Sage or Drive) draw. */
  readonly imported: boolean
  /** The active "Paid before Compass" mark on an imported draw, or null. */
  readonly prepaid: PrepaidMark | null
  /** What staff see: the paid state, "prepaid", or "unconfirmed" for an unsettled imported draw. */
  readonly staffStatus: ReceivableStaffStatus
  /** A billed item of the other kind with the same Sage invoice number (may be the same billing), or null. */
  readonly sharedSageInvoiceWith: string | null
}

export type ProjectReceivableScope = {
  readonly organizationId: string
  readonly projectId: string
}

export type ProjectClient = {
  readonly projectId: string
  readonly projectName: string
  readonly clientCustomerId: string | null
  readonly clientName: string | null
}

/** The project in the organization, with its directory client. */
export async function readProjectClient(db: Db, scope: ProjectReceivableScope): Promise<ProjectClient | null> {
  const row = await db
    .select({
      projectId: projects.id,
      projectName: projects.name,
      clientCustomerId: projects.clientCustomerId,
      clientName: sql<string | null>`COALESCE(${customers.name}, ${projects.clientName})`,
    })
    .from(projects)
    .leftJoin(customers, eq(customers.id, projects.clientCustomerId))
    .where(and(eq(projects.id, scope.projectId), eq(projects.organizationId, scope.organizationId)))
    .get()
  return row ?? null
}

function row(
  base: Omit<ReceivableRow, "openCents" | "paidState" | "staffStatus" | "sharedSageInvoiceWith">,
): ReceivableRow {
  // A draw marked paid before Compass is paid; it and an item that can't take
  // payments have nothing open to apply a payment to.
  const paidState = base.prepaid ? "paid" : receivablePaidState(base.billedCents, base.paidCents)
  return {
    ...base,
    openCents: base.paymentBlocker === null && base.prepaid === null ? receivableOpenCents(base) : 0,
    paidState,
    staffStatus: receivableStaffStatus({ ...base, paidState }),
    sharedSageInvoiceWith: null,
  }
}

/** Active "Paid before Compass" marks on the project's draws, by draw id. */
async function readActivePrepaidMarks(db: Db, scope: ProjectReceivableScope): Promise<ReadonlyMap<string, PrepaidMark>> {
  const marks = await db
    .select({
      applicationId: payApplicationPrepaidMarks.applicationId,
      markedAt: payApplicationPrepaidMarks.markedAt,
      markedByName: users.displayName,
      note: payApplicationPrepaidMarks.note,
    })
    .from(payApplicationPrepaidMarks)
    .leftJoin(users, eq(users.id, payApplicationPrepaidMarks.markedBy))
    .where(and(
      eq(payApplicationPrepaidMarks.organizationId, scope.organizationId),
      eq(payApplicationPrepaidMarks.projectId, scope.projectId),
      isNull(payApplicationPrepaidMarks.releasedAt),
    ))
  return new Map(marks.map(({ applicationId, ...mark }) => [applicationId, mark]))
}

/**
 * Draws that are billed items, in SQL: Compass draws approved for billing,
 * and imported (Sage or Drive) draws that are not drafts, budget views or
 * void. rules.ts `drawPaymentTarget` makes the final call on each row.
 */
function billedDrawCondition(): SQL | undefined {
  return or(
    and(
      eq(projectBudgetApplications.sourceSystem, COMPASS_DRAW_SOURCE),
      eq(projectBudgetApplications.status, "billed"),
    ),
    and(
      notInArray(projectBudgetApplications.sourceSystem, [COMPASS_DRAW_SOURCE, BUDGET_PROJECTION_SOURCE]),
      notInArray(projectBudgetApplications.status, [...IMPORTED_DRAW_UNBILLED_STATUSES]),
    ),
  )
}

/**
 * Billed pay applications (Compass draws approved for billing and imported
 * Sage/Drive draws) and payable invoices on the project, with billed, paid
 * and open cents. An imported draw without a usable billed amount is listed
 * with `paymentBlocker` set. Pay applications are billed to the project's
 * client; invoices are filtered to `customerId` when it is given.
 */
export async function readProjectReceivables(
  db: Db,
  scope: ProjectReceivableScope,
  options: { readonly customerId?: string | null } = {},
): Promise<ReceivableRow[]> {
  const [applications, invoiceRows, prepaidMarks] = await Promise.all([
    db
      .select({
        id: projectBudgetApplications.id,
        applicationNumber: projectBudgetApplications.applicationNumber,
        sourceSystem: projectBudgetApplications.sourceSystem,
        status: projectBudgetApplications.status,
        periodTo: projectBudgetApplications.periodTo,
        billedAt: projectBudgetApplications.billedAt,
        currentPaymentDue: projectBudgetApplications.currentPaymentDue,
        sageInvoiceNumber: projectBudgetApplications.sageInvoiceNumber,
        paidCents: sql<number>`COALESCE((
          SELECT SUM(${payApplicationPaymentAllocations.allocationCents})
          FROM ${payApplicationPaymentAllocations}
          WHERE ${payApplicationPaymentAllocations.applicationId} = ${projectBudgetApplications.id}
            AND ${payApplicationPaymentAllocations.releasedAt} IS NULL
        ), 0)`,
        clientCustomerId: projects.clientCustomerId,
      })
      .from(projectBudgetApplications)
      .innerJoin(projects, eq(projects.id, projectBudgetApplications.projectId))
      .where(and(
        eq(projectBudgetApplications.projectId, scope.projectId),
        eq(projects.organizationId, scope.organizationId),
        billedDrawCondition(),
      ))
      .orderBy(asc(projectBudgetApplications.periodTo), asc(projectBudgetApplications.createdAt)),
    db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        status: invoices.status,
        issueDate: invoices.issueDate,
        total: invoices.total,
        amountPaid: invoices.amountPaid,
        billingScope: invoices.billingScope,
        customerId: invoices.customerId,
        sourceSystem: invoices.sourceSystem,
      })
      .from(invoices)
      .where(and(
        eq(invoices.organizationId, scope.organizationId),
        eq(invoices.projectId, scope.projectId),
        options.customerId ? eq(invoices.customerId, options.customerId) : undefined,
      ))
      .orderBy(asc(invoices.issueDate)),
    readActivePrepaidMarks(db, scope),
  ])
  const rows: ReceivableRow[] = []
  for (const application of applications) {
    const target = drawPaymentTarget(application)
    if (!target.listed) continue
    rows.push(row({
      kind: "pay_application",
      id: application.id,
      label: `Pay application ${application.applicationNumber}`,
      number: application.applicationNumber,
      date: application.billedAt ? application.billedAt.slice(0, 10) : application.periodTo,
      billedCents: target.billedCents,
      paidCents: Number(application.paidCents) || 0,
      billingScope: "construction",
      sourceSystem: application.sourceSystem,
      sageInvoiceNumber: application.sageInvoiceNumber,
      customerId: application.clientCustomerId,
      paymentBlocker: target.blocker,
      sourceLabel: importedDrawSourceLabel(application.sourceSystem),
      imported: isImportedDraw(application),
      prepaid: isImportedDraw(application) ? (prepaidMarks.get(application.id) ?? null) : null,
    }))
  }
  for (const invoice of invoiceRows) {
    if (!invoiceAcceptsPayments(invoice.status)) continue
    const number = invoice.invoiceNumber?.trim() || invoice.id.slice(0, 8)
    rows.push(row({
      kind: "invoice",
      id: invoice.id,
      label: `Invoice ${number}`,
      number,
      date: invoice.issueDate,
      billedCents: storedDollarsToCents(invoice.total),
      paidCents: storedDollarsToCents(invoice.amountPaid),
      billingScope: invoice.billingScope,
      sourceSystem: invoice.sourceSystem,
      sageInvoiceNumber: invoice.sourceSystem === "sage" ? invoice.invoiceNumber : null,
      customerId: invoice.customerId,
      paymentBlocker: null,
      sourceLabel: null,
      imported: false,
      prepaid: null,
    }))
  }
  const shared = sharedSageInvoiceLinks(rows)
  return rows.map((item) => ({ ...item, sharedSageInvoiceWith: shared.get(`${item.kind}:${item.id}`) ?? null }))
}

type PaymentAllocationView = {
  readonly id: string
  readonly kind: ReceivableItemKind
  readonly itemId: string
  readonly itemLabel: string
  readonly cents: number
  readonly released: boolean
}

export type ReceivedPaymentView = {
  readonly id: string
  readonly paymentDate: string
  readonly amountCents: number
  readonly appliedCents: number
  readonly unappliedCents: number
  readonly paymentMethod: string | null
  readonly referenceNumber: string | null
  readonly memo: string | null
  readonly sourceSystem: string
  readonly customerId: string | null
  readonly billingScope: string
  readonly voidedAt: string | null
  readonly voidReason: string | null
  readonly voidedByName: string | null
  readonly allocations: readonly PaymentAllocationView[]
}

/** Received payments on the project, newest first, with every allocation (released ones too). */
export async function readProjectReceivedPayments(db: Db, scope: ProjectReceivableScope): Promise<ReceivedPaymentView[]> {
  const paymentRows = await db
    .select({
      id: payments.id,
      paymentDate: payments.paymentDate,
      amount: payments.amount,
      paymentMethod: payments.paymentMethod,
      referenceNumber: payments.referenceNumber,
      memo: payments.memo,
      sourceSystem: payments.sourceSystem,
      customerId: payments.customerId,
      billingScope: payments.billingScope,
      voidedAt: payments.voidedAt,
      voidReason: payments.voidReason,
      voidedByName: users.displayName,
    })
    .from(payments)
    .leftJoin(users, eq(users.id, payments.voidedBy))
    .where(and(
      eq(payments.organizationId, scope.organizationId),
      eq(payments.projectId, scope.projectId),
      eq(payments.paymentType, "received"),
      isNull(payments.vendorId),
    ))
    .orderBy(desc(payments.paymentDate), desc(payments.createdAt))
  const ids = paymentRows.map((payment) => payment.id)
  const allocations = await readAllocations(db, scope, ids)
  return paymentRows.map((payment) => {
    const own = allocations.filter((allocation) => allocation.paymentId === payment.id)
    const amountCents = storedDollarsToCents(payment.amount)
    const appliedCents = own.reduce((sum, allocation) => sum + (allocation.released ? 0 : allocation.cents), 0)
    return {
      ...payment,
      amountCents,
      appliedCents,
      unappliedCents: payment.voidedAt ? 0 : Math.max(amountCents - appliedCents, 0),
      allocations: own,
    }
  })
}

async function readAllocations(
  db: Db,
  scope: ProjectReceivableScope,
  paymentIds: readonly string[],
): Promise<(PaymentAllocationView & { readonly paymentId: string })[]> {
  if (paymentIds.length === 0) return []
  // Allocations are read by project scope, then matched to the payments in memory.
  const [applicationRows, invoiceRows] = await Promise.all([
    db
      .select({
        id: payApplicationPaymentAllocations.id,
        paymentId: payApplicationPaymentAllocations.paymentId,
        itemId: payApplicationPaymentAllocations.applicationId,
        number: projectBudgetApplications.applicationNumber,
        cents: payApplicationPaymentAllocations.allocationCents,
        releasedAt: payApplicationPaymentAllocations.releasedAt,
      })
      .from(payApplicationPaymentAllocations)
      .innerJoin(projectBudgetApplications, eq(projectBudgetApplications.id, payApplicationPaymentAllocations.applicationId))
      .where(and(
        eq(payApplicationPaymentAllocations.organizationId, scope.organizationId),
        eq(payApplicationPaymentAllocations.projectId, scope.projectId),
      )),
    db
      .select({
        id: invoicePaymentAllocations.id,
        paymentId: invoicePaymentAllocations.paymentId,
        itemId: invoicePaymentAllocations.invoiceId,
        number: invoices.invoiceNumber,
        cents: invoicePaymentAllocations.allocationCents,
        releasedAt: invoicePaymentAllocations.releasedAt,
      })
      .from(invoicePaymentAllocations)
      .innerJoin(invoices, eq(invoices.id, invoicePaymentAllocations.invoiceId))
      .where(and(
        eq(invoicePaymentAllocations.organizationId, scope.organizationId),
        eq(invoicePaymentAllocations.projectId, scope.projectId),
      )),
  ])
  const wanted = new Set(paymentIds)
  return [
    ...applicationRows.map((allocation) => ({
      id: allocation.id,
      paymentId: allocation.paymentId,
      kind: "pay_application" as const,
      itemId: allocation.itemId,
      itemLabel: `Pay application ${allocation.number}`,
      cents: allocation.cents,
      released: allocation.releasedAt !== null,
    })),
    ...invoiceRows.map((allocation) => ({
      id: allocation.id,
      paymentId: allocation.paymentId,
      kind: "invoice" as const,
      itemId: allocation.itemId,
      itemLabel: `Invoice ${allocation.number?.trim() || allocation.itemId.slice(0, 8)}`,
      cents: allocation.cents,
      released: allocation.releasedAt !== null,
    })),
  ].filter((allocation) => wanted.has(allocation.paymentId))
}

/** One received payment in the organization, with its project. */
export async function readReceivedPayment(
  db: Db,
  organizationId: string,
  paymentId: string,
): Promise<{
  readonly id: string
  readonly projectId: string
  readonly customerId: string | null
  readonly amountCents: number
  readonly sourceSystem: string
  readonly voidedAt: string | null
  readonly billingScope: string
} | null> {
  const payment = await db
    .select({
      id: payments.id,
      projectId: payments.projectId,
      customerId: payments.customerId,
      amount: payments.amount,
      sourceSystem: payments.sourceSystem,
      voidedAt: payments.voidedAt,
      billingScope: payments.billingScope,
      paymentType: payments.paymentType,
    })
    .from(payments)
    .where(and(eq(payments.id, paymentId), eq(payments.organizationId, organizationId)))
    .get()
  if (!payment || payment.projectId === null || payment.paymentType !== "received") return null
  return {
    id: payment.id,
    projectId: payment.projectId,
    customerId: payment.customerId,
    amountCents: storedDollarsToCents(payment.amount),
    sourceSystem: payment.sourceSystem,
    voidedAt: payment.voidedAt,
    billingScope: payment.billingScope,
  }
}

/** Unreleased allocations of a payment, with the invoice values a void must restore. */
export async function readActivePaymentAllocations(db: Db, scope: ProjectReceivableScope, paymentId: string): Promise<{
  readonly payApplications: readonly { readonly id: string; readonly applicationId: string; readonly cents: number }[]
  readonly invoices: readonly {
    readonly id: string
    readonly invoiceId: string
    readonly cents: number
    readonly total: number
    readonly amountPaid: number
    readonly sourceSystem: string
  }[]
}> {
  const [applicationRows, invoiceRows] = await Promise.all([
    db
      .select({
        id: payApplicationPaymentAllocations.id,
        applicationId: payApplicationPaymentAllocations.applicationId,
        cents: payApplicationPaymentAllocations.allocationCents,
      })
      .from(payApplicationPaymentAllocations)
      .where(and(
        eq(payApplicationPaymentAllocations.organizationId, scope.organizationId),
        eq(payApplicationPaymentAllocations.projectId, scope.projectId),
        eq(payApplicationPaymentAllocations.paymentId, paymentId),
        isNull(payApplicationPaymentAllocations.releasedAt),
      )),
    db
      .select({
        id: invoicePaymentAllocations.id,
        invoiceId: invoicePaymentAllocations.invoiceId,
        cents: invoicePaymentAllocations.allocationCents,
        total: invoices.total,
        amountPaid: invoices.amountPaid,
        sourceSystem: invoices.sourceSystem,
      })
      .from(invoicePaymentAllocations)
      .innerJoin(invoices, eq(invoices.id, invoicePaymentAllocations.invoiceId))
      .where(and(
        eq(invoicePaymentAllocations.organizationId, scope.organizationId),
        eq(invoicePaymentAllocations.projectId, scope.projectId),
        eq(invoicePaymentAllocations.paymentId, paymentId),
        isNull(invoicePaymentAllocations.releasedAt),
      )),
  ])
  return { payApplications: applicationRows, invoices: invoiceRows }
}

/** Whether a payment has ever been applied (released rows count: they are history). */
export async function paymentHasAllocations(db: Db, paymentId: string): Promise<boolean> {
  const [application, invoice] = await Promise.all([
    db.select({ id: payApplicationPaymentAllocations.id }).from(payApplicationPaymentAllocations)
      .where(eq(payApplicationPaymentAllocations.paymentId, paymentId)).limit(1).get(),
    db.select({ id: invoicePaymentAllocations.id }).from(invoicePaymentAllocations)
      .where(eq(invoicePaymentAllocations.paymentId, paymentId)).limit(1).get(),
  ])
  return Boolean(application ?? invoice)
}

/**
 * Paid and open cents of the project's payable pay applications that the
 * owner can see. An imported draw is included only once staff have settled
 * it (a Compass payment applied, or marked paid before Compass); until then
 * the owner sees it with no balance, as before.
 */
export async function readOwnerPayApplicationBalances(db: Db, projectId: string): Promise<{
  readonly applicationId: string
  readonly paidCents: number
  readonly openCents: number
  readonly paidState: ReceivablePaidState
}[]> {
  const rows = await db
    .select({
      applicationId: projectBudgetApplications.id,
      sourceSystem: projectBudgetApplications.sourceSystem,
      status: projectBudgetApplications.status,
      currentPaymentDue: projectBudgetApplications.currentPaymentDue,
      paidCents: sql<number>`COALESCE(SUM(${payApplicationPaymentAllocations.allocationCents}), 0)`,
      prepaid: sql<number>`EXISTS (
        SELECT 1 FROM ${payApplicationPrepaidMarks}
        WHERE ${payApplicationPrepaidMarks.applicationId} = ${projectBudgetApplications.id}
          AND ${payApplicationPrepaidMarks.releasedAt} IS NULL
      )`,
    })
    .from(projectBudgetApplications)
    .leftJoin(payApplicationPaymentAllocations, and(
      eq(payApplicationPaymentAllocations.applicationId, projectBudgetApplications.id),
      isNull(payApplicationPaymentAllocations.releasedAt),
    ))
    .where(and(
      eq(projectBudgetApplications.projectId, projectId),
      eq(projectBudgetApplications.ownerVisible, true),
      billedDrawCondition(),
    ))
    .groupBy(projectBudgetApplications.id)
  return rows.flatMap((entry) => {
    const target = drawPaymentTarget(entry)
    if (!target.listed) return []
    const imported = isImportedDraw(entry)
    const paidCents = Number(entry.paidCents) || 0
    const prepaid = imported && Boolean(Number(entry.prepaid))
    if (!drawSettled({ imported, paidCents, prepaid })) return []
    // Marked paid before Compass: paid, with no payment amounts to show.
    if (prepaid) return [{ applicationId: entry.applicationId, paidCents: 0, openCents: 0, paidState: "paid" as const }]
    if (target.blocker !== null) return []
    const billedCents = target.billedCents
    return [{
      applicationId: entry.applicationId,
      paidCents,
      openCents: receivableOpenCents({ billedCents, paidCents }),
      paidState: receivablePaidState(billedCents, paidCents),
    }]
  })
}

/** Whether payments are still applied to a pay application (voided ones are released). */
export async function payApplicationHasActivePayments(db: Db, applicationId: string): Promise<boolean> {
  const row = await db
    .select({ id: payApplicationPaymentAllocations.id })
    .from(payApplicationPaymentAllocations)
    .where(and(eq(payApplicationPaymentAllocations.applicationId, applicationId), isNull(payApplicationPaymentAllocations.releasedAt)))
    .limit(1)
    .get()
  return Boolean(row)
}
