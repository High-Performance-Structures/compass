"use server"

import { and, asc, eq, inArray } from "drizzle-orm"

import { shopTicketLines, shopTickets } from "@/db/schema-shop-tickets"
import { requireOrg } from "@/lib/org-scope"
import { canFeature } from "@/lib/permission-enforcement"
import { requireUserContext } from "@/lib/server/action-context"

type PayApplicationShopTicket = {
  readonly id: string
  readonly ticketNumber: string
  readonly status: "draft" | "issued" | "void"
  readonly ticketDate: string
  readonly laborFrom: string | null
  readonly laborTo: string | null
  readonly totalCents: number
}

export type PayApplicationShopTickets = {
  readonly tickets: readonly PayApplicationShopTicket[]
  /** Issued tickets' amounts by cost code; drafts and void tickets don't count. */
  readonly byCostCode: readonly { readonly costCode: string; readonly description: string; readonly amountCents: number }[]
  readonly issuedTotalCents: number
}

/**
 * Shop tickets billed on a pay application, for its page. Null when the
 * person can't see shop tickets.
 */
export async function getPayApplicationShopTickets(projectId: string, applicationId: string): Promise<PayApplicationShopTickets | null> {
  const { user, db } = await requireUserContext()
  if (!(await canFeature(user, "shop-tickets", "read"))) return null
  const orgId = requireOrg(user)
  const tickets = await db
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
    .where(
      and(
        eq(shopTickets.organizationId, orgId),
        eq(shopTickets.projectId, projectId),
        eq(shopTickets.budgetApplicationId, applicationId),
      ),
    )
    .orderBy(asc(shopTickets.sequenceNumber))
  const issued = tickets.filter((ticket) => ticket.status === "issued").map((ticket) => ticket.id)
  const lines =
    issued.length === 0
      ? []
      : await db
          .select({ costCode: shopTicketLines.costCode, description: shopTicketLines.description, amountCents: shopTicketLines.amountCents })
          .from(shopTicketLines)
          .where(inArray(shopTicketLines.ticketId, issued))
  const byCode = new Map<string, { costCode: string; description: string; amountCents: number }>()
  for (const line of lines) {
    const entry = byCode.get(line.costCode) ?? { costCode: line.costCode, description: line.description, amountCents: 0 }
    entry.amountCents += line.amountCents
    byCode.set(line.costCode, entry)
  }
  return {
    tickets,
    byCostCode: [...byCode.values()].sort((a, b) => a.costCode.localeCompare(b.costCode)),
    issuedTotalCents: tickets.filter((ticket) => ticket.status === "issued").reduce((sum, ticket) => sum + ticket.totalCents, 0),
  }
}
