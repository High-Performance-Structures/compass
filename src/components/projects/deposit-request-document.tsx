import type * as React from "react"

import { ProjectBrandContactDetails } from "@/components/projects/project-brand-contact-details"
import { ProjectBrandLogo } from "@/components/projects/project-brand-logo"
import type { DepositRequestDocumentData } from "@/lib/deposits/deposit-requests"
import type { ProjectBrand } from "@/lib/project-branding"

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100)
}

function formatDate(value: string | null, fallback: string): string {
  if (!value) return fallback
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
}

/** The printed deposit request sent to the client, with the department's logo. */
export function DepositRequestDocument({
  brand,
  request,
}: {
  readonly brand: ProjectBrand
  readonly request: DepositRequestDocumentData
}): React.ReactElement {
  const { project } = request
  return (
    <>
      <div className="flex items-start justify-between border-b-2 border-black pb-4">
        <div className="flex items-center gap-3">
          <ProjectBrandLogo brand={brand} size={64} className="h-16 w-16 shrink-0 object-contain" />
          <div>
            <p className="text-sm font-bold uppercase">{brand.companyName}</p>
            <ProjectBrandContactDetails brand={brand} />
          </div>
        </div>
        <div className="text-right">
          <h1 className="text-3xl font-bold uppercase tracking-wide">Deposit Request</h1>
          <p className="mt-2 text-sm font-semibold">{request.number}</p>
          <p>Date: {formatDate(request.requestedAt, "Not dated")}</p>
          <p>Due: {formatDate(request.dueDate, "Upon receipt")}</p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 text-sm">
        <div className="border border-black">
          <div className="border-b border-black px-2 py-1 text-xs font-bold uppercase">Bill to</div>
          <div className="min-h-20 p-2">
            <p className="font-semibold">{project.clientName ?? "Project client"}</p>
            {project.mailingAddress && <p className="whitespace-pre-line">{project.mailingAddress}</p>}
          </div>
        </div>
        <div className="border border-black">
          <div className="border-b border-black px-2 py-1 text-xs font-bold uppercase">Project</div>
          <div className="min-h-20 p-2">
            <p className="font-semibold">{project.name}</p>
            {project.projectNumber && <p>Project {project.projectNumber}</p>}
            {project.address && <p className="whitespace-pre-line">{project.address}</p>}
          </div>
        </div>
      </div>

      <table className="mt-6 w-full border-collapse text-sm">
        <thead>
          <tr className="border-y-2 border-black text-left text-xs uppercase">
            <th className="py-2">Description</th>
            <th className="py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-black">
            <td className="py-3">Contract deposit</td>
            <td className="py-3 text-right tabular-nums">{money(request.amountCents)}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td className="py-3 text-right font-bold uppercase">Amount due</td>
            <td className="py-3 text-right text-lg font-bold tabular-nums">
              {request.status === "received" ? money(0) : money(request.amountCents)}
            </td>
          </tr>
        </tfoot>
      </table>

      {request.status === "received" && (
        <p className="mt-2 border-2 border-black px-3 py-2 text-center text-sm font-bold uppercase">
          Paid{request.receivedAt ? ` ${formatDate(request.receivedAt, "")}` : ""} · Thank you
        </p>
      )}

      {request.message && (
        <section className="mt-6 text-sm">
          <h2 className="border-b border-black pb-1 text-xs font-bold uppercase">Notes</h2>
          <p className="mt-2 whitespace-pre-wrap leading-6">{request.message}</p>
        </section>
      )}

      <p className="mt-8 text-sm">
        Please make payment to {brand.companyName}, referencing {request.number}. The deposit is applied to the project&apos;s
        pay applications.
      </p>
    </>
  )
}
