import type * as React from "react"
import { ProjectBrandContactDetails } from "@/components/projects/project-brand-contact-details"
import { ProjectBrandLogo } from "@/components/projects/project-brand-logo"
import type { ProjectBrand } from "@/lib/project-branding"
import { formatPurchaseOrderMoney } from "@/lib/purchase-orders/money"

export type PurchaseOrderDocumentLine = {
  readonly id: string
  readonly lineNumber: number
  readonly description: string
  readonly phaseCode: string | null
  readonly costCode: string | null
  readonly quantity: number
  readonly unit: string | null
  readonly unitCost: number
  readonly amount: number
}

export type PurchaseOrderDocumentData = {
  readonly sourceRecordNumber: string | null
  readonly sageOrderDate: string | null
  readonly dueDate: string | null
  readonly companyName: string | null
  readonly vendorAddress: string | null
  readonly assigneeName: string | null
  readonly siteContactPhone: string | null
  readonly amount: number | null
  readonly title: string
  readonly description: string | null
  readonly lines: readonly PurchaseOrderDocumentLine[]
}

function formatDate(value: string | null): string {
  if (!value) return "No due date"
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

/**
 * The printed purchase order (pickup copy) with the department's logo. The
 * PO page prints it, and the project paper trail saves it to Drive, so both
 * always match.
 */
export function PurchaseOrderDocument({
  brand,
  order,
  projectLabel,
  deliveryLocation,
}: {
  readonly brand: ProjectBrand
  readonly order: PurchaseOrderDocumentData
  readonly projectLabel: string
  readonly deliveryLocation: string | null
}): React.ReactElement {
  return (
    <>
      <div className="flex items-start justify-between border-b-2 border-black pb-4">
        <div className="flex items-center gap-3">
          <ProjectBrandLogo
            brand={brand}
            size={64}
            className="h-16 w-16 shrink-0 object-contain"
          />
          <div>
            <p className="text-sm font-bold uppercase">
              {brand.companyName}
            </p>
            <ProjectBrandContactDetails brand={brand} />
          </div>
        </div>
        <div className="text-right">
          <h1 className="text-3xl font-bold uppercase tracking-wide">
            Purchase Order
          </h1>
          <p className="mt-2 text-sm font-semibold">
            {order.sourceRecordNumber ?? "Unnumbered"}
          </p>
          <p>P.O. Date: {formatDate(order.sageOrderDate)}</p>
          <p>Required By: {formatDate(order.dueDate)}</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <div className="border border-black">
          <div className="border-b border-black px-2 py-1 text-xs font-bold uppercase">
            Vendor
          </div>
          <div className="min-h-20 p-2">
            <p className="font-semibold">{order.companyName ?? "Vendor TBD"}</p>
            {order.vendorAddress && (
              <p className="whitespace-pre-line">{order.vendorAddress}</p>
            )}
          </div>
        </div>
        <div className="border border-black">
          <div className="border-b border-black px-2 py-1 text-xs font-bold uppercase">
            Project / Delivery
          </div>
          <div className="min-h-20 p-2">
            <p className="font-semibold">{projectLabel}</p>
            <p className="mt-2 text-[10px] font-bold uppercase">
              Delivery Location
            </p>
            <p className="whitespace-pre-line font-medium">
              {deliveryLocation ?? "TBD"}
            </p>
            <p>Site Contact: {order.assigneeName ?? "TBD"}</p>
            <p>Phone: {order.siteContactPhone ?? "TBD"}</p>
          </div>
        </div>
      </div>

      <div className="mt-4 border border-black">
        <table className="purchase-order-items w-full table-fixed border-collapse">
          <colgroup>
            <col className="w-10" />
            <col />
            <col className="w-[4.5rem]" />
            <col className="w-20" />
            <col className="w-16" />
            <col className="w-16" />
            <col className="w-[5.5rem]" />
            <col className="w-24" />
          </colgroup>
          <thead data-purchase-order-items-header="true">
            <tr className="border-b border-black text-xs font-bold uppercase">
              <th className="px-2 py-1 text-left">Line</th>
              <th className="px-2 py-1 text-left">Description</th>
              <th className="px-2 py-1 text-left">Phase</th>
              <th className="px-2 py-1 text-left">Cost Code</th>
              <th className="px-2 py-1 text-right">Qty</th>
              <th className="px-2 py-1 text-left">Unit</th>
              <th className="px-2 py-1 text-right">Unit Cost</th>
              <th className="px-2 py-1 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((line) => (
              <tr
                key={line.id}
                data-purchase-order-line="true"
                className="h-9 border-t border-black align-top"
              >
                <td className="px-2 py-1">{line.lineNumber}</td>
                <td className="px-2 py-1">{line.description}</td>
                <td className="px-2 py-1">{line.phaseCode ?? "-"}</td>
                <td className="px-2 py-1">{line.costCode ?? "-"}</td>
                <td className="px-2 py-1 text-right">{line.quantity}</td>
                <td className="px-2 py-1">{line.unit ?? "-"}</td>
                <td className="px-2 py-1 text-right">
                  {formatPurchaseOrderMoney(line.unitCost)}
                </td>
                <td className="px-2 py-1 text-right font-semibold">
                  {formatPurchaseOrderMoney(line.amount)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-black text-sm font-bold">
              <td colSpan={7} className="px-2 py-2 text-right">
                Total
              </td>
              <td className="px-2 py-2 text-right">{formatPurchaseOrderMoney(order.amount)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="mt-4 border border-black">
        <div className="border-b border-black px-2 py-1 text-xs font-bold uppercase">
          Notes / Instructions
        </div>
        <div className="min-h-16 p-2">
          <p>{order.title}</p>
          {order.description && <p className="mt-1">{order.description}</p>}
        </div>
      </div>

      <div
        data-purchase-order-signatures="true"
        className="mt-10 grid grid-cols-4 gap-6 text-xs"
      >
        <div className="border-t border-black pt-2">Authorized By</div>
        <div className="border-t border-black pt-2">Vendor Signature</div>
        <div className="border-t border-black pt-2">Picked Up By</div>
        <div className="border-t border-black pt-2">Date</div>
      </div>
    </>
  )
}
