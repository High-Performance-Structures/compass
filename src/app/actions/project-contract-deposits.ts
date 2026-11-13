"use server"

import { requireProjectAudienceReadUser, assertAudiencePreviewWriteAllowed } from "@/lib/project-audience-request-server"

import { and, asc, desc, eq, notInArray, sql, type SQL } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import {
  projectBudgetApplications,
  projectContractDeposits,
  projects,
} from "@/db/schema"
import { contractPackets } from "@/db/schema-contracts"
import { projectContractBudgetRevisions } from "@/db/schema-estimates"
import { contractDepositCents } from "@/lib/contracts/packet"
import { recordActivityEvent } from "@/lib/activity-log"
import { recordImportedDrawDeposit, undoImportedDrawDeposit } from "@/lib/domain/budget/store"
import {
  COMPASS_DRAW_SOURCE,
  IMPORTED_DRAW_UNBILLED_STATUSES,
  NON_IMPORTED_BILL_SOURCES,
  importedDrawSourceLabel,
} from "@/lib/domain/financials/rules"
import {
  DEPOSIT_UNCOUNTED_APPLICATION_STATUSES,
  IMPORTED_DEPOSIT_NOTE_MAX,
  UNSUBMITTED_DRAW_STATUSES,
  importedDrawDepositAmount,
  importedDrawDepositUndoBlocker,
  parseImportedDepositUndoReason,
  recordableDepositCents,
} from "@/lib/financials/contract-deposits"
import { formatCents } from "@/lib/format"
import { getCloudflareContext } from "@/lib/db"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { refreshAutoDepositPayApplications } from "@/lib/financials/owner-pay-application-refresh"
import { depositSageExportStatus } from "@/lib/financials/deposit-sage"
import { arExportPossiblyInSage, cancelSageDepositArExport } from "@/lib/domain/sage-bridge/ar-invoice-store"
import { requireOrg } from "@/lib/org-scope"
import { projectDepositRequests, type DepositRequestSummary } from "@/lib/deposits/deposit-requests"
import { assertProjectAccess } from "@/lib/domain/project/access"
import { requirePermission } from "@/lib/permissions"
import { isInternalStaffRole } from "@/lib/user-roles"
import { requireUserContext } from "@/lib/server/action-context"
import { contractDepositMachine } from "@/lib/domain/financials/deposit-machine"
import type { ContractDepositStatus } from "@/lib/domain/financials/statuses"
import { nextState } from "@/lib/shared/state-machine"

type ProjectContractDepositStatus = ContractDepositStatus

export type ProjectContractDepositItem = {
  readonly id: string
  readonly status: ProjectContractDepositStatus
  readonly requestedAmountCents: number | null
  readonly requestedAt: string | null
  readonly dueDate: string | null
  readonly receivedAmountCents: number | null
  readonly receivedAt: string | null
  readonly paymentMethod: string | null
  readonly reference: string | null
  readonly evidenceUrl: string | null
  readonly evidenceLabel: string | null
  readonly notes: string | null
  /** Message to the client printed on a deposit request. */
  readonly requestMessage: string | null
  readonly sourceSystem: string
}

export type ProjectContractDepositSummary = {
  readonly deposits: readonly ProjectContractDepositItem[]
  readonly requestedCents: number
  readonly receivedCents: number
  /** Applied to pay applications, in cents. */
  readonly appliedCents: number
  readonly unappliedCents: number
  /** Deposit the contract packet calls for, when it sets a deposit rate. */
  readonly contractDeposit: { readonly cents: number; readonly rateBasisPoints: number } | null
  readonly canEdit: boolean
  readonly autoApplyToPayApplications: boolean
  /**
   * Received deposit that can still be recorded as applied on an imported
   * draw (not applied on imported, submitted or billed draws), in cents.
   */
  readonly recordableCents: number
  /** Imported (historical) billed draws, for recording a deposit applied on one. */
  readonly importedDraws: readonly ImportedDrawDepositItem[]
}

/** An imported billed draw and the deposit staff recorded as applied on it. */
export type ImportedDrawDepositItem = {
  readonly id: string
  readonly label: string
  readonly periodTo: string | null
  readonly sourceLabel: string | null
  readonly depositAppliedCents: number
  /** Staff recorded the deposit on this draw (it can be removed). */
  readonly recorded: boolean
  /** Why the recorded deposit can't be removed, or null when it can. */
  readonly undoBlocker: string | null
}

export type ProjectContractDepositInput = {
  readonly status: "requested" | "received"
  readonly requestedAmount: number | null
  readonly requestedAt: string | null
  readonly dueDate: string | null
  readonly receivedAmount: number | null
  readonly receivedAt: string | null
  readonly paymentMethod: string | null
  readonly reference: string | null
  readonly evidenceUrl: string | null
  readonly evidenceLabel: string | null
  readonly notes: string | null
}

type DepositActionResult =
  | { readonly success: true; readonly id: string; readonly note?: string }
  | { readonly success: false; readonly error: string }

const PAYMENT_METHODS: ReadonlySet<string> = new Set(["check", "ach", "wire", "card", "cash", "other"])

async function depositAccess(projectId: string, write: boolean) {
  const { user, db } = await requireUserContext()
  requirePermission(user, "project", write ? "update" : "read")
  if (!isInternalStaffRole(user.role)) throw new Error("Only staff can manage contract deposits.")
  const organizationId = requireOrg(user)
  const project = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
    .get()
  if (!project) throw new Error("Project not found")
  return { db, user, organizationId }
}

function cleanText(value: string | null, max: number): string | null {
  const trimmed = value?.trim() ?? ""
  return trimmed ? trimmed.slice(0, max) : null
}

function cents(value: number | null, label: string, required: boolean): number | null {
  if (value === null || value === undefined) {
    if (required) throw new Error(`${label} is required.`)
    return null
  }
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be greater than zero.`)
  return Math.round(value * 100)
}

function isoDate(value: string | null, label: string, required: boolean): string | null {
  const trimmed = value?.trim() ?? ""
  if (!trimmed) {
    if (required) throw new Error(`${label} is required.`)
    return null
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) throw new Error(`${label} must be a date.`)
  return trimmed
}

function httpsUrl(value: string | null): string | null {
  const trimmed = value?.trim() ?? ""
  if (!trimmed) return null
  try {
    const url = new URL(trimmed)
    if (url.protocol !== "https:") throw new Error("not https")
    return url.toString()
  } catch {
    throw new Error("The receipt link must be an https:// address.")
  }
}

function revalidateDeposits(projectId: string): void {
  revalidatePath(`/dashboard/projects/${projectId}/financials`)
  revalidatePath(`/dashboard/projects/${projectId}/budget`)
  revalidatePath(`/preview/projects/${projectId}/owner/budget`)
}

/** Dollars of deposit already applied to the project's pay applications. */
async function appliedDepositDollars(db: ReturnType<typeof getDb>, projectId: string): Promise<number> {
  const row = await db
    .select({ dollars: sql<number>`coalesce(sum(${projectBudgetApplications.depositApplied}), 0)` })
    .from(projectBudgetApplications)
    .where(
      and(
        eq(projectBudgetApplications.projectId, projectId),
        notInArray(projectBudgetApplications.status, ["budget_current", "budget_superseded", "void"])
      )
    )
    .get()
  return Number(row?.dollars ?? 0)
}

export async function getProjectContractDeposits(projectId: string): Promise<ProjectContractDepositSummary> {
  const { db, user, organizationId } = await depositAccess(projectId, false)
  const [rows, appliedDollars, packet, revision, settings, ledger] = await Promise.all([
    db
      .select()
      .from(projectContractDeposits)
      .where(eq(projectContractDeposits.projectId, projectId))
      .orderBy(desc(projectContractDeposits.createdAt)),
    appliedDepositDollars(db, projectId),
    db
      .select({ rate: contractPackets.depositRateBasisPoints })
      .from(contractPackets)
      .where(eq(contractPackets.projectId, projectId))
      .orderBy(desc(contractPackets.versionNumber))
      .get(),
    db
      .select({ cents: projectContractBudgetRevisions.originalContractSumCents })
      .from(projectContractBudgetRevisions)
      .where(and(eq(projectContractBudgetRevisions.projectId, projectId), eq(projectContractBudgetRevisions.status, "current")))
      .get(),
    readFeatureSettings(db, organizationId, "contract-deposits"),
    readImportedDrawLedger(db, projectId),
  ])
  const live = rows.filter((row) => row.status !== "void")
  const requestedCents = live.reduce((sum, row) => sum + (row.requestedAmountCents ?? 0), 0)
  const receivedCents = live
    .filter((row) => row.status === "received")
    .reduce((sum, row) => sum + (row.receivedAmountCents ?? 0), 0)
  const appliedCents = Math.round(appliedDollars * 100)
  const rate = packet?.rate ?? 0
  return {
    deposits: rows.map((row) => ({
      id: row.id,
      status: row.status === "requested" || row.status === "void" ? row.status : "received",
      requestedAmountCents: row.requestedAmountCents,
      requestedAt: row.requestedAt,
      dueDate: row.dueDate,
      receivedAmountCents: row.receivedAmountCents,
      receivedAt: row.receivedAt,
      paymentMethod: row.paymentMethod,
      reference: row.reference,
      evidenceUrl: row.evidenceUrl,
      evidenceLabel: row.evidenceLabel,
      notes: row.notes,
      requestMessage: row.requestMessage,
      sourceSystem: row.sourceSystem,
    })),
    requestedCents,
    receivedCents,
    appliedCents,
    unappliedCents: Math.max(0, receivedCents - appliedCents),
    contractDeposit: rate > 0 && revision ? { cents: contractDepositCents(revision.cents, rate), rateBasisPoints: rate } : null,
    canEdit: (() => {
      try {
        requirePermission(user, "project", "update")
        return true
      } catch {
        return false
      }
    })(),
    autoApplyToPayApplications: settings.autoApplyToPayApplications,
    recordableCents: recordableDepositCents({ receivedCents, lockedAppliedDollars: ledger.lockedAppliedDollars }),
    importedDraws: ledger.importedDraws.map((draw) => ({
      id: draw.id,
      label: `Pay application ${draw.applicationNumber}`,
      periodTo: draw.periodTo,
      sourceLabel: importedDrawSourceLabel(draw.sourceSystem),
      depositAppliedCents: Math.round(draw.depositApplied * 100),
      recorded: draw.depositAppliedMode === "recorded",
      undoBlocker:
        draw.depositAppliedMode === "recorded"
          ? importedDrawDepositUndoBlocker({ mode: draw.depositAppliedMode, submittedCompassDraws: ledger.submittedCompassDraws })
          : null,
    })),
  }
}

type ImportedDrawLedger = {
  readonly importedDraws: readonly {
    readonly id: string
    readonly applicationNumber: string
    readonly periodTo: string | null
    readonly sourceSystem: string
    readonly depositApplied: number
    readonly depositAppliedMode: string
  }[]
  /** Deposit applied on imported, submitted and billed draws and hand-set drafts, in dollars. */
  readonly lockedAppliedDollars: number
  /** Compass pay applications past draft. */
  readonly submittedCompassDraws: number
}

/**
 * The project's imported billed draws, the deposit already applied that a new
 * record must leave room for, and how many Compass draws are past draft.
 */
async function readImportedDrawLedger(db: ReturnType<typeof getDb>, projectId: string): Promise<ImportedDrawLedger> {
  const [importedDraws, locked, submitted] = await Promise.all([
    db
      .select({
        id: projectBudgetApplications.id,
        applicationNumber: projectBudgetApplications.applicationNumber,
        periodTo: projectBudgetApplications.periodTo,
        sourceSystem: projectBudgetApplications.sourceSystem,
        depositApplied: projectBudgetApplications.depositApplied,
        depositAppliedMode: projectBudgetApplications.depositAppliedMode,
      })
      .from(projectBudgetApplications)
      .where(importedBilledDrawCondition(projectId))
      .orderBy(asc(projectBudgetApplications.periodTo), asc(projectBudgetApplications.createdAt)),
    db
      .select({ dollars: sql<number>`coalesce(sum(${projectBudgetApplications.depositApplied}), 0)` })
      .from(projectBudgetApplications)
      .where(
        and(
          eq(projectBudgetApplications.projectId, projectId),
          notInArray(projectBudgetApplications.status, [...DEPOSIT_UNCOUNTED_APPLICATION_STATUSES]),
          // Drafts that apply the deposit automatically recalculate afterwards.
          sql`not (${projectBudgetApplications.status} = 'draft' and ${projectBudgetApplications.depositAppliedMode} = 'auto')`
        )
      )
      .get(),
    db
      .select({ count: sql<number>`count(*)` })
      .from(projectBudgetApplications)
      .where(
        and(
          eq(projectBudgetApplications.projectId, projectId),
          eq(projectBudgetApplications.sourceSystem, COMPASS_DRAW_SOURCE),
          notInArray(projectBudgetApplications.status, [...UNSUBMITTED_DRAW_STATUSES])
        )
      )
      .get(),
  ])
  return {
    importedDraws,
    lockedAppliedDollars: Number(locked?.dollars ?? 0),
    submittedCompassDraws: Number(submitted?.count ?? 0),
  }
}

/** Imported (Sage or Drive) draws that were billed: not drafts, budget views, Sage job-cost snapshots or void. */
function importedBilledDrawCondition(projectId: string): SQL | undefined {
  return and(
    eq(projectBudgetApplications.projectId, projectId),
    notInArray(projectBudgetApplications.sourceSystem, [...NON_IMPORTED_BILL_SOURCES]),
    notInArray(projectBudgetApplications.status, [...IMPORTED_DRAW_UNBILLED_STATUSES])
  )
}

async function receivedDepositCents(db: ReturnType<typeof getDb>, projectId: string): Promise<number> {
  const row = await db
    .select({ cents: sql<number>`coalesce(sum(${projectContractDeposits.receivedAmountCents}), 0)` })
    .from(projectContractDeposits)
    .where(and(eq(projectContractDeposits.projectId, projectId), eq(projectContractDeposits.status, "received")))
    .get()
  return Number(row?.cents ?? 0)
}

export type ImportedDrawDepositInput = {
  /** Deposit applied on the draw, in dollars. */
  readonly amount: number | null
  readonly note: string | null
}

/**
 * Records that a received deposit was already applied on an imported draw
 * (billed outside Compass), so the next Compass draft does not apply it
 * again. Only on an imported billed draw with no deposit on it, and only up
 * to the received deposit not yet applied. Drafts that apply the deposit
 * automatically are recalculated.
 */
export async function recordDepositOnImportedDraw(
  projectId: string,
  applicationId: string,
  input: ImportedDrawDepositInput
): Promise<DepositActionResult> {
  try {
    await assertAudiencePreviewWriteAllowed()
    const { db, user, organizationId } = await depositAccess(projectId, true)
    const [draw, ledger, receivedCents] = await Promise.all([
      db
        .select({
          applicationNumber: projectBudgetApplications.applicationNumber,
          depositApplied: projectBudgetApplications.depositApplied,
        })
        .from(projectBudgetApplications)
        .where(and(eq(projectBudgetApplications.id, applicationId), importedBilledDrawCondition(projectId)))
        .get(),
      readImportedDrawLedger(db, projectId),
      receivedDepositCents(db, projectId),
    ])
    if (!draw) throw new Error("Only an imported draw billed outside Compass can take a recorded deposit.")
    if (draw.depositApplied !== 0) throw new Error("A deposit is already recorded on this draw. Remove it first to change it.")
    const amount = importedDrawDepositAmount({
      amountDollars: input.amount,
      recordableCents: recordableDepositCents({ receivedCents, lockedAppliedDollars: ledger.lockedAppliedDollars }),
    })
    if (!amount.ok) throw new Error(amount.error)
    const now = new Date().toISOString()
    const saved = await recordImportedDrawDeposit(db, { projectId, applicationId, cents: amount.cents, now })
    if (!saved) throw new Error("The deposit or this draw changed while you were recording it. Refresh and try again.")
    // Drafts that applied the same deposit automatically give it back.
    await refreshAutoDepositPayApplications(db, projectId, now)
    const note = cleanText(input.note, IMPORTED_DEPOSIT_NOTE_MAX)
    await recordActivityEvent({
      db, organizationId, projectId, actor: user, category: "financial",
      action: "pay_application_deposit_recorded", entityType: "pay_application", entityId: applicationId,
      summary: `Recorded ${formatCents(amount.cents)} of deposit as applied on imported pay application ${draw.applicationNumber}.${note ? ` ${note}` : ""}`,
      metadata: { amountCents: amount.cents, note },
    })
    revalidateDeposits(projectId)
    return { success: true, id: applicationId }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to record the deposit on this draw." }
  }
}

/**
 * Removes a deposit recorded on an imported draw, with a reason, while no
 * Compass pay application past draft exists. Drafts recalculate and may apply
 * the freed deposit.
 */
export async function removeDepositFromImportedDraw(
  projectId: string,
  applicationId: string,
  reason: string
): Promise<DepositActionResult> {
  try {
    await assertAudiencePreviewWriteAllowed()
    const { db, user, organizationId } = await depositAccess(projectId, true)
    const parsed = parseImportedDepositUndoReason(reason)
    if (!parsed.ok) throw new Error(parsed.error)
    const [draw, ledger] = await Promise.all([
      db
        .select({
          applicationNumber: projectBudgetApplications.applicationNumber,
          depositApplied: projectBudgetApplications.depositApplied,
          depositAppliedMode: projectBudgetApplications.depositAppliedMode,
        })
        .from(projectBudgetApplications)
        .where(and(eq(projectBudgetApplications.id, applicationId), eq(projectBudgetApplications.projectId, projectId)))
        .get(),
      readImportedDrawLedger(db, projectId),
    ])
    if (!draw) throw new Error("Pay application not found.")
    const blocker = importedDrawDepositUndoBlocker({ mode: draw.depositAppliedMode, submittedCompassDraws: ledger.submittedCompassDraws })
    if (blocker) throw new Error(blocker)
    const now = new Date().toISOString()
    const removed = await undoImportedDrawDeposit(db, { projectId, applicationId, now })
    if (!removed) throw new Error("This draw changed while you were removing the deposit. Refresh and try again.")
    await refreshAutoDepositPayApplications(db, projectId, now)
    const cents = Math.round(draw.depositApplied * 100)
    await recordActivityEvent({
      db, organizationId, projectId, actor: user, category: "financial",
      action: "pay_application_deposit_removed", entityType: "pay_application", entityId: applicationId,
      summary: `Removed ${formatCents(cents)} of recorded deposit from imported pay application ${draw.applicationNumber}: ${parsed.reason}`,
      metadata: { amountCents: cents, reason: parsed.reason },
    })
    revalidateDeposits(projectId)
    return { success: true, id: applicationId }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to remove the deposit from this draw." }
  }
}

/**
 * Record a deposit request, or a received deposit (with or without a prior
 * request). Saving an existing request as received marks it paid.
 */
export async function saveProjectContractDeposit(
  projectId: string,
  depositId: string | null,
  input: ProjectContractDepositInput
): Promise<DepositActionResult> {
  try {
    await assertAudiencePreviewWriteAllowed()
    const { db, user } = await depositAccess(projectId, true)
    const received = input.status === "received"
    const paymentMethod = cleanText(input.paymentMethod, 20)
    if (paymentMethod && !PAYMENT_METHODS.has(paymentMethod)) throw new Error("Choose how the deposit was paid.")
    const values = {
      status: input.status,
      requestedAmountCents: cents(input.requestedAmount, "Requested amount", !received),
      requestedAt: isoDate(input.requestedAt, "Request date", false),
      dueDate: isoDate(input.dueDate, "Due date", false),
      receivedAmountCents: received ? cents(input.receivedAmount, "Amount received", true) : null,
      receivedAt: received ? isoDate(input.receivedAt, "Date received", true) : null,
      paymentMethod: received ? paymentMethod : null,
      reference: received ? cleanText(input.reference, 120) : null,
      evidenceUrl: httpsUrl(input.evidenceUrl),
      evidenceLabel: cleanText(input.evidenceLabel, 200),
      notes: cleanText(input.notes, 2_000),
    }
    const now = new Date().toISOString()
    let id = depositId
    if (id) {
      const existing = await db
        .select({ id: projectContractDeposits.id, status: projectContractDeposits.status, receivedAmountCents: projectContractDeposits.receivedAmountCents, updatedAt: projectContractDeposits.updatedAt })
        .from(projectContractDeposits)
        .where(and(eq(projectContractDeposits.id, id), eq(projectContractDeposits.projectId, projectId)))
        .get()
      if (!existing) throw new Error("Deposit not found.")
      if (existing.status === "void") throw new Error("This deposit was voided.")
      // A request whose AR invoice is in Sage (or on its way) keeps its amount and date.
      if (["running", "succeeded"].includes((await depositSageExportStatus(db, id)) ?? "")) {
        const sent = await db
          .select({ cents: projectContractDeposits.requestedAmountCents, at: projectContractDeposits.requestedAt })
          .from(projectContractDeposits)
          .where(eq(projectContractDeposits.id, id))
          .get()
        if (sent && (sent.cents !== values.requestedAmountCents || sent.at !== values.requestedAt)) {
          throw new Error("This deposit request is in Sage as an AR invoice; its requested amount and date can't change. Record the payment without changing them.")
        }
      }
      await assertStillCoversApplied(db, projectId, (existing.status === "received" ? existing.receivedAmountCents ?? 0 : 0) - (values.receivedAmountCents ?? 0))
      // Compare-and-set on the deposit as read above (a receive, unreceive or plain
      // save): a void or another save meanwhile wins, and this one is refused.
      if (existing.status !== values.status && !nextState(contractDepositMachine, existing.status, values.status === "received" ? "receive" : "unreceive").ok) {
        throw new Error("That deposit change isn't allowed.")
      }
      const saved = await db
        .update(projectContractDeposits)
        .set({ ...values, updatedAt: now })
        .where(and(eq(projectContractDeposits.id, id), eq(projectContractDeposits.status, existing.status), eq(projectContractDeposits.updatedAt, existing.updatedAt)))
        .returning({ id: projectContractDeposits.id })
      if (saved.length === 0) throw new Error("This deposit changed while you were editing it (voided or saved by someone else). Refresh and try again.")
    } else {
      id = crypto.randomUUID()
      await db
        .insert(projectContractDeposits)
        .values({ id, projectId, ...values, sourceSystem: "compass", createdBy: user.id, createdAt: now, updatedAt: now })
        .run()
    }
    await refreshAutoDepositPayApplications(db, projectId, now)
    revalidateDeposits(projectId)
    return { success: true, id }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to save the deposit." }
  }
}

/** Deposit requests the project's client can see (any project viewer). */
export async function getProjectDepositRequests(projectId: string): Promise<readonly DepositRequestSummary[]> {
  const user = await requireProjectAudienceReadUser(projectId)
  requirePermission(user, "project", "read")
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  await assertProjectAccess(db, user, projectId)
  return projectDepositRequests(db, projectId)
}

export type ProjectContractDepositRequestInput = {
  readonly amount: number | null
  readonly dueDate: string | null
  readonly message: string | null
}

/**
 * Requests a deposit from the client: a requested deposit with a printable
 * Deposit Request, shown to the owner. Record payment on it when it arrives;
 * void it to withdraw the request.
 */
export async function requestProjectContractDeposit(
  projectId: string,
  input: ProjectContractDepositRequestInput
): Promise<DepositActionResult> {
  try {
    await assertAudiencePreviewWriteAllowed()
    const { db, user } = await depositAccess(projectId, true)
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    await db
      .insert(projectContractDeposits)
      .values({
        id,
        projectId,
        status: "requested",
        requestedAmountCents: cents(input.amount, "Deposit amount", true),
        requestedAt: now.slice(0, 10),
        dueDate: isoDate(input.dueDate, "Due date", false),
        requestMessage: cleanText(input.message, 2_000),
        sourceSystem: "compass",
        createdBy: user.id,
        createdAt: now,
        updatedAt: now,
      })
      .run()
    revalidateDeposits(projectId)
    return { success: true, id }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to request the deposit." }
  }
}

export async function voidProjectContractDeposit(projectId: string, depositId: string): Promise<DepositActionResult> {
  try {
    await assertAudiencePreviewWriteAllowed()
    const { db, organizationId } = await depositAccess(projectId, true)
    const existing = await db
      .select({ status: projectContractDeposits.status, receivedAmountCents: projectContractDeposits.receivedAmountCents, updatedAt: projectContractDeposits.updatedAt })
      .from(projectContractDeposits)
      .where(and(eq(projectContractDeposits.id, depositId), eq(projectContractDeposits.projectId, projectId)))
      .get()
    if (!existing) throw new Error("Deposit not found.")
    if (existing.status === "void") return { success: true, id: depositId }
    await assertStillCoversApplied(db, projectId, existing.status === "received" ? existing.receivedAmountCents ?? 0 : 0)
    const now = new Date().toISOString()
    // Void first, fenced on the status it was read in. From then on the Sage
    // writer can't claim its AR invoice (the claim checks for void in the same
    // statement); a queued one is withdrawn next.
    const reductionCents = existing.status === "received" ? existing.receivedAmountCents ?? 0 : 0
    const voided = await db.update(projectContractDeposits).set({ status: contractDepositMachine.transitions.void.to, updatedAt: now })
      .where(and(
        eq(projectContractDeposits.id, depositId), eq(projectContractDeposits.status, existing.status),
        // Nothing else changed it meanwhile (a payment recorded with the same status, say).
        eq(projectContractDeposits.updatedAt, existing.updatedAt),
        // The applied-deposit check again, in the same statement: a pay application submitted meanwhile still counts.
        reductionCents > 0 ? stillCoversAppliedSql(projectId, reductionCents) : undefined,
      ))
      .returning({ id: projectContractDeposits.id })
    if (voided.length !== 1) {
      await assertStillCoversApplied(db, projectId, reductionCents)
      throw new Error("This deposit changed while you were voiding it. Refresh and try again.")
    }
    let note: string | null = null
    if (await depositSageExportStatus(db, depositId)) {
      // A queued export is withdrawn. Whether or not that lands, one the writer
      // ran or is running may be in Sage (the writer can report a failure for
      // an invoice Sage took), so staff are told to check.
      const cancelled = await cancelSageDepositArExport(db, { organizationId, depositId, now })
      if (!cancelled || (await arExportPossiblyInSage(db, { kind: "deposit", organizationId, sourceId: depositId }))) {
        note = "Its Sage AR invoice may be in Sage (or being added); check Sage and void it there too."
      }
    }
    await refreshAutoDepositPayApplications(db, projectId, now)
    revalidateDeposits(projectId)
    return note ? { success: true, id: depositId, note } : { success: true, id: depositId }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to void the deposit." }
  }
}

/** assertStillCoversApplied as a WHERE condition, for the void's own statement. */
function stillCoversAppliedSql(projectId: string, reductionCents: number): SQL {
  return sql`(SELECT coalesce(sum(received_amount_cents), 0) FROM project_contract_deposits
      WHERE project_id = ${projectId} AND status = 'received') - ${reductionCents}
    >= (SELECT round(coalesce(sum(deposit_applied), 0) * 100) FROM project_budget_applications
      WHERE project_id = ${projectId} AND status NOT IN ('budget_current', 'budget_superseded', 'void', 'draft', 'building'))`
}

/**
 * Reducing received deposits must not drop below what submitted pay
 * applications already applied; drafts recalculate on their own.
 */
async function assertStillCoversApplied(db: ReturnType<typeof getDb>, projectId: string, reductionCents: number): Promise<void> {
  if (reductionCents <= 0) return
  const [received, locked] = await Promise.all([
    db
      .select({ cents: sql<number>`coalesce(sum(${projectContractDeposits.receivedAmountCents}), 0)` })
      .from(projectContractDeposits)
      .where(and(eq(projectContractDeposits.projectId, projectId), eq(projectContractDeposits.status, "received")))
      .get(),
    db
      .select({ dollars: sql<number>`coalesce(sum(${projectBudgetApplications.depositApplied}), 0)` })
      .from(projectBudgetApplications)
      .where(
        and(
          eq(projectBudgetApplications.projectId, projectId),
          notInArray(projectBudgetApplications.status, ["budget_current", "budget_superseded", "void", "draft", "building"])
        )
      )
      .get(),
  ])
  const remaining = Number(received?.cents ?? 0) - reductionCents
  if (remaining < Math.round(Number(locked?.dollars ?? 0) * 100)) {
    throw new Error("Submitted pay applications already applied more deposit than would remain. Adjust those pay applications first.")
  }
}
