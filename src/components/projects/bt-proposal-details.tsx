import type * as React from "react"

import type { BtProposalGroupView, BtProposalItem } from "@/lib/buildertrend/lead-proposal"
import type { BtProposalView } from "@/lib/buildertrend/lead-proposals-server"
import { formatCents, formatDate, formatDateTime } from "@/lib/format"

/*
 * The body of a Buildertrend proposal's record drawer (staff only): every
 * word of the proposal, including builder cost, markup and internal notes,
 * read-only. The customer's version is the Print Preview.
 */

function Text({ label, text }: { readonly label: string; readonly text: string | null }): React.ReactElement | null {
  if (!text?.trim()) return null
  return (
    <section className="grid gap-1">
      <h3 className="text-sm font-semibold">{label}</h3>
      <p className="whitespace-pre-line text-sm">{text}</p>
    </section>
  )
}

function markupLabel(item: BtProposalItem): string {
  return item.markupPercent !== null ? `${item.markupPercent}% · ${formatCents(item.markupCents)}` : formatCents(item.markupCents)
}

function ItemRow({ item, indent }: { readonly item: BtProposalItem; readonly indent: boolean }): React.ReactElement {
  return (
    <tr className="border-b align-top">
      <td className={indent ? "py-2 pr-2 pl-4" : "py-2 pr-2"}>
        <p className="font-medium">{item.title}</p>
        {item.costCode ? <p className="text-xs text-muted-foreground">{item.costCode}</p> : null}
        {item.description ? <p className="whitespace-pre-line text-xs">{item.description}</p> : null}
        {item.internalNotes ? (
          <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">Internal notes: {item.internalNotes}</p>
        ) : null}
      </td>
      <td className="py-2 pr-2 text-right tabular-nums whitespace-nowrap">
        {item.quantity} {item.unit ?? ""}
      </td>
      <td className="py-2 pr-2 text-right tabular-nums">{formatCents(item.unitCostCents)}</td>
      <td className="py-2 pr-2 text-right tabular-nums">{formatCents(item.builderCostCents)}</td>
      <td className="py-2 pr-2 text-right tabular-nums whitespace-nowrap">{markupLabel(item)}</td>
      <td className="py-2 text-right tabular-nums">{formatCents(item.ownerPriceCents)}</td>
    </tr>
  )
}

function GroupRows({ group, sub }: { readonly group: BtProposalGroupView; readonly sub: boolean }): React.ReactElement {
  return (
    <>
      <tr className="border-b bg-muted/50 align-top">
        <td colSpan={3} className={sub ? "py-2 pr-2 pl-4 font-medium" : "py-2 pr-2 font-semibold"}>
          {group.title}
          {group.description ? <p className="whitespace-pre-line text-xs font-normal text-muted-foreground">{group.description}</p> : null}
        </td>
        <td className="py-2 pr-2 text-right tabular-nums">{formatCents(group.builderCostCents)}</td>
        <td />
        <td className="py-2 text-right font-semibold tabular-nums">{formatCents(group.ownerPriceCents)}</td>
      </tr>
      {group.items.map((item, index) => (
        <ItemRow key={`${item.title}-${index}`} item={item} indent={sub} />
      ))}
      {group.subGroups.map((child, index) => (
        <GroupRows key={`${child.title}-${index}`} group={child} sub />
      ))}
    </>
  )
}

function Fact({ label, value }: { readonly label: string; readonly value: string | null }): React.ReactElement | null {
  if (!value) return null
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function byLine(name: string | null, at: string | null): string | null {
  if (!name && !at) return null
  return [name, at ? formatDateTime(at) : null].filter(Boolean).join(" · ")
}

export function BtProposalDetails({ proposal }: { readonly proposal: BtProposalView }): React.ReactElement {
  return (
    <div className="grid gap-5">
      <dl className="grid gap-1.5">
        <Fact label="Status" value={proposal.statusLabel} />
        <Fact label="Buildertrend status" value={proposal.statusText} />
        <Fact label="Status date" value={proposal.statusDate ? formatDate(proposal.statusDate) : null} />
        <Fact label="Signature" value={proposal.signedInBuildertrend ? "Signed in Buildertrend" : null} />
        <Fact label="Approval comments" value={proposal.approvalComments} />
        <Fact label="Respond by" value={proposal.approvalDeadline ? formatDate(proposal.approvalDeadline) : null} />
        <Fact label="Customer" value={proposal.ownerName} />
        <Fact label="Address" value={proposal.address} />
        <Fact label="Added" value={byLine(proposal.addedByName, proposal.addedAt)} />
        <Fact label="Last updated" value={byLine(proposal.updatedByName, proposal.updatedAt)} />
      </dl>

      <Text label="Introduction" text={proposal.introText} />

      <section className="grid gap-2">
        <h3 className="text-sm font-semibold">Items</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <thead>
              <tr className="border-y text-left text-xs text-muted-foreground">
                <th className="py-2 pr-2 font-medium">Item</th>
                <th className="py-2 pr-2 text-right font-medium">Qty</th>
                <th className="py-2 pr-2 text-right font-medium">Unit cost</th>
                <th className="py-2 pr-2 text-right font-medium">Builder cost</th>
                <th className="py-2 pr-2 text-right font-medium">Markup</th>
                <th className="py-2 text-right font-medium">Owner price</th>
              </tr>
            </thead>
            <tbody>
              {proposal.groups.map((group, index) => (
                <GroupRows key={`${group.title}-${index}`} group={group} sub={false} />
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 font-semibold">
                <td colSpan={3} className="py-2 pr-2 text-right">Total</td>
                <td className="py-2 pr-2 text-right tabular-nums">{formatCents(proposal.builderCostTotalCents)}</td>
                <td />
                <td className="py-2 text-right tabular-nums">{formatCents(proposal.ownerTotalCents)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <Text label="Closing" text={proposal.closingText} />

      {proposal.attachments.length > 0 ? (
        <section className="grid gap-1">
          <h3 className="text-sm font-semibold">Attachments</h3>
          <ul className="grid gap-1 text-sm">
            {proposal.attachments.map((file) => (
              <li key={file.id}>
                {file.status === "verified" ? (
                  <a href={file.url} target="_blank" rel="noreferrer" className="text-primary underline-offset-4 hover:underline">
                    {file.label}
                  </a>
                ) : (
                  <span>
                    {file.label} <span className="text-muted-foreground">({file.reason})</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
