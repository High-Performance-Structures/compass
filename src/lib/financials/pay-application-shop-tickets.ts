import { and, asc, eq, inArray, isNull } from "drizzle-orm"

import { projectBudgetApplications, projectBudgetLines } from "@/db/schema"
import { payApplicationShopTicketImports, shopTicketLines, shopTickets } from "@/db/schema-shop-tickets"
import { chunkD1Values } from "@/lib/d1-query"
import {
  budgetLineProgress,
  planShopTicketContributions,
  retainageAtRate,
  shopTicketContributionTargets,
  type ShopTicketAmount,
  type ShopTicketContribution,
  type ShopTicketContributionPlan,
} from "@/lib/domain/budget/rules"
import {
  deleteShopTicketImportsStatement,
  insertShopTicketImportsStatements,
  updateBudgetLinesStatement,
  type Statement,
} from "@/lib/domain/budget/store"
import { updateShopTickets, updateShopTicketsStatement } from "@/lib/domain/operations/store"
import { formatCents } from "@/lib/format"
import { assertBilledAmountsEditable, refreshOwnerPayApplication } from "@/lib/financials/owner-pay-application-refresh"
import type { Db } from "@/lib/server/action-context"

/*
 * Shop tickets billed on an owner pay application: linking issued tickets to
 * the draft they are billed on, importing their amounts onto its G703 lines,
 * and recording what each ticket added so nothing is billed twice. Only a
 * draft changes; callers check access first.
 *
 * Linking leaves a ticket's updated_at alone: the issued ticket's printed
 * copy does not change, so it should not be reprinted to Drive.
 */

const COMPASS_DRAW_SOURCE = "compass_contract_budget"

type Application = { readonly id: string; readonly applicationNumber: string; readonly status: string }

async function loadApplication(db: Db, projectId: string, applicationId: string): Promise<Application | null> {
  const application = await db
    .select({
      id: projectBudgetApplications.id,
      applicationNumber: projectBudgetApplications.applicationNumber,
      status: projectBudgetApplications.status,
    })
    .from(projectBudgetApplications)
    .where(
      and(
        eq(projectBudgetApplications.id, applicationId),
        eq(projectBudgetApplications.projectId, projectId),
        eq(projectBudgetApplications.sourceSystem, COMPASS_DRAW_SOURCE)
      )
    )
    .get()
  return application ?? null
}

async function requireDraft(db: Db, projectId: string, applicationId: string): Promise<Application> {
  const application = await loadApplication(db, projectId, applicationId)
  if (!application) throw new Error("Pay application not found.")
  if (application.status !== "draft") throw new Error("Only a draft pay application can be changed.")
  return application
}

/** The pay application number a shop ticket would name, or null when it isn't a whole number. */
function shopTicketPayApplicationNumber(applicationNumber: string): number | null {
  const trimmed = applicationNumber.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const value = Number.parseInt(trimmed, 10)
  return value > 0 ? value : null
}

/**
 * Links issued tickets on the project that name this draft's pay application
 * number and aren't linked to any pay application yet. Returns how many.
 */
export async function linkShopTicketsByNumber(db: Db, projectId: string, applicationId: string): Promise<number> {
  const application = await loadApplication(db, projectId, applicationId)
  if (application?.status !== "draft") return 0
  const number = shopTicketPayApplicationNumber(application.applicationNumber)
  if (number === null) return 0
  const linked = await updateShopTickets(
    db,
    and(
      eq(shopTickets.projectId, projectId),
      eq(shopTickets.status, "issued"),
      eq(shopTickets.payApplicationNumber, number),
      isNull(shopTickets.budgetApplicationId)
    ),
    { budgetApplicationId: applicationId }
  )
  return linked.length
}

/** Links any issued, unlinked ticket on the project to a draft pay application. */
export async function attachShopTicket(db: Db, projectId: string, applicationId: string, ticketId: string): Promise<void> {
  await requireDraft(db, projectId, applicationId)
  const linked = await updateShopTickets(
    db,
    and(
      eq(shopTickets.id, ticketId),
      eq(shopTickets.projectId, projectId),
      eq(shopTickets.status, "issued"),
      isNull(shopTickets.budgetApplicationId)
    ),
    { budgetApplicationId: applicationId }
  )
  if (linked.length === 0) {
    throw new Error("Only an issued shop ticket that isn't on a pay application yet can be attached.")
  }
}

type LinkedTicket = { readonly id: string; readonly ticketNumber: string; readonly status: string }

async function linkedTickets(db: Db, projectId: string, applicationId: string): Promise<readonly LinkedTicket[]> {
  return db
    .select({ id: shopTickets.id, ticketNumber: shopTickets.ticketNumber, status: shopTickets.status })
    .from(shopTickets)
    .where(and(eq(shopTickets.projectId, projectId), eq(shopTickets.budgetApplicationId, applicationId)))
    .orderBy(asc(shopTickets.sequenceNumber))
}

async function ticketAmounts(db: Db, ticketIds: readonly string[]): Promise<readonly ShopTicketAmount[]> {
  const chunks = await Promise.all(
    chunkD1Values(ticketIds).map((ids) =>
      db
        .select({ ticketId: shopTicketLines.ticketId, costCode: shopTicketLines.costCode, amountCents: shopTicketLines.amountCents })
        .from(shopTicketLines)
        .where(inArray(shopTicketLines.ticketId, ids))
    )
  )
  return chunks.flat()
}

type ImportRow = typeof payApplicationShopTicketImports.$inferSelect

async function importRows(db: Db, applicationId: string): Promise<readonly ImportRow[]> {
  return db.select().from(payApplicationShopTicketImports).where(eq(payApplicationShopTicketImports.applicationId, applicationId))
}

async function applicationLines(db: Db, projectId: string, applicationId: string) {
  return db
    .select()
    .from(projectBudgetLines)
    .where(and(eq(projectBudgetLines.projectId, projectId), eq(projectBudgetLines.applicationId, applicationId)))
    .orderBy(asc(projectBudgetLines.csiDivision), asc(projectBudgetLines.sortOrder))
}

/** Imported rows as contributions (rows with a line). */
function contributionsOf(rows: readonly ImportRow[]): readonly ShopTicketContribution[] {
  return rows.flatMap((row) =>
    row.mode === "imported" && row.budgetLineId
      ? [{ ticketId: row.ticketId, budgetLineId: row.budgetLineId, amountCents: row.amountCents }]
      : []
  )
}

/**
 * The statements that apply a plan: each changed line's current work and
 * totals (retainage keeps the line's rate), and the scope's imported rows
 * replaced by the plan's contributions. Unchanged rows keep who added them.
 */
function planStatements(
  db: Db,
  input: {
    readonly applicationId: string
    /** One ticket, or every ticket on the pay application. */
    readonly ticketId: string | null
    readonly lines: readonly (typeof projectBudgetLines.$inferSelect)[]
    readonly existingRows: readonly ImportRow[]
    readonly plan: ShopTicketContributionPlan
    readonly userId: string | null
    readonly now: string
  }
): Statement[] {
  const linesById = new Map(input.lines.map((line) => [line.id, line]))
  const statements: Statement[] = input.plan.lineChanges.flatMap((change) => {
    const line = linesById.get(change.lineId)
    if (!line) return []
    const progress = budgetLineProgress({ ...line, currentWorkCompleted: change.currentWorkCompleted })
    const rate = line.totalCosts > 0 ? line.retainageHeld / line.totalCosts : 0
    return [
      updateBudgetLinesStatement(db, eq(projectBudgetLines.id, line.id), {
        currentWorkCompleted: change.currentWorkCompleted,
        ...progress,
        retainageHeld: retainageAtRate(progress.totalCosts, rate),
        updatedAt: input.now,
      }),
    ]
  })
  statements.push(
    deleteShopTicketImportsStatement(
      db,
      and(
        eq(payApplicationShopTicketImports.applicationId, input.applicationId),
        eq(payApplicationShopTicketImports.mode, "imported"),
        input.ticketId ? eq(payApplicationShopTicketImports.ticketId, input.ticketId) : undefined
      )
    )
  )
  const previous = new Map(input.existingRows.map((row) => [`${row.ticketId}|${row.budgetLineId ?? ""}`, row]))
  const rows = input.plan.contributions.map((row) => {
    const kept = previous.get(`${row.ticketId}|${row.budgetLineId}`)
    const unchanged = kept && kept.amountCents === row.amountCents
    return {
      id: crypto.randomUUID(),
      applicationId: input.applicationId,
      ticketId: row.ticketId,
      budgetLineId: row.budgetLineId,
      amountCents: row.amountCents,
      mode: "imported" as const,
      createdBy: unchanged ? kept.createdBy : input.userId,
      createdAt: unchanged ? kept.createdAt : input.now,
    }
  })
  statements.push(...insertShopTicketImportsStatements(db, rows))
  return statements
}

async function runBatch(db: Db, statements: readonly Statement[]): Promise<void> {
  const [first, ...rest] = statements
  if (first) await db.batch([first, ...rest])
}

function lineInputs(lines: readonly (typeof projectBudgetLines.$inferSelect)[]) {
  return lines.map((line) => ({
    id: line.id,
    costCode: line.costCode,
    adjustedEstimate: line.adjustedEstimate,
    previousWorkCompleted: line.previousWorkCompleted,
    currentWorkCompleted: line.currentWorkCompleted,
    storedMaterials: line.storedMaterials,
  }))
}

export type ShopTicketImportResult = {
  /** Net change to current work, in cents. */
  readonly addedCents: number
  readonly warnings: readonly string[]
}

/**
 * Adds every linked, issued ticket's amounts on top of the work already
 * entered on the matching G703 lines. Only the difference from what each
 * ticket already added is applied, so importing again never doubles a
 * ticket; a voided ticket's amounts come back off. Tickets marked "already
 * included" are skipped.
 */
export async function importShopTickets(
  db: Db,
  input: { readonly projectId: string; readonly applicationId: string; readonly userId: string | null; readonly now: string }
): Promise<ShopTicketImportResult> {
  const { projectId, applicationId, now } = input
  await requireDraft(db, projectId, applicationId)
  await assertBilledAmountsEditable(db, applicationId)
  await linkShopTicketsByNumber(db, projectId, applicationId)
  const [tickets, existingRows, lines] = await Promise.all([
    linkedTickets(db, projectId, applicationId),
    importRows(db, applicationId),
    applicationLines(db, projectId, applicationId),
  ])
  const marked = new Set(existingRows.filter((row) => row.mode === "already_included").map((row) => row.ticketId))
  const importable = tickets.filter((ticket) => ticket.status === "issued" && !marked.has(ticket.id))
  if (importable.length === 0 && contributionsOf(existingRows).length === 0) {
    return { addedCents: 0, warnings: tickets.length === 0 ? ["No shop tickets are linked to this pay application."] : [] }
  }
  const targets = shopTicketContributionTargets(lines, await ticketAmounts(db, importable.map((ticket) => ticket.id)))
  const plan = planShopTicketContributions({
    lines: lineInputs(lines),
    existing: contributionsOf(existingRows),
    targets: targets.contributions,
  })
  const number = new Map(tickets.map((ticket) => [ticket.id, ticket.ticketNumber]))
  const warnings = [
    ...targets.unmatched.map(
      (row) =>
        `${number.get(row.ticketId) ?? "A ticket"}: ${row.costCode} (${formatCents(row.amountCents)}) has no line on this pay application, so it wasn't imported.`
    ),
    ...plan.blocked.map((row) => `${row.costCode} wasn't changed: ${row.error}`),
  ]
  await runBatch(
    db,
    planStatements(db, { applicationId, ticketId: null, lines, existingRows: existingRows.filter((row) => row.mode === "imported"), plan, userId: input.userId, now })
  )
  await refreshOwnerPayApplication(db, projectId, applicationId, now)
  return { addedCents: plan.lineChanges.reduce((sum, change) => sum + change.deltaCents, 0), warnings }
}

/**
 * Unlinks a ticket from a draft pay application and takes back off whatever
 * it added to the G703 lines (and its "already included" mark).
 */
export async function detachShopTicket(
  db: Db,
  input: { readonly projectId: string; readonly applicationId: string; readonly ticketId: string; readonly now: string }
): Promise<void> {
  const { projectId, applicationId, ticketId, now } = input
  await requireDraft(db, projectId, applicationId)
  const [tickets, existingRows, lines] = await Promise.all([
    linkedTickets(db, projectId, applicationId),
    importRows(db, applicationId),
    applicationLines(db, projectId, applicationId),
  ])
  const ticket = tickets.find((row) => row.id === ticketId)
  if (!ticket) throw new Error("That shop ticket isn't on this pay application.")
  const ticketRows = existingRows.filter((row) => row.ticketId === ticketId)
  const plan = planShopTicketContributions({ lines: lineInputs(lines), existing: contributionsOf(ticketRows), targets: [] })
  if (plan.blocked.length > 0) {
    throw new Error(
      `${ticket.ticketNumber} can't be taken off ${plan.blocked.map((row) => row.costCode).join(", ")}: ${plan.blocked[0]?.error ?? ""} Adjust the line first.`
    )
  }
  await runBatch(db, [
    ...planStatements(db, {
      applicationId,
      ticketId,
      lines,
      existingRows: ticketRows.filter((row) => row.mode === "imported"),
      plan,
      userId: null,
      now,
    }),
    deleteShopTicketImportsStatement(
      db,
      and(eq(payApplicationShopTicketImports.applicationId, applicationId), eq(payApplicationShopTicketImports.ticketId, ticketId))
    ),
    updateShopTicketsStatement(
      db,
      and(eq(shopTickets.id, ticketId), eq(shopTickets.projectId, projectId), eq(shopTickets.budgetApplicationId, applicationId)),
      { budgetApplicationId: null }
    ),
  ])
  await refreshOwnerPayApplication(db, projectId, applicationId, now)
}

/**
 * Marks a linked ticket "already included on this pay request": it counts
 * as billed here and won't be imported, and no line amount changes. Turning
 * the mark off lets the ticket be imported.
 */
export async function setShopTicketAlreadyIncluded(
  db: Db,
  input: {
    readonly projectId: string
    readonly applicationId: string
    readonly ticketId: string
    readonly included: boolean
    readonly userId: string | null
    readonly now: string
  }
): Promise<void> {
  const { projectId, applicationId, ticketId } = input
  await requireDraft(db, projectId, applicationId)
  const [tickets, existingRows] = await Promise.all([linkedTickets(db, projectId, applicationId), importRows(db, applicationId)])
  const ticket = tickets.find((row) => row.id === ticketId)
  if (!ticket) throw new Error("That shop ticket isn't on this pay application.")
  const ticketRows = existingRows.filter((row) => row.ticketId === ticketId)
  const markWhere = and(
    eq(payApplicationShopTicketImports.applicationId, applicationId),
    eq(payApplicationShopTicketImports.ticketId, ticketId),
    eq(payApplicationShopTicketImports.mode, "already_included")
  )
  if (!input.included) {
    await runBatch(db, [deleteShopTicketImportsStatement(db, markWhere)])
    return
  }
  if (ticket.status !== "issued") throw new Error("Only an issued ticket can be marked as already included.")
  if (ticketRows.some((row) => row.mode === "imported")) {
    throw new Error(`${ticket.ticketNumber} was already imported onto the lines. Unlink it to take those amounts off first.`)
  }
  if (ticketRows.some((row) => row.mode === "already_included")) return
  await runBatch(
    db,
    insertShopTicketImportsStatements(db, [
      {
        id: crypto.randomUUID(),
        applicationId,
        ticketId,
        budgetLineId: null,
        amountCents: 0,
        mode: "already_included",
        createdBy: input.userId,
        createdAt: input.now,
      },
    ])
  )
}

type PayApplicationShopTicketBilling = {
  readonly id: string
  readonly ticketNumber: string
  readonly status: "draft" | "issued" | "void"
  readonly ticketDate: string
  readonly laborFrom: string | null
  readonly laborTo: string | null
  readonly totalCents: number
  /** What the ticket has added to this pay application's lines. */
  readonly importedCents: number
  /** What an import would still add (or, if negative, take off). */
  readonly pendingCents: number
  readonly alreadyIncluded: boolean
}

export type PayApplicationShopTicketState = {
  readonly tickets: readonly PayApplicationShopTicketBilling[]
  /** Issued tickets on the project not on any pay application yet. */
  readonly attachable: readonly { readonly id: string; readonly ticketNumber: string; readonly payApplicationNumber: number | null; readonly totalCents: number }[]
  /** Imported amounts on each G703 line and the tickets they came from. */
  readonly lineProvenance: readonly { readonly lineId: string; readonly amountCents: number; readonly ticketNumbers: readonly string[] }[]
  /** Ticket lines whose cost code has no G703 line; never imported. */
  readonly warnings: readonly string[]
  readonly editable: boolean
}

/**
 * Billing state for the pay application page: each linked ticket's import
 * status, the tickets that could be attached, line provenance and warnings.
 */
export async function loadPayApplicationShopTicketState(
  db: Db,
  projectId: string,
  applicationId: string
): Promise<PayApplicationShopTicketState> {
  const application = await loadApplication(db, projectId, applicationId)
  const editable = application?.status === "draft"
  const [tickets, existingRows, lines, attachable] = await Promise.all([
    db
      .select({
        id: shopTickets.id,
        ticketNumber: shopTickets.ticketNumber,
        status: shopTickets.status,
        ticketDate: shopTickets.ticketDate,
        laborFrom: shopTickets.laborFrom,
        laborTo: shopTickets.laborTo,
        totalCents: shopTickets.totalCents,
      })
      .from(shopTickets)
      .where(and(eq(shopTickets.projectId, projectId), eq(shopTickets.budgetApplicationId, applicationId)))
      .orderBy(asc(shopTickets.sequenceNumber)),
    importRows(db, applicationId),
    applicationLines(db, projectId, applicationId),
    editable
      ? db
          .select({
            id: shopTickets.id,
            ticketNumber: shopTickets.ticketNumber,
            payApplicationNumber: shopTickets.payApplicationNumber,
            totalCents: shopTickets.totalCents,
          })
          .from(shopTickets)
          .where(and(eq(shopTickets.projectId, projectId), eq(shopTickets.status, "issued"), isNull(shopTickets.budgetApplicationId)))
          .orderBy(asc(shopTickets.sequenceNumber))
      : Promise.resolve([]),
  ])
  const marked = new Set(existingRows.filter((row) => row.mode === "already_included").map((row) => row.ticketId))
  const importable = tickets.filter((ticket) => ticket.status === "issued" && !marked.has(ticket.id))
  const targets = shopTicketContributionTargets(lines, await ticketAmounts(db, importable.map((ticket) => ticket.id)))
  const sumByTicket = (rows: readonly ShopTicketContribution[]): Map<string, number> => {
    const map = new Map<string, number>()
    for (const row of rows) map.set(row.ticketId, (map.get(row.ticketId) ?? 0) + row.amountCents)
    return map
  }
  const contributions = contributionsOf(existingRows)
  const imported = sumByTicket(contributions)
  const target = sumByTicket(targets.contributions)
  const number = new Map(tickets.map((ticket) => [ticket.id, ticket.ticketNumber]))
  const provenance = new Map<string, { amountCents: number; ticketNumbers: string[] }>()
  for (const row of contributions) {
    const entry = provenance.get(row.budgetLineId) ?? { amountCents: 0, ticketNumbers: [] }
    entry.amountCents += row.amountCents
    const ticketNumber = number.get(row.ticketId)
    if (ticketNumber && !entry.ticketNumbers.includes(ticketNumber)) entry.ticketNumbers.push(ticketNumber)
    provenance.set(row.budgetLineId, entry)
  }
  return {
    tickets: tickets.map((ticket) => ({
      ...ticket,
      importedCents: imported.get(ticket.id) ?? 0,
      pendingCents: (target.get(ticket.id) ?? 0) - (imported.get(ticket.id) ?? 0),
      alreadyIncluded: marked.has(ticket.id),
    })),
    attachable,
    lineProvenance: [...provenance].map(([lineId, entry]) => ({ lineId, ...entry })),
    warnings: targets.unmatched.map(
      (row) =>
        `${number.get(row.ticketId) ?? "A ticket"}: ${row.costCode} (${formatCents(row.amountCents)}) has no line on this pay application and won't be imported.`
    ),
    editable,
  }
}
