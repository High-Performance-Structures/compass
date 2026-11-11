import type * as React from "react"

import { ProjectBrandContactDetails } from "@/components/projects/project-brand-contact-details"
import { ProjectBrandLogo } from "@/components/projects/project-brand-logo"
import type { BtProposalGroupView } from "@/lib/buildertrend/lead-proposal"
import type { BtProposalView } from "@/lib/buildertrend/lead-proposals-server"
import { formatCents, formatDate } from "@/lib/format"
import type { ProjectBrand } from "@/lib/project-branding"

/*
 * A Buildertrend proposal printed as the customer saw it (Print Preview):
 * introduction, groups and items with owner-facing columns only, totals,
 * closing text and the approval line. Builder cost, markup and internal
 * notes never appear here.
 */

function Paragraphs({ text }: { readonly text: string | null }): React.ReactElement | null {
  if (!text?.trim()) return null
  return (
    <div className="mt-4 space-y-2 text-sm">
      {text.split(/\n{2,}/).map((paragraph, index) => (
        <p key={index} className="whitespace-pre-line">{paragraph}</p>
      ))}
    </div>
  )
}

function GroupRows({ group, depth }: { readonly group: BtProposalGroupView; readonly depth: number }): React.ReactElement {
  return (
    <>
      <tr className="border-b border-black align-top">
        <td colSpan={4} className={depth === 0 ? "pt-3 pb-1 font-bold" : "pt-2 pb-1 pl-3 font-semibold"}>
          {group.title}
          {group.description ? <p className="whitespace-pre-line font-normal">{group.description}</p> : null}
        </td>
        <td className="pt-3 pb-1 text-right font-semibold tabular-nums whitespace-nowrap">{formatCents(group.ownerPriceCents)}</td>
      </tr>
      {group.items.map((item, index) => (
        <tr key={`${item.title}-${index}`} className="border-b border-black/40 align-top">
          <td className={depth === 0 ? "py-1 pr-2 pl-3" : "py-1 pr-2 pl-6"}>{item.title}</td>
          <td className="py-1 pr-2 whitespace-pre-line">{item.description ?? ""}</td>
          <td className="py-1 text-right tabular-nums whitespace-nowrap">{item.quantity}</td>
          <td className="py-1 pl-2">{item.unit ?? ""}</td>
          <td className="py-1 text-right tabular-nums whitespace-nowrap">{formatCents(item.ownerPriceCents)}</td>
        </tr>
      ))}
      {group.subGroups.map((sub, index) => (
        <GroupRows key={`${sub.title}-${index}`} group={sub} depth={depth + 1} />
      ))}
    </>
  )
}

function approvalLine(proposal: BtProposalView): string | null {
  const when = proposal.statusDate ? ` on ${formatDate(proposal.statusDate)}` : ""
  if (proposal.status === "approved" || proposal.status === "approved_not_released") {
    return `Approved${proposal.approvedByName ? ` by ${proposal.approvedByName}` : ""}${when}`
  }
  if (proposal.status === "declined" || proposal.status === "declined_not_released") {
    return `Declined${proposal.approvedByName ? ` by ${proposal.approvedByName}` : ""}${when}`
  }
  return null
}

export function BtProposalDocument({
  brand,
  proposal,
  project,
}: {
  readonly brand: ProjectBrand
  readonly proposal: BtProposalView
  readonly project: { readonly name: string; readonly projectNumber: string | null; readonly address: string | null }
}): React.ReactElement {
  const approval = approvalLine(proposal)
  return (
    <div data-bt-proposal-document>
      <div className="flex items-start justify-between border-b-2 border-black pb-4">
        <div className="flex items-center gap-3">
          <ProjectBrandLogo brand={brand} size={64} className="h-16 w-16 shrink-0 object-contain" />
          <div>
            <p className="text-sm font-bold uppercase">{brand.companyName}</p>
            <ProjectBrandContactDetails brand={brand} />
          </div>
        </div>
        <div className="text-right">
          <h1 className="text-2xl font-bold uppercase tracking-wide">Proposal</h1>
          <p className="mt-2 text-sm font-semibold">{proposal.title}</p>
          {proposal.date ? <p>Date: {formatDate(proposal.date)}</p> : null}
          {proposal.approvalDeadline ? <p>Respond by: {formatDate(proposal.approvalDeadline)}</p> : null}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-xs font-bold uppercase">Prepared for</p>
          <p className="font-semibold">{proposal.ownerName ?? "Customer"}</p>
          {proposal.address ? <p className="whitespace-pre-line">{proposal.address}</p> : null}
        </div>
        <div>
          <p className="text-xs font-bold uppercase">Project</p>
          <p className="font-semibold">{project.name}</p>
          {project.projectNumber ? <p>Project {project.projectNumber}</p> : null}
          {project.address ? <p className="whitespace-pre-line">{project.address}</p> : null}
        </div>
      </div>

      <Paragraphs text={proposal.introText} />

      <table className="mt-4 w-full border-collapse text-sm">
        <thead>
          <tr className="border-y-2 border-black text-left text-xs uppercase">
            <th className="py-2">Item</th>
            <th className="py-2">Description</th>
            <th className="py-2 text-right">Qty</th>
            <th className="py-2 pl-2">Unit</th>
            <th className="py-2 text-right whitespace-nowrap">Price</th>
          </tr>
        </thead>
        <tbody>
          {proposal.groups.map((group, index) => (
            <GroupRows key={`${group.title}-${index}`} group={group} depth={0} />
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-black">
            <td colSpan={4} className="pt-3 text-right font-bold">Total</td>
            <td className="pt-3 text-right font-bold tabular-nums whitespace-nowrap">{formatCents(proposal.ownerTotalCents)}</td>
          </tr>
        </tfoot>
      </table>

      <Paragraphs text={proposal.closingText} />

      <div className="mt-8 border-t border-black pt-3 text-sm">
        {approval ? (
          <>
            <p className="font-semibold">{approval}</p>
            {proposal.signedInBuildertrend ? <p>Signed electronically</p> : null}
            {proposal.approvalComments ? <p className="mt-1 whitespace-pre-line">Comments: {proposal.approvalComments}</p> : null}
          </>
        ) : (
          <div className="grid grid-cols-2 gap-8 pt-6">
            <p className="border-t border-black pt-1">Owner acceptance</p>
            <p className="border-t border-black pt-1">Date</p>
          </div>
        )}
      </div>
    </div>
  )
}
