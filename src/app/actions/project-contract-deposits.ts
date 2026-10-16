"use server"

import { and, desc, eq, notInArray, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import {
  projectBudgetApplications,
  projectContractDeposits,
  projects,
} from "@/db/schema"
import { contractPackets } from "@/db/schema-contracts"
import { projectContractBudgetRevisions } from "@/db/schema-estimates"
import { requireAuth } from "@/lib/auth"
import { contractDepositCents } from "@/lib/contracts/packet"
import { getCloudflareContext } from "@/lib/db"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { refreshAutoDepositPayApplications } from "@/lib/financials/owner-pay-application-refresh"
import { requireOrg } from "@/lib/org-scope"
import { requirePermission } from "@/lib/permissions"
import { isInternalStaffRole } from "@/lib/user-roles"

export type ProjectContractDepositStatus = "requested" | "received" | "void"

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
  | { readonly success: true; readonly id: string }
  | { readonly success: false; readonly error: string }

const PAYMENT_METHODS: ReadonlySet<string> = new Set(["check", "ach", "wire", "card", "cash", "other"])

async function depositAccess(projectId: string, write: boolean) {
  const user = await requireAuth()
  requirePermission(user, "project", write ? "update" : "read")
  if (!isInternalStaffRole(user.role)) throw new Error("Only staff can manage contract deposits.")
  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
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
  const [rows, appliedDollars, packet, revision, settings] = await Promise.all([
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
        .select({ id: projectContractDeposits.id, status: projectContractDeposits.status, receivedAmountCents: projectContractDeposits.receivedAmountCents })
        .from(projectContractDeposits)
        .where(and(eq(projectContractDeposits.id, id), eq(projectContractDeposits.projectId, projectId)))
        .get()
      if (!existing) throw new Error("Deposit not found.")
      if (existing.status === "void") throw new Error("This deposit was voided.")
      await assertStillCoversApplied(db, projectId, (existing.status === "received" ? existing.receivedAmountCents ?? 0 : 0) - (values.receivedAmountCents ?? 0))
      await db.update(projectContractDeposits).set({ ...values, updatedAt: now }).where(eq(projectContractDeposits.id, id)).run()
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

export async function voidProjectContractDeposit(projectId: string, depositId: string): Promise<DepositActionResult> {
  try {
    const { db } = await depositAccess(projectId, true)
    const existing = await db
      .select({ status: projectContractDeposits.status, receivedAmountCents: projectContractDeposits.receivedAmountCents })
      .from(projectContractDeposits)
      .where(and(eq(projectContractDeposits.id, depositId), eq(projectContractDeposits.projectId, projectId)))
      .get()
    if (!existing) throw new Error("Deposit not found.")
    if (existing.status === "void") return { success: true, id: depositId }
    await assertStillCoversApplied(db, projectId, existing.status === "received" ? existing.receivedAmountCents ?? 0 : 0)
    const now = new Date().toISOString()
    await db.update(projectContractDeposits).set({ status: "void", updatedAt: now }).where(eq(projectContractDeposits.id, depositId)).run()
    await refreshAutoDepositPayApplications(db, projectId, now)
    revalidateDeposits(projectId)
    return { success: true, id: depositId }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to void the deposit." }
  }
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
