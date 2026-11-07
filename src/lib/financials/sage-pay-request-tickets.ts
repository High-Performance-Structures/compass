import { and, asc, eq, inArray, isNull, notExists, or } from "drizzle-orm"

import { payApplicationShopTicketImports, shopTicketLines, shopTickets } from "@/db/schema-shop-tickets"
import { chunkD1Values } from "@/lib/d1-query"
import { deleteShopTicketImportsStatement, insertShopTicketImportsStatements, type Statement } from "@/lib/domain/budget/store"
import { shopTicketsCoveredBySage, type SyncedPayRequestLine, type UnbilledShopTicket } from "@/lib/domain/budget/sage-pay-request-rules"
import { updateShopTicketsStatement } from "@/lib/domain/operations/store"
import type { Db } from "@/lib/server/action-context"

/*
 * Shop tickets on pay requests built in Sage. Issued tickets that aren't
 * billed on any pay application yet are listed, with their amounts by cost
 * code, for whoever enters the billing in Sage. A ticket is ticked off by
 * marking it "already included" on the synced pay application (the existing
 * mode: no line amount changes). A Sage sync marks the tickets its billing
 * plainly covers; the rest wait for staff. Callers check access first.
 */

export type UnbilledShopTicketRow = {
  readonly id: string
  readonly ticketNumber: string
  readonly ticketDate: string
  readonly payApplicationNumber: number | null
  /** The pay application the ticket is linked to without being billed on it, if any. */
  readonly budgetApplicationId: string | null
  readonly totalCents: number
  readonly lines: readonly { readonly costCode: string; readonly amountCents: number }[]
}

/** Issued tickets on the project with nothing recorded on any pay application, oldest first. */
export async function loadUnbilledShopTickets(db: Db, projectId: string): Promise<readonly UnbilledShopTicketRow[]> {
  const tickets = await db
    .select({
      id: shopTickets.id,
      ticketNumber: shopTickets.ticketNumber,
      ticketDate: shopTickets.ticketDate,
      payApplicationNumber: shopTickets.payApplicationNumber,
      budgetApplicationId: shopTickets.budgetApplicationId,
      totalCents: shopTickets.totalCents,
    })
    .from(shopTickets)
    .where(
      and(
        eq(shopTickets.projectId, projectId),
        eq(shopTickets.status, "issued"),
        notExists(
          db
            .select({ id: payApplicationShopTicketImports.id })
            .from(payApplicationShopTicketImports)
            .where(eq(payApplicationShopTicketImports.ticketId, shopTickets.id))
        )
      )
    )
    .orderBy(asc(shopTickets.sequenceNumber))
  const lineRows = (
    await Promise.all(
      chunkD1Values(tickets.map((ticket) => ticket.id)).map((ids) =>
        db
          .select({ ticketId: shopTicketLines.ticketId, costCode: shopTicketLines.costCode, amountCents: shopTicketLines.amountCents })
          .from(shopTicketLines)
          .where(inArray(shopTicketLines.ticketId, ids))
      )
    )
  ).flat()
  return tickets.map((ticket) => {
    const byCode = new Map<string, number>()
    for (const line of lineRows) {
      if (line.ticketId !== ticket.id || line.amountCents === 0) continue
      byCode.set(line.costCode, (byCode.get(line.costCode) ?? 0) + line.amountCents)
    }
    return { ...ticket, lines: [...byCode].map(([costCode, amountCents]) => ({ costCode, amountCents })) }
  })
}

/** The statements that record a ticket as already included on a pay application (linking it there). */
function markStatements(db: Db, input: { readonly projectId: string; readonly applicationId: string; readonly ticketId: string; readonly userId: string | null; readonly now: string }): Statement[] {
  return [
    updateShopTicketsStatement(
      db,
      and(
        eq(shopTickets.id, input.ticketId),
        eq(shopTickets.projectId, input.projectId),
        or(isNull(shopTickets.budgetApplicationId), eq(shopTickets.budgetApplicationId, input.applicationId))
      ),
      { budgetApplicationId: input.applicationId }
    ),
    ...insertShopTicketImportsStatements(db, [
      {
        id: crypto.randomUUID(),
        applicationId: input.applicationId,
        ticketId: input.ticketId,
        budgetLineId: null,
        amountCents: 0,
        mode: "already_included",
        createdBy: input.userId,
        createdAt: input.now,
      },
    ]),
  ]
}

/**
 * Marks the unbilled tickets the synced Sage billing plainly covers as
 * already included on the pay application. Tickets linked to a different pay
 * application are left alone. Returns the ticket numbers marked.
 */
export async function markShopTicketsCoveredBySage(
  db: Db,
  input: {
    readonly projectId: string
    readonly applicationId: string
    readonly periodTo: string | null
    readonly lines: readonly SyncedPayRequestLine[]
    readonly userId: string | null
    readonly now: string
  }
): Promise<readonly string[]> {
  const unbilled = (await loadUnbilledShopTickets(db, input.projectId)).filter(
    (ticket) => ticket.budgetApplicationId === null || ticket.budgetApplicationId === input.applicationId
  )
  const candidates: UnbilledShopTicket[] = unbilled.map((ticket) => ({ id: ticket.id, ticketDate: ticket.ticketDate, lines: ticket.lines }))
  const covered = shopTicketsCoveredBySage(candidates, input.lines, input.periodTo)
  const marked = unbilled.filter((ticket) => covered.has(ticket.id))
  const statements = marked.flatMap((ticket) =>
    markStatements(db, { projectId: input.projectId, applicationId: input.applicationId, ticketId: ticket.id, userId: input.userId, now: input.now })
  )
  const [first, ...rest] = statements
  if (first) await db.batch([first, ...rest])
  return marked.map((ticket) => ticket.ticketNumber)
}

/**
 * Ticks (or unticks) a ticket on the checklist: entered in Sage on this pay
 * application. Unticking removes only the "already included" mark (and the
 * link the tick made); amounts imported in Compass are never touched here.
 */
export async function setShopTicketEnteredInSage(
  db: Db,
  input: {
    readonly projectId: string
    readonly applicationId: string
    readonly ticketId: string
    readonly entered: boolean
    readonly userId: string
    readonly now: string
  }
): Promise<{ readonly ticketNumber: string }> {
  const ticket = await db
    .select({ id: shopTickets.id, ticketNumber: shopTickets.ticketNumber, status: shopTickets.status, budgetApplicationId: shopTickets.budgetApplicationId })
    .from(shopTickets)
    .where(and(eq(shopTickets.id, input.ticketId), eq(shopTickets.projectId, input.projectId)))
    .get()
  if (!ticket) throw new Error("Shop ticket not found.")
  const rows = await db
    .select({ applicationId: payApplicationShopTicketImports.applicationId, mode: payApplicationShopTicketImports.mode })
    .from(payApplicationShopTicketImports)
    .where(eq(payApplicationShopTicketImports.ticketId, input.ticketId))
  if (!input.entered) {
    if (rows.some((row) => row.mode === "imported")) {
      throw new Error(`${ticket.ticketNumber} was imported onto a pay application's lines in Compass. Unlink it there instead.`)
    }
    const statements: Statement[] = [
      deleteShopTicketImportsStatement(
        db,
        and(
          eq(payApplicationShopTicketImports.applicationId, input.applicationId),
          eq(payApplicationShopTicketImports.ticketId, input.ticketId),
          eq(payApplicationShopTicketImports.mode, "already_included")
        )
      ),
      updateShopTicketsStatement(
        db,
        and(eq(shopTickets.id, input.ticketId), eq(shopTickets.budgetApplicationId, input.applicationId)),
        { budgetApplicationId: null }
      ),
    ]
    const [first, ...rest] = statements
    if (first) await db.batch([first, ...rest])
    return { ticketNumber: ticket.ticketNumber }
  }
  if (ticket.status !== "issued") throw new Error("Only an issued shop ticket can be ticked off.")
  if (rows.length > 0) throw new Error(`${ticket.ticketNumber} is already billed on a pay application.`)
  if (ticket.budgetApplicationId !== null && ticket.budgetApplicationId !== input.applicationId) {
    throw new Error(`${ticket.ticketNumber} is linked to another pay application. Unlink it there first.`)
  }
  const [first, ...rest] = markStatements(db, input)
  if (first) await db.batch([first, ...rest])
  return { ticketNumber: ticket.ticketNumber }
}
