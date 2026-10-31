"use client"

import * as React from "react"

import { getProjectPurchaseOrderSiteContactOptions, getProjectTaskAssigneeOptions } from "@/app/actions/project-contact-assignees"
import type { ProjectTaskAssigneeOption } from "@/lib/domain/contacts/types"
import { getProjectPurchaseOrderFormOptions } from "@/app/actions/project-purchase-orders"
import type { ProjectPurchaseOrderFormOptions } from "@/lib/domain/operations/types"
import type { TradeLetterRow } from "@/app/actions/trade-letters"
import { ProjectPurchaseOrderCreateForm } from "@/components/projects/project-purchase-order-create-form"
import { statusLabel } from "@/lib/project-operations/status"
import { countsAgainstAcceptedPrice } from "@/lib/trade-letters/orders"
import { formatCents as money } from "@/lib/format"


export type TradePurchaseOrderSetup = {
  readonly coding: ProjectPurchaseOrderFormOptions
  readonly contacts: readonly ProjectTaskAssigneeOption[]
  readonly siteContacts: readonly ProjectTaskAssigneeOption[]
}

/** What the PO form needs on this job, loaded once for all supplier rows. */
export function useTradePurchaseOrderSetup(projectId: string, enabled: boolean): TradePurchaseOrderSetup | null {
  const [setup, setSetup] = React.useState<TradePurchaseOrderSetup | null>(null)
  React.useEffect(() => {
    if (!enabled) return
    let cancelled = false
    Promise.all([getProjectPurchaseOrderFormOptions(projectId), getProjectTaskAssigneeOptions(projectId), getProjectPurchaseOrderSiteContactOptions(projectId)]).then(
      ([coding, assignees, siteContacts]) => {
        if (!cancelled) setSetup({ coding, contacts: [...assignees.projectContacts, ...assignees.directoryContacts], siteContacts })
      },
      () => {
        // Without PO access the button simply doesn't show.
      },
    )
    return () => {
      cancelled = true
    }
  }, [projectId, enabled])
  return setup
}

/** The POs drawn against a supplier's accepted quote, and what's left to order. */
export function TradeOrdersCell({ projectId, row }: { readonly projectId: string; readonly row: TradeLetterRow }): React.ReactElement {
  const left = row.trade.totalCents - row.orderedCents
  return (
    <div className="grid gap-1 text-xs">
      {row.orders.length === 0 ? (
        <span className="text-muted-foreground">No PO yet</span>
      ) : (
        <ul className="grid gap-0.5">
          {row.orders.map((order) => (
            <li key={order.id} className={countsAgainstAcceptedPrice(order.status) ? undefined : "text-muted-foreground line-through"}>
              <a className="font-medium underline" href={`/dashboard/projects/${projectId}/purchase-orders?created=${encodeURIComponent(order.id)}`}>
                {order.number ?? order.title}
              </a>{" "}
              · {statusLabel(order.status)} · <span className="tabular-nums">{money(order.amountCents)}</span>
            </li>
          ))}
        </ul>
      )}
      {row.orders.length > 0 && (
        <span className={left < 0 ? "text-destructive" : "text-muted-foreground"}>
          Ordered {money(row.orderedCents)} of {money(row.trade.totalCents)}
          {left < 0 ? ` · ${money(-left)} over the accepted price` : left > 0 ? ` · ${money(left)} left` : " · fully ordered"}
        </span>
      )}
    </div>
  )
}

/** Opens the PO form filled from the accepted quote: the supplier and the codes still left to order. */
export function TradePurchaseOrderButton({
  projectId,
  row,
  setup,
  onCreated,
}: {
  readonly projectId: string
  readonly row: TradeLetterRow
  readonly setup: TradePurchaseOrderSetup
  readonly onCreated: () => void
}): React.ReactElement {
  const quote = row.trade.rfqNumber ? ` (${row.trade.rfqNumber})` : ""
  return (
    <ProjectPurchaseOrderCreateForm
      projectId={projectId}
      jobsiteAddress={setup.coding.jobsiteAddress}
      contactOptions={setup.contacts}
      siteContactOptions={setup.siteContacts}
      phaseOptions={setup.coding.phases}
      costCodeOptions={setup.coding.costCodes}
      createLabel={row.orders.length === 0 ? "Purchase order" : "Another PO"}
      createSecondary={row.orders.length > 0}
      prefill={{
        title: `${row.vendor?.name ?? row.trade.vendor}${quote}`,
        companyName: row.vendor?.name ?? row.trade.vendor,
        sageVendorId: row.vendor?.sageVendorId ?? null,
        lines: row.leftToOrder.map((code) => ({ costCode: code.costCode, description: code.description, amount: code.amountCents / 100 })),
        awardedRfqId: row.trade.rfqId,
        acceptedAmount: row.trade.totalCents / 100,
        alreadyOrdered: row.orderedCents / 100,
      }}
      onCreated={onCreated}
    />
  )
}
