import { loadProjectCostCodeCatalog, loadProjectCostCodeChoices, loadProjectBudgetCostCodes } from "@/lib/cost-codes/catalog-server"
import { and, asc, desc, eq, inArray, max } from "drizzle-orm"
import type { getDb } from "@/db"
import { projectBudgetApplications, projects } from "@/db/schema"
import { rateBookEntries } from "@/db/schema-rate-book"
import { shopTicketLines, shopTickets, type ShopTicket, type ShopTicketLine } from "@/db/schema-shop-tickets"
import type { ShopTicketRates } from "@/lib/shop-tickets/model"

type Db = ReturnType<typeof getDb>

export type ShopTicketProject = {
  readonly id: string
  readonly projectNumber: string | null
  readonly name: string
  readonly clientName: string | null
  readonly address: string | null
}

export type ShopTicketCostCodeOption = { readonly code: string; readonly description: string }

export type ShopTicketPayApplicationOption = {
  readonly id: string
  readonly number: number | null
  readonly periodTo: string | null
}

export type ShopTicketWithLines = ShopTicket & { readonly lines: readonly ShopTicketLine[] }

export async function loadShopTicketProject(db: Db, organizationId: string, projectId: string): Promise<ShopTicketProject | null> {
  const [project] = await db
    .select({
      id: projects.id,
      projectNumber: projects.projectNumber,
      name: projects.name,
      clientName: projects.clientName,
      address: projects.address,
    })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
    .limit(1)
  return project ?? null
}

/** The company's active labor and machine rates, by name; each line picks one. */
export async function loadShopTicketRates(db: Db, organizationId: string): Promise<ShopTicketRates> {
  const rows = await db
    .select({
      id: rateBookEntries.id,
      name: rateBookEntries.name,
      category: rateBookEntries.category,
      unitCostCents: rateBookEntries.unitCostCents,
      costCode: rateBookEntries.costCode,
      costCodeName: rateBookEntries.costCodeName,
    })
    .from(rateBookEntries)
    .where(
      and(
        eq(rateBookEntries.organizationId, organizationId),
        eq(rateBookEntries.status, "active"),
        inArray(rateBookEntries.category, ["labor", "machine"]),
      ),
    )
    .orderBy(asc(rateBookEntries.name))
  return rows.flatMap((row) =>
    row.category === "labor" || row.category === "machine"
      ? [{ rateBookEntryId: row.id, kind: row.category, name: row.name, rateCents: row.unitCostCents, costCode: row.costCode, costCodeName: row.costCodeName }]
      : [],
  )
}

export async function loadCostCodeOptions(db: Db, projectId?: string): Promise<readonly ShopTicketCostCodeOption[]> {
  const rows = await (projectId ? loadProjectCostCodeChoices(db, projectId) : loadProjectCostCodeCatalog(db))
  return rows
}

/** Cost codes on the project's budget; empty when the project has no budget. */
export async function loadBudgetCostCodes(db: Db, projectId: string): Promise<readonly string[]> {
  return (await loadProjectBudgetCostCodes(db, projectId)).map((row) => row.costCode)
}

export async function loadPayApplicationOptions(db: Db, projectId: string): Promise<readonly ShopTicketPayApplicationOption[]> {
  const rows = await db
    .select({
      id: projectBudgetApplications.id,
      number: projectBudgetApplications.applicationNumber,
      periodTo: projectBudgetApplications.periodTo,
    })
    .from(projectBudgetApplications)
    .where(eq(projectBudgetApplications.projectId, projectId))
    .orderBy(desc(projectBudgetApplications.periodTo))
  return rows.map((row) => {
    const parsed = Number.parseInt(row.number, 10)
    return { id: row.id, number: Number.isFinite(parsed) ? parsed : null, periodTo: row.periodTo }
  })
}

export async function loadProjectShopTickets(db: Db, projectId: string): Promise<readonly ShopTicketWithLines[]> {
  const tickets = await db
    .select()
    .from(shopTickets)
    .where(eq(shopTickets.projectId, projectId))
    .orderBy(desc(shopTickets.sequenceNumber))
  if (tickets.length === 0) return []
  const lines = await db
    .select()
    .from(shopTicketLines)
    .where(inArray(shopTicketLines.ticketId, tickets.map((ticket) => ticket.id)))
    .orderBy(asc(shopTicketLines.lineNumber))
  return tickets.map((ticket) => ({ ...ticket, lines: lines.filter((line) => line.ticketId === ticket.id) }))
}

export async function loadShopTicket(db: Db, ticketId: string): Promise<ShopTicketWithLines | null> {
  const [ticket] = await db.select().from(shopTickets).where(eq(shopTickets.id, ticketId)).limit(1)
  if (!ticket) return null
  const lines = await db
    .select()
    .from(shopTicketLines)
    .where(eq(shopTicketLines.ticketId, ticketId))
    .orderBy(asc(shopTicketLines.lineNumber))
  return { ...ticket, lines }
}

export async function highestTicketSequence(db: Db, organizationId: string): Promise<number | null> {
  const [row] = await db
    .select({ highest: max(shopTickets.sequenceNumber) })
    .from(shopTickets)
    .where(eq(shopTickets.organizationId, organizationId))
  return row?.highest ?? null
}
