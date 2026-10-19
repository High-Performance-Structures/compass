import Link from "next/link"

import type { PayApplicationShopTickets as Data } from "@/app/actions/shop-ticket-billing"
import { ContextualHelpBeacon } from "@/components/help/contextual-help-beacon"
import { formatCents } from "@/lib/shop-tickets/model"

const STATUS_LABEL = { draft: "Draft", issued: "Issued", void: "Void" } as const

/**
 * Shop tickets billed on this pay application: each ticket, and issued
 * tickets' amounts by cost code to carry into the matching lines.
 */
export function PayApplicationShopTickets({ projectId, data }: { readonly projectId: string; readonly data: Data }): React.ReactElement {
  const href = `/dashboard/projects/${encodeURIComponent(projectId)}/shop-tickets`
  return (
    <section aria-labelledby="pay-app-shop-tickets" className="clarity-panel mt-5 grid gap-3 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 id="pay-app-shop-tickets" className="font-semibold">
            Shop tickets
          </h2>
          <ContextualHelpBeacon topicId="shop.tickets.pay-application" />
        </div>
        <Link href={href} className="text-sm underline underline-offset-2">
          Open shop tickets
        </Link>
      </div>
      {data.tickets.length === 0 ? (
        <p className="text-sm text-muted-foreground">No shop tickets are billed on this pay application.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-2 font-medium">Ticket</th>
                <th className="py-2 pr-2 font-medium">Labor dates</th>
                <th className="py-2 pr-2 font-medium">Status</th>
                <th className="py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.tickets.map((ticket) => (
                <tr key={ticket.id} className="border-b">
                  <td className="py-2 pr-2 font-medium">{ticket.ticketNumber}</td>
                  <td className="py-2 pr-2 tabular-nums text-muted-foreground">
                    {ticket.laborFrom && ticket.laborTo ? `${ticket.laborFrom} – ${ticket.laborTo}` : ticket.ticketDate}
                  </td>
                  <td className="py-2 pr-2">{STATUS_LABEL[ticket.status]}</td>
                  <td className={ticket.status === "issued" ? "py-2 text-right tabular-nums" : "py-2 text-right tabular-nums text-muted-foreground line-through"}>
                    {formatCents(ticket.totalCents)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="py-2 pr-2 text-right font-semibold">
                  Issued total
                </td>
                <td className="py-2 text-right font-semibold tabular-nums">{formatCents(data.issuedTotalCents)}</td>
              </tr>
            </tfoot>
          </table>
          {data.byCostCode.length > 0 ? (
            <table className="w-full text-sm">
              <caption className="pb-2 text-left text-xs text-muted-foreground">Issued tickets by cost code</caption>
              <tbody>
                {data.byCostCode.map((row) => (
                  <tr key={row.costCode} className="border-b">
                    <td className="py-2 pr-2">
                      <span className="font-medium">{row.costCode}</span> <span className="text-muted-foreground">{row.description}</span>
                    </td>
                    <td className="py-2 text-right tabular-nums">{formatCents(row.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      )}
    </section>
  )
}
