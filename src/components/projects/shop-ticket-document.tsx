import type * as React from "react"
import { ProjectBrandLogo } from "@/components/projects/project-brand-logo"
import type { ShopTicketStatus } from "@/db/schema-shop-tickets"
import type { ProjectBrand } from "@/lib/project-branding"
import { formatCents, payApplicationLabel } from "@/lib/shop-tickets/model"

export type ShopTicketDocumentData = {
  readonly ticketNumber: string
  readonly status: ShopTicketStatus
  readonly ticketDate: string
  readonly laborFrom: string | null
  readonly laborTo: string | null
  readonly payApplicationNumber: number | null
  readonly payApplicationMonth: string | null
  readonly projectNumber: string | null
  readonly clientName: string | null
  readonly address: string | null
  readonly totalCents: number
  readonly voidReason: string | null
  readonly lines: readonly {
    readonly id: string
    readonly costCode: string
    readonly description: string
    readonly hours: number
    readonly rateCents: number
    readonly amountCents: number
  }[]
}

function formatDate(value: string | null): string {
  if (!value) return ""
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

/** "2684 County Ln 7, Olney Springs, CO 81062" → street line and city line. */
function addressLines(address: string | null): readonly string[] {
  if (!address) return []
  const [street, ...rest] = address.split(",").map((part) => part.trim()).filter(Boolean)
  return [street ?? "", rest.join(", ")].filter(Boolean)
}

/**
 * The printed shop ticket, in the layout of the sheet it replaces. The ticket
 * page prints it and the project paper trail saves it to Drive.
 */
export function ShopTicketDocument({
  brand,
  title,
  subtitle,
  ticket,
}: {
  readonly brand: ProjectBrand
  readonly title: string
  readonly subtitle: string
  readonly ticket: ShopTicketDocumentData
}): React.ReactElement {
  const drawLabel = payApplicationLabel(ticket.payApplicationNumber, ticket.payApplicationMonth)
  const laborDates =
    ticket.laborFrom && ticket.laborTo ? `${formatDate(ticket.laborFrom)} – ${formatDate(ticket.laborTo)}` : null
  return (
    <div className="relative">
      {ticket.status === "void" ? (
        <div
          aria-label="Void"
          className="pointer-events-none absolute inset-x-0 top-40 flex justify-center text-[96px] font-bold tracking-widest text-black/15"
        >
          VOID
        </div>
      ) : null}
      <div className="flex items-start justify-between gap-6">
        <div>
          <div className="flex items-center gap-3">
            <ProjectBrandLogo brand={brand} size={64} className="h-16 w-16 shrink-0 object-contain" />
            <div>
              <p className="text-2xl font-bold">{brand.legalName || brand.companyName}</p>
              {subtitle ? <p className="text-xs">{subtitle}</p> : null}
            </div>
          </div>
          <div className="mt-3 text-xs">
            {brand.mailingAddress.length > 0 ? <p>Mailing Address: {brand.mailingAddress.join(", ")}</p> : null}
            <p>{[brand.telephone, brand.email].filter(Boolean).join(" * ")}</p>
          </div>
        </div>
        <table className="w-56 shrink-0 border-collapse text-xs">
          <tbody>
            <tr>
              <th className="border border-black px-2 py-1 text-left text-sm">{title}</th>
              <td className="border border-black px-2 py-1 text-center">{ticket.ticketNumber}</td>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1">Date</td>
              <td className="border border-black px-2 py-1 text-center">{formatDate(ticket.ticketDate)}</td>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1">Project No</td>
              <td className="border border-black px-2 py-1 text-center">{ticket.projectNumber ?? ""}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mt-6 max-w-sm text-sm">
        <p className="text-xs font-bold">Project Address</p>
        {[ticket.clientName ?? "", ...addressLines(ticket.address)].filter(Boolean).map((line) => (
          <p key={line} className="border-b border-black py-0.5">
            {line}
          </p>
        ))}
      </div>

      <table className="mt-6 w-full border-collapse text-xs">
        <thead>
          <tr>
            <th className="border border-black px-2 py-1 text-left">Description</th>
            <th className="w-20 border border-black px-2 py-1 text-right">Qty</th>
            <th className="w-24 border border-black px-2 py-1 text-right">Rate</th>
            <th className="w-28 border border-black px-2 py-1 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {ticket.lines.map((line) => (
            <tr key={line.id}>
              <td className="border border-black px-2 py-1">
                {line.costCode} - {line.description}
              </td>
              <td className="border border-black px-2 py-1 text-right tabular-nums">{line.hours.toFixed(2)}</td>
              <td className="border border-black px-2 py-1 text-right tabular-nums">{formatCents(line.rateCents)}</td>
              <td className="border border-black px-2 py-1 text-right tabular-nums">{formatCents(line.amountCents)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td />
            <td colSpan={2} className="border border-black px-2 py-1 text-center font-bold">
              Grand Total
            </td>
            <td className="border border-black px-2 py-1 text-right font-bold tabular-nums">{formatCents(ticket.totalCents)}</td>
          </tr>
        </tfoot>
      </table>

      <p className="mt-4 text-xs">{[laborDates ? `Labor dates ${laborDates}` : null, drawLabel].filter(Boolean).join(" · ")}</p>
      {ticket.status === "void" && ticket.voidReason ? <p className="mt-2 text-xs font-bold">Void: {ticket.voidReason}</p> : null}
    </div>
  )
}
