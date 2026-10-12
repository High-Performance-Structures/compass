"use server"

import { and, eq, inArray, ne } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod/v4"

import { getDb } from "@/db"
import { sageLaborLines, shopTicketLaborClaims, shopTicketLines, shopTickets } from "@/db/schema-shop-tickets"
import { compassCostCodeFromSage } from "@/lib/shop-tickets/sage-labor"
import { chunkD1Rows, chunkD1Values } from "@/lib/d1-query"
import { requireAuth, type AuthUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import type { ShopTicketSettings } from "@/lib/feature-settings/registry"
import { requireOrg } from "@/lib/org-scope"
import { markPaperTrailDue, markPaperTrailRemoved } from "@/lib/paper-trail/enqueue"
import { canFeature, requireFeaturePermission } from "@/lib/permission-enforcement"
import {
  highestTicketSequence,
  loadBudgetCostCodes,
  loadCostCodeOptions,
  loadPayApplicationOptions,
  loadProjectShopTickets,
  loadShopTicket,
  loadShopTicketProject,
  loadShopTicketRates,
  type ShopTicketCostCodeOption,
  type ShopTicketPayApplicationOption,
  type ShopTicketProject,
  type ShopTicketWithLines,
} from "@/lib/shop-tickets/data"
import {
  budgetCostCodeSet,
  formatTicketNumber,
  isOutsideBudget,
  nextSequenceNumber,
  priceShopTicketLines,
  type ShopTicketRates,
} from "@/lib/shop-tickets/model"

const FEATURE = "shop-tickets"

type Db = ReturnType<typeof getDb>

export type ShopTicketActionResult =
  | { readonly success: true; readonly ticketId: string }
  | { readonly success: false; readonly error: string }

export type ShopTicketWorkspace = {
  readonly project: ShopTicketProject
  readonly settings: ShopTicketSettings
  readonly rates: ShopTicketRates
  readonly costCodes: readonly ShopTicketCostCodeOption[]
  /** Empty when the project has no budget, which turns the budget check off. */
  readonly budgetCostCodes: readonly string[]
  readonly payApplications: readonly ShopTicketPayApplicationOption[]
  readonly tickets: readonly ShopTicketWithLines[]
  readonly canEdit: boolean
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date.")

const ticketInputSchema = z.object({
  ticketDate: isoDate,
  laborFrom: isoDate.nullable(),
  laborTo: isoDate.nullable(),
  payApplicationNumber: z.number().int().min(1).max(999).nullable(),
  /** Any day in the billing month; stored as the first of the month. */
  payApplicationMonth: isoDate.nullable(),
  budgetApplicationId: z.string().min(1).max(80).nullable(),
  notes: z.string().max(2000).nullable(),
  lines: z
    .array(
      z.object({
        costCode: z.string().max(40),
        description: z.string().max(200),
        rateKind: z.enum(["labor", "machine"]),
        hours: z.number(),
      }),
    )
    .max(80, "A ticket can hold up to 80 lines."),
  /**
   * Sage timecard hours this ticket bills, by timecard line. Left out, the
   * ticket's existing claims stay as they are.
   */
  laborClaims: z
    .array(z.object({ laborLineId: z.string().min(1).max(200), hours: z.number().positive().max(1000) }))
    .max(2000)
    .optional(),
})

export type ShopTicketInput = z.infer<typeof ticketInputSchema>

async function context(): Promise<{ readonly db: Db; readonly user: AuthUser; readonly orgId: string }> {
  const user = await requireAuth()
  const orgId = requireOrg(user)
  const { env } = await getCloudflareContext()
  return { db: getDb(env.DB), user, orgId }
}

async function editContext(projectId: string): Promise<{ readonly db: Db; readonly user: AuthUser; readonly orgId: string; readonly project: ShopTicketProject }> {
  const ctx = await context()
  if (isDemoUser(ctx.user.id)) throw new Error("The demo account can't change shop tickets.")
  await requireFeaturePermission(ctx.user, FEATURE, "update")
  const project = await loadShopTicketProject(ctx.db, ctx.orgId, projectId)
  if (!project) throw new Error("Project not found.")
  return { ...ctx, project }
}

function failure(error: unknown): { readonly success: false; readonly error: string } {
  return { success: false, error: error instanceof Error ? error.message : "Something went wrong saving the shop ticket." }
}

function revalidate(projectId: string): void {
  revalidatePath(`/dashboard/projects/${projectId}/shop-tickets`)
}

export async function getShopTicketWorkspace(projectId: string): Promise<ShopTicketWorkspace | null> {
  const { db, user, orgId } = await context()
  await requireFeaturePermission(user, FEATURE, "read")
  const project = await loadShopTicketProject(db, orgId, projectId)
  if (!project) return null
  const [settings, rates, costCodes, budgetCostCodes, payApplications, tickets, canEdit] = await Promise.all([
    readFeatureSettings(db, orgId, "shop-tickets"),
    loadShopTicketRates(db, orgId),
    loadCostCodeOptions(db),
    loadBudgetCostCodes(db, projectId),
    loadPayApplicationOptions(db, projectId),
    loadProjectShopTickets(db, projectId),
    canFeature(user, FEATURE, "update"),
  ])
  return { project, settings, rates, costCodes, budgetCostCodes, payApplications, tickets, canEdit: canEdit && !isDemoUser(user.id) }
}

/** Validates the input and prices the lines at today's set rates. */
async function prepare(db: Db, orgId: string, projectId: string, raw: ShopTicketInput) {
  const parsed = ticketInputSchema.safeParse(raw)
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Check the ticket details.")
  const input = parsed.data
  if (input.laborFrom && input.laborTo && input.laborFrom > input.laborTo) {
    throw new Error("The labor dates end before they start.")
  }
  const [rates, budgetCodes] = await Promise.all([loadShopTicketRates(db, orgId), loadBudgetCostCodes(db, projectId)])
  const priced = priceShopTicketLines(input.lines, rates, budgetCostCodeSet(budgetCodes))
  if (!priced.ok) throw new Error(priced.error)
  return { input, priced }
}

async function writeLines(db: Db, ticketId: string, lines: Extract<ReturnType<typeof priceShopTicketLines>, { ok: true }>["lines"], now: string): Promise<void> {
  await db.delete(shopTicketLines).where(eq(shopTicketLines.ticketId, ticketId))
  if (lines.length === 0) return
  await db.insert(shopTicketLines).values(
    lines.map((line, index) => ({
      id: crypto.randomUUID(),
      ticketId,
      lineNumber: index + 1,
      costCode: line.costCode,
      description: line.description,
      rateKind: line.rateKind,
      hours: line.hours,
      rateCents: line.rateCents,
      amountCents: line.amountCents,
      rateBookEntryId: line.rateBookEntryId,
      outsideBudget: line.outsideBudget,
      createdAt: now,
      updatedAt: now,
    })),
  )
}

/**
 * Replaces the Sage timecard hours this ticket bills. Each claim is capped at
 * the hours not already on another (not void) ticket, and kept only when the
 * ticket still has a labor line with that hour's cost code.
 */
async function writeLaborClaims(
  db: Db,
  orgId: string,
  projectId: string,
  ticketId: string,
  claims: readonly { readonly laborLineId: string; readonly hours: number }[],
  lines: Extract<ReturnType<typeof priceShopTicketLines>, { ok: true }>["lines"],
  now: string,
): Promise<void> {
  await db.delete(shopTicketLaborClaims).where(eq(shopTicketLaborClaims.ticketId, ticketId))
  const ids = [...new Set(claims.map((claim) => claim.laborLineId))]
  if (ids.length === 0) return
  const laborCodes = new Set(lines.filter((line) => line.rateKind === "labor").map((line) => line.costCode))
  const laborLines = []
  const others = []
  for (const chunk of chunkD1Values(ids)) {
    const [lineRows, otherRows] = await Promise.all([
      db
        .select()
        .from(sageLaborLines)
        .where(and(inArray(sageLaborLines.id, chunk), eq(sageLaborLines.projectId, projectId), eq(sageLaborLines.organizationId, orgId))),
      db
        .select({ lineId: shopTicketLaborClaims.laborLineId, hours: shopTicketLaborClaims.hours })
        .from(shopTicketLaborClaims)
        .innerJoin(shopTickets, eq(shopTickets.id, shopTicketLaborClaims.ticketId))
        .where(and(inArray(shopTicketLaborClaims.laborLineId, chunk), ne(shopTickets.status, "void"))),
    ])
    laborLines.push(...lineRows)
    others.push(...otherRows)
  }
  const billed = new Map<string, number>()
  for (const other of others) billed.set(other.lineId, (billed.get(other.lineId) ?? 0) + other.hours)
  const byId = new Map(laborLines.map((line) => [line.id, line]))
  const rows = claims.flatMap((claim) => {
    const line = byId.get(claim.laborLineId)
    if (!line) return []
    const code = compassCostCodeFromSage(line.sageCostCode, line.sageCostCodeName)
    if (!code || !laborCodes.has(code)) return []
    const hours = Math.min(claim.hours, Math.max(0, line.hours - (billed.get(line.id) ?? 0)))
    return hours > 0 ? [{ ticketId, laborLineId: line.id, hours, createdAt: now }] : []
  })
  for (const chunk of chunkD1Rows(rows)) await db.insert(shopTicketLaborClaims).values(chunk)
}

function monthStart(date: string | null): string | null {
  return date ? `${date.slice(0, 7)}-01` : null
}

export async function createShopTicket(projectId: string, raw: ShopTicketInput): Promise<ShopTicketActionResult> {
  try {
    const { db, user, orgId } = await editContext(projectId)
    const { input, priced } = await prepare(db, orgId, projectId, raw)
    const settings = await readFeatureSettings(db, orgId, "shop-tickets")
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    // Two people creating tickets at once can pick the same number; the unique
    // index rejects the second insert and it retries with the next number.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const sequenceNumber = nextSequenceNumber(await highestTicketSequence(db, orgId), settings.startNumber)
      try {
        await db.insert(shopTickets).values({
          id,
          organizationId: orgId,
          projectId,
          sequenceNumber,
          ticketNumber: formatTicketNumber(settings.numberPrefix, sequenceNumber),
          status: "draft",
          ticketDate: input.ticketDate,
          laborFrom: input.laborFrom,
          laborTo: input.laborTo,
          payApplicationNumber: input.payApplicationNumber,
          payApplicationMonth: monthStart(input.payApplicationMonth),
          budgetApplicationId: input.budgetApplicationId,
          notes: input.notes?.trim() || null,
          totalCents: priced.totalCents,
          createdBy: user.id,
          createdAt: now,
          updatedAt: now,
        })
        await writeLines(db, id, priced.lines, now)
        if (input.laborClaims) await writeLaborClaims(db, orgId, projectId, id, input.laborClaims, priced.lines, now)
        revalidate(projectId)
        return { success: true, ticketId: id }
      } catch (error) {
        if (!(error instanceof Error) || !/UNIQUE/i.test(error.message) || attempt === 2) throw error
      }
    }
    throw new Error("Couldn't assign a ticket number. Try again.")
  } catch (error) {
    return failure(error)
  }
}

async function draftTicket(db: Db, projectId: string, ticketId: string) {
  const ticket = await loadShopTicket(db, ticketId)
  if (!ticket || ticket.projectId !== projectId) throw new Error("Shop ticket not found.")
  return ticket
}

export async function updateShopTicket(projectId: string, ticketId: string, raw: ShopTicketInput): Promise<ShopTicketActionResult> {
  try {
    const { db, orgId } = await editContext(projectId)
    const ticket = await draftTicket(db, projectId, ticketId)
    if (ticket.status !== "draft") throw new Error("Issued tickets can't be edited. Void it and create a new one.")
    const { input, priced } = await prepare(db, orgId, projectId, raw)
    const now = new Date().toISOString()
    await db
      .update(shopTickets)
      .set({
        ticketDate: input.ticketDate,
        laborFrom: input.laborFrom,
        laborTo: input.laborTo,
        payApplicationNumber: input.payApplicationNumber,
        payApplicationMonth: monthStart(input.payApplicationMonth),
        budgetApplicationId: input.budgetApplicationId,
        notes: input.notes?.trim() || null,
        totalCents: priced.totalCents,
        updatedAt: now,
      })
      .where(and(eq(shopTickets.id, ticketId), eq(shopTickets.status, "draft")))
    await writeLines(db, ticketId, priced.lines, now)
    if (input.laborClaims) await writeLaborClaims(db, orgId, projectId, ticketId, input.laborClaims, priced.lines, now)
    revalidate(projectId)
    return { success: true, ticketId }
  } catch (error) {
    return failure(error)
  }
}

/**
 * Issues a draft. Lines outside the project budget need someone to confirm
 * they reviewed them; Compass records who did.
 */
export async function issueShopTicket(
  projectId: string,
  ticketId: string,
  options: { readonly budgetReviewed: boolean },
): Promise<ShopTicketActionResult> {
  try {
    const { db, user, orgId } = await editContext(projectId)
    const ticket = await draftTicket(db, projectId, ticketId)
    if (ticket.status !== "draft") throw new Error("This ticket was already issued.")
    if (ticket.lines.length === 0) throw new Error("Add at least one line before issuing.")
    if (ticket.payApplicationNumber === null || ticket.payApplicationMonth === null) {
      throw new Error("Choose the pay application this ticket is billed on.")
    }
    // Re-check the budget at issue time; it may have changed since the draft.
    const budget = budgetCostCodeSet(await loadBudgetCostCodes(db, projectId))
    const outside = ticket.lines.filter((line) => isOutsideBudget(line.costCode, budget))
    if (outside.length > 0 && !options.budgetReviewed) {
      throw new Error(
        `${outside.length === 1 ? "1 line uses a cost code" : `${outside.length} lines use cost codes`} not in this project's budget. Change the code, start a change order, or confirm you've reviewed it.`,
      )
    }
    const now = new Date().toISOString()
    const updated = await db
      .update(shopTickets)
      .set({
        status: "issued",
        issuedBy: user.id,
        issuedAt: now,
        budgetReviewedBy: outside.length > 0 ? user.id : null,
        budgetReviewedAt: outside.length > 0 ? now : null,
        updatedAt: now,
      })
      .where(and(eq(shopTickets.id, ticketId), eq(shopTickets.status, "draft"), eq(shopTickets.organizationId, orgId)))
      .returning({ id: shopTickets.id })
    if (updated.length === 0) throw new Error("This ticket was already issued.")
    await markPaperTrailDue(db, { projectId, recordType: "shop_ticket", recordId: ticketId })
    revalidate(projectId)
    return { success: true, ticketId }
  } catch (error) {
    return failure(error)
  }
}

/** Voiding keeps the number and record; the Drive copy is reprinted marked VOID. */
export async function voidShopTicket(projectId: string, ticketId: string, reason: string): Promise<ShopTicketActionResult> {
  try {
    const { db, user } = await editContext(projectId)
    const ticket = await draftTicket(db, projectId, ticketId)
    if (ticket.status !== "issued") throw new Error("Only issued tickets can be voided. Delete a draft instead.")
    const cleanReason = reason.trim()
    if (cleanReason.length < 3) throw new Error("Say why the ticket is being voided.")
    const now = new Date().toISOString()
    await db
      .update(shopTickets)
      .set({ status: "void", voidedBy: user.id, voidedAt: now, voidReason: cleanReason.slice(0, 500), updatedAt: now })
      .where(and(eq(shopTickets.id, ticketId), eq(shopTickets.status, "issued")))
    await markPaperTrailDue(db, { projectId, recordType: "shop_ticket", recordId: ticketId })
    revalidate(projectId)
    return { success: true, ticketId }
  } catch (error) {
    return failure(error)
  }
}

/** Drafts were never sent anywhere, so they can be deleted outright. */
export async function deleteShopTicketDraft(projectId: string, ticketId: string): Promise<ShopTicketActionResult> {
  try {
    const { db } = await editContext(projectId)
    const ticket = await draftTicket(db, projectId, ticketId)
    if (ticket.status !== "draft") throw new Error("Issued tickets are voided, not deleted.")
    await db.delete(shopTickets).where(and(eq(shopTickets.id, ticketId), eq(shopTickets.status, "draft")))
    await markPaperTrailRemoved(db, { recordType: "shop_ticket", recordId: ticketId })
    revalidate(projectId)
    return { success: true, ticketId }
  } catch (error) {
    return failure(error)
  }
}
