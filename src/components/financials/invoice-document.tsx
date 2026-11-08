import type * as React from "react"

import { ProjectBrandContactDetails } from "@/components/projects/project-brand-contact-details"
import { ProjectBrandLogo } from "@/components/projects/project-brand-logo"
import { formatCents, formatDate } from "@/lib/format"
import type { InvoiceDocumentData } from "@/lib/financials/simple-invoice-document-types"
import type { ProjectBrand } from "@/lib/project-branding"

/** The printed invoice sent to the customer (Print Preview and the emailed PDF). */
export function InvoiceDocument({ brand, invoice }: { readonly brand: ProjectBrand; readonly invoice: InvoiceDocumentData }): React.ReactElement {
  const balance = Math.max(0, invoice.totalCents - invoice.amountPaidCents)
  const anyTaxable = invoice.lines.some((line) => line.taxable)
  return (
    <div data-invoice-document>
      <div className="flex items-start justify-between border-b-2 border-black pb-4">
        <div className="flex items-center gap-3">
          <ProjectBrandLogo brand={brand} size={64} className="h-16 w-16 shrink-0 object-contain" />
          <div>
            <p className="text-sm font-bold uppercase">{brand.companyName}</p>
            <ProjectBrandContactDetails brand={brand} />
          </div>
        </div>
        <div className="text-right">
          <h1 className="text-3xl font-bold uppercase tracking-wide">{invoice.status === "void" ? (invoice.creditMemo ? "Void credit memo" : "Void invoice") : invoice.creditMemo ? "Credit memo" : "Invoice"}</h1>
          <p className="mt-2 text-sm font-semibold">{invoice.invoiceNumber ?? "Draft"}</p>
          <p>Date: {formatDate(invoice.issueDate)}</p>
          {invoice.creditMemo ? null : <p>Due: {invoice.dueDate ? formatDate(invoice.dueDate) : "Upon receipt"}</p>}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 text-sm">
        <div className="border border-black">
          <div className="border-b border-black px-2 py-1 text-xs font-bold uppercase">Bill to</div>
          <div className="min-h-20 p-2">
            <p className="font-semibold">{invoice.billTo.name ?? "Customer"}</p>
            {invoice.billTo.address && <p className="whitespace-pre-line">{invoice.billTo.address}</p>}
          </div>
        </div>
        <div className="border border-black">
          <div className="border-b border-black px-2 py-1 text-xs font-bold uppercase">Project</div>
          <div className="min-h-20 p-2">
            <p className="font-semibold">{invoice.project.name}</p>
            {invoice.project.projectNumber && <p>Project {invoice.project.projectNumber}</p>}
            {invoice.project.address && <p className="whitespace-pre-line">{invoice.project.address}</p>}
          </div>
        </div>
      </div>

      {invoice.title && <p className="mt-4 text-sm font-semibold">{invoice.title}</p>}

      <table className="mt-4 w-full border-collapse text-sm">
        <thead>
          <tr className="border-y-2 border-black text-left text-xs uppercase">
            <th className="py-2">Description</th>
            <th className="py-2 text-right">Qty</th>
            <th className="py-2 text-right">Unit price</th>
            {anyTaxable && <th className="py-2 text-center">Tax</th>}
            <th className="py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((line) => (
            <tr key={line.id} className="border-b border-black align-top">
              <td className="py-2 pr-2">{line.description}</td>
              <td className="py-2 text-right tabular-nums">
                {line.quantity} {line.unit}
              </td>
              <td className="py-2 text-right tabular-nums">{formatCents(line.unitPriceCents)}</td>
              {anyTaxable && <td className="py-2 text-center">{line.taxable ? "T" : ""}</td>}
              <td className="py-2 text-right tabular-nums">{formatCents(line.amountCents)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={anyTaxable ? 4 : 3} className="pt-3 text-right">Subtotal</td>
            <td className="pt-3 text-right tabular-nums">{formatCents(invoice.subtotalCents)}</td>
          </tr>
          {invoice.taxCents !== 0 && (
            <tr>
              <td colSpan={anyTaxable ? 4 : 3} className="py-1 text-right">Sales tax{invoice.taxDistrictName ? ` (${invoice.taxDistrictName})` : ""}</td>
              <td className="py-1 text-right tabular-nums">{formatCents(invoice.taxCents)}</td>
            </tr>
          )}
          <tr>
            <td colSpan={anyTaxable ? 4 : 3} className="py-1 text-right font-bold">Total</td>
            <td className="py-1 text-right font-bold tabular-nums">{formatCents(invoice.totalCents)}</td>
          </tr>
          {invoice.amountPaidCents > 0 && (
            <tr>
              <td colSpan={anyTaxable ? 4 : 3} className="py-1 text-right">Paid</td>
              <td className="py-1 text-right tabular-nums">{formatCents(-invoice.amountPaidCents)}</td>
            </tr>
          )}
          <tr>
            <td colSpan={anyTaxable ? 4 : 3} className="py-2 text-right text-base font-bold uppercase">{invoice.creditMemo ? "Credit total" : "Balance due"}</td>
            <td className="py-2 text-right text-lg font-bold tabular-nums">{formatCents(invoice.status === "void" ? 0 : balance)}</td>
          </tr>
        </tfoot>
      </table>
      {anyTaxable && <p className="mt-1 text-xs">T = taxable</p>}

      {invoice.squarePublicUrl && invoice.status !== "void" && (
        <section className="mt-6 border-2 border-black p-3 text-sm">
          <p className="font-bold uppercase">Pay online</p>
          <p className="mt-1 break-all">{invoice.squarePublicUrl}</p>
        </section>
      )}

      {invoice.memo && (
        <section className="mt-6 text-sm">
          <h2 className="border-b border-black pb-1 text-xs font-bold uppercase">Notes</h2>
          <p className="mt-2 whitespace-pre-wrap leading-6">{invoice.memo}</p>
        </section>
      )}

      <p className="mt-8 text-sm">
        Please make payment to {brand.companyName}, referencing invoice {invoice.invoiceNumber ?? ""}.
      </p>
    </div>
  )
}
