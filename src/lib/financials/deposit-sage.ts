import "server-only"

import { and, asc, eq, lt, or } from "drizzle-orm"

import { projectContractDeposits } from "@/db/schema"
import { sageDepositArExports } from "@/db/schema-sage"
import { recordActivityEvent, type ActivityActor } from "@/lib/activity-log"
import { depositNumberFormat, depositRequestSequences } from "@/lib/deposits/deposit-requests"
import type { ArInvoicePlan } from "@/lib/domain/sage-bridge/ar-invoice-rules"
import {
  claimSageDepositArExport,
  updateSageDepositArExportsStatement,
  upsertSageDepositArExport,
} from "@/lib/domain/sage-bridge/ar-invoice-store"
import { planDepositForSage } from "@/lib/domain/sage-bridge/deposit-ar-invoice-rules"
import type { SageArInvoiceExportStatus } from "@/lib/domain/sage-bridge/statuses"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { formatSageInvoiceNumber } from "@/lib/financials/sage-invoice-number"
import { loadSimpleInvoiceProject } from "@/lib/financials/simple-invoices-server"
import { formatCents } from "@/lib/format"
import { sageArInvoiceWritePayload, sageArInvoiceWritesEnabled, type SageArInvoiceWritePayload } from "@/lib/sage/ar-invoice-write"
import type { Db } from "@/lib/server/action-context"

/*
 * Compass deposit request → its own Sage AR invoice (<job>-DEP1), through the
 * same writer, payload, request and result routes as simple invoices. Office
 * staff press Send to Sage on a deposit request; Sage posts the AR invoice
 * when it saves it. Payments are never posted to Sage from here.
 */

export type DepositSageSource = {
  readonly depositId: string
  readonly status: string
  readonly sageJobNumber: string | null
  readonly sageJobId: string | null
  readonly plan: ArInvoicePlan
  readonly invoiceType: number
  readonly invoiceStatus: number
}

/** The deposit request as Compass would send it to Sage now; null when it isn't a Compass deposit request. */
export async function loadDepositSageSource(
  db: Db,
  input: { readonly organizationId: string; readonly projectId: string; readonly depositId: string }
): Promise<DepositSageSource | null> {
  const [project, deposit, settings, format, sequences] = await Promise.all([
    loadSimpleInvoiceProject(db, input.organizationId, input.projectId),
    db
      .select({
        id: projectContractDeposits.id,
        status: projectContractDeposits.status,
        requestedAmountCents: projectContractDeposits.requestedAmountCents,
        requestedAt: projectContractDeposits.requestedAt,
        dueDate: projectContractDeposits.dueDate,
        sourceSystem: projectContractDeposits.sourceSystem,
      })
      .from(projectContractDeposits)
      .where(and(eq(projectContractDeposits.id, input.depositId), eq(projectContractDeposits.projectId, input.projectId)))
      .get(),
    readFeatureSettings(db, input.organizationId, "sage-ar-invoices"),
    depositNumberFormat(db, input.organizationId),
    depositRequestSequences(db, input.projectId),
  ])
  const sequence = sequences.get(input.depositId)
  if (!project || !deposit || deposit.sourceSystem !== "compass" || sequence === undefined) return null
  const plan = planDepositForSage({
    invoiceNumber: formatSageInvoiceNumber(format, { projectNumber: project.projectNumber, sageJobNumber: project.sageJobNumber, number: String(sequence) }),
    requestedAt: deposit.requestedAt,
    dueDate: deposit.dueDate,
    dueDays: settings.dueDays,
    amountCents: deposit.requestedAmountCents ?? 0,
    depositAccount: settings.depositAccount,
    sageJobNumber: project.sageJobNumber,
  })
  return {
    depositId: deposit.id,
    status: deposit.status,
    sageJobNumber: project.sageJobNumber,
    sageJobId: project.sageJobId,
    plan,
    invoiceType: settings.invoiceType,
    invoiceStatus: settings.invoiceStatus,
  }
}

export type QueueDepositSageResult =
  | { readonly status: "off" | "skipped"; readonly reason: string }
  | { readonly status: Extract<SageArInvoiceExportStatus, "queued" | "needs_attention">; readonly reason: string | null }

/** Queues a deposit request for Sage, or flags what needs attention. */
export async function queueDepositSageExport(input: {
  readonly db: Db
  readonly env: unknown
  readonly organizationId: string
  readonly projectId: string
  readonly depositId: string
  readonly actor: ActivityActor & { readonly id: string }
}): Promise<QueueDepositSageResult> {
  if (!sageArInvoiceWritesEnabled(input.env)) return { status: "off", reason: "Sending invoices to Sage isn't turned on for this company yet." }
  const { db, organizationId, projectId, depositId } = input
  const source = await loadDepositSageSource(db, { organizationId, projectId, depositId })
  if (!source) return { status: "skipped", reason: "Deposit request not found." }
  if (source.status === "void") return { status: "skipped", reason: "This deposit was voided." }
  const blocker = source.plan.blockers.length > 0 ? source.plan.blockers.join(" ") : null
  const status = blocker ? "needs_attention" : "queued"
  const now = new Date().toISOString()
  const written = await upsertSageDepositArExport(db, {
    organizationId,
    projectId,
    depositId,
    status,
    invoiceNumber: source.plan.invoiceNumber || "(none)",
    requestedByUserId: input.actor.id,
    errorMessage: blocker,
    now,
  })
  if (!written) return { status: "skipped", reason: "This deposit request is already on its way to Sage or in Sage." }
  await recordActivityEvent({
    db,
    organizationId,
    projectId,
    actor: input.actor,
    category: "financial",
    action: status === "needs_attention" ? "deposit_sage_needs_attention" : "deposit_sage_queued",
    entityType: "project_contract_deposit",
    entityId: depositId,
    summary:
      status === "needs_attention"
        ? `Deposit request ${source.plan.invoiceNumber}: Sage AR invoice needs attention. ${blocker ?? ""}`.trim()
        : `Deposit request ${source.plan.invoiceNumber}: sent to Sage as an AR invoice (${formatCents(source.plan.netDueCents)}).`,
    metadata: { status, invoiceNumber: source.plan.invoiceNumber, totalCents: source.plan.netDueCents },
    createdAt: now,
  })
  return { status, reason: blocker }
}

type DepositWriterRequest =
  | { readonly kind: "ready"; readonly payload: SageArInvoiceWritePayload }
  | { readonly kind: "needs_attention"; readonly reason: string }

/** Builds the writer request for a claimed deposit export from the deposit as it is now. */
async function buildDepositWriterRequest(
  db: Db,
  row: { readonly organizationId: string; readonly projectId: string; readonly depositId: string; readonly invoiceNumber: string }
): Promise<DepositWriterRequest> {
  const source = await loadDepositSageSource(db, row)
  if (!source) return { kind: "needs_attention", reason: "The deposit request wasn't found." }
  if (source.status === "void") return { kind: "needs_attention", reason: "The deposit was voided." }
  if (source.plan.blockers.length > 0) return { kind: "needs_attention", reason: source.plan.blockers.join(" ") }
  if (source.plan.invoiceNumber !== row.invoiceNumber) {
    return { kind: "needs_attention", reason: `The invoice number changed from ${row.invoiceNumber} to ${source.plan.invoiceNumber}; send it again.` }
  }
  if (!source.sageJobNumber) return { kind: "needs_attention", reason: "The project isn't linked to a Sage job." }
  // The writer ignores compassApplicationId (it logs the export id); the
  // deposit id rides there so the payload shape stays the writer's.
  const payload = sageArInvoiceWritePayload(source.plan, {
    projectId: row.projectId,
    applicationId: row.depositId,
    applicationNumber: source.plan.invoiceNumber,
    sageJobNumber: source.sageJobNumber,
    sageJobId: source.sageJobId,
    invoiceType: source.invoiceType,
    invoiceStatus: source.invoiceStatus,
  })
  if (!payload) return { kind: "needs_attention", reason: "The deposit request's Sage details aren't complete." }
  return { kind: "ready", payload: { ...payload, invoice: { ...payload.invoice, memo: `Compass deposit request ${source.plan.invoiceNumber}`.slice(0, 200) } } }
}

/**
 * The writer poll's share for deposit requests: claims up to `limit` queued
 * (or stale running) deposit exports and builds each request; a guard that
 * fails flags the export instead of sending it.
 */
export async function claimDepositWriterRequests(
  db: Db,
  input: { readonly organizationId: string; readonly limit: number; readonly nowIso: string; readonly staleBefore: string }
): Promise<readonly { readonly id: string; readonly claimToken: string; readonly payload: SageArInvoiceWritePayload }[]> {
  if (input.limit <= 0) return []
  const { organizationId, nowIso, staleBefore } = input
  const candidates = await db
    .select({
      id: sageDepositArExports.id,
      projectId: sageDepositArExports.projectId,
      depositId: sageDepositArExports.depositId,
      invoiceNumber: sageDepositArExports.invoiceNumber,
    })
    .from(sageDepositArExports)
    .where(
      and(
        eq(sageDepositArExports.organizationId, organizationId),
        or(eq(sageDepositArExports.status, "queued"), and(eq(sageDepositArExports.status, "running"), lt(sageDepositArExports.claimedAt, staleBefore)))
      )
    )
    .orderBy(asc(sageDepositArExports.requestedAt))
    .limit(input.limit)
  const requests: { readonly id: string; readonly claimToken: string; readonly payload: SageArInvoiceWritePayload }[] = []
  for (const candidate of candidates) {
    const claimToken = crypto.randomUUID()
    if (!(await claimSageDepositArExport(db, { id: candidate.id, organizationId, claimToken, now: nowIso, staleBefore }))) continue
    const fence = and(eq(sageDepositArExports.id, candidate.id), eq(sageDepositArExports.claimToken, claimToken))
    const built = await buildDepositWriterRequest(db, { organizationId, projectId: candidate.projectId, depositId: candidate.depositId, invoiceNumber: candidate.invoiceNumber })
    if (built.kind === "needs_attention") {
      await updateSageDepositArExportsStatement(db, fence, { status: "needs_attention", claimToken: null, errorMessage: built.reason, completedAt: nowIso, updatedAt: nowIso })
      continue
    }
    await updateSageDepositArExportsStatement(db, fence, { status: "running", payloadJson: JSON.stringify(built.payload), errorMessage: null, updatedAt: nowIso })
    requests.push({ id: candidate.id, claimToken, payload: built.payload })
  }
  return requests
}

export type DepositSageExportView = {
  readonly status: SageArInvoiceExportStatus
  readonly invoiceNumber: string
  readonly errorMessage: string | null
  readonly completedAt: string | null
  readonly sageRecordId: string | null
}

/** The project's deposit exports by deposit id. */
export async function loadDepositSageExports(db: Db, organizationId: string, projectId: string): Promise<ReadonlyMap<string, DepositSageExportView>> {
  const rows = await db
    .select({
      depositId: sageDepositArExports.depositId,
      status: sageDepositArExports.status,
      invoiceNumber: sageDepositArExports.invoiceNumber,
      errorMessage: sageDepositArExports.errorMessage,
      completedAt: sageDepositArExports.completedAt,
      sageRecordId: sageDepositArExports.sageRecordId,
    })
    .from(sageDepositArExports)
    .where(and(eq(sageDepositArExports.organizationId, organizationId), eq(sageDepositArExports.projectId, projectId)))
  return new Map(rows.map(({ depositId, ...view }) => [depositId, view]))
}

/** The deposit's Sage export status, or null when it was never sent. Running or succeeded fixes its amount. */
export async function depositSageExportStatus(db: Db, depositId: string): Promise<SageArInvoiceExportStatus | null> {
  const row = await db.select({ status: sageDepositArExports.status }).from(sageDepositArExports).where(eq(sageDepositArExports.depositId, depositId)).get()
  return row?.status ?? null
}
