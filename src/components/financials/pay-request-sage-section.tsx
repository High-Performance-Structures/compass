"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { IconArrowsExchange } from "@tabler/icons-react"

import {
  applySageAmountsToPayRequest,
  setPayRequestShopTicketEnteredInSage,
  type SagePayRequestPanel,
} from "@/app/actions/sage-pay-requests"
import { PayRequestFold } from "@/components/financials/pay-request-fold"
import { SagePayRequestSyncButton } from "@/components/financials/sage-pay-request-sync"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import type { PayRequestSageState } from "@/lib/financials/sage-pay-request-state"
import { sageReconciliationNeedsAttention } from "@/lib/financials/pay-request-work-areas"
import { formatCents, formatDate, formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"

type Reconciliation = NonNullable<PayRequestSageState["reconciliation"]>

function Difference({ left, right }: { readonly left: number; readonly right: number }): React.ReactElement {
  const difference = left - right
  return (
    <span className={cn("tabular-nums", difference !== 0 && "font-semibold text-destructive")}>
      {difference === 0 ? "—" : formatCents(difference)}
    </span>
  )
}

/** Compass's pay application against Sage's, cost code by cost code. */
function ReconciliationTable({ reconciliation }: { readonly reconciliation: Reconciliation }): React.ReactElement {
  const rows = [...reconciliation.rows].sort((left, right) => Number(right.mismatch) - Number(left.mismatch) || left.label.localeCompare(right.label))
  const totals = reconciliation.totals
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="text-xs uppercase text-muted-foreground">
          <tr className="border-b">
            <th className="py-2 text-left font-medium">Cost code</th>
            <th className="py-2 text-right font-medium">This period · Compass</th>
            <th className="py-2 text-right font-medium">Sage</th>
            <th className="py-2 text-right font-medium">Difference</th>
            <th className="py-2 text-right font-medium">To date · Compass</th>
            <th className="py-2 text-right font-medium">Sage</th>
            <th className="py-2 text-right font-medium">Contract difference</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className={cn("border-b", row.mismatch && "bg-muted/35")}>
              <td className="py-1.5">
                {row.label}
                {row.presence !== "both" ? (
                  <span className="ml-2 text-xs text-muted-foreground">{row.presence === "compass_only" ? "Only in Compass" : "Only in Sage"}</span>
                ) : null}
              </td>
              <td className="py-1.5 text-right tabular-nums">{formatCents(row.compassThisPeriodCents)}</td>
              <td className="py-1.5 text-right tabular-nums">{formatCents(row.sageThisPeriodCents)}</td>
              <td className="py-1.5 text-right"><Difference left={row.compassThisPeriodCents} right={row.sageThisPeriodCents} /></td>
              <td className="py-1.5 text-right tabular-nums">{formatCents(row.compassToDateCents)}</td>
              <td className="py-1.5 text-right tabular-nums">{formatCents(row.sageToDateCents)}</td>
              <td className="py-1.5 text-right"><Difference left={row.compassContractCents} right={row.sageContractCents} /></td>
            </tr>
          ))}
          <tr className="font-semibold">
            <td className="py-2">Total</td>
            <td className="py-2 text-right tabular-nums">{formatCents(totals.compassThisPeriodCents)}</td>
            <td className="py-2 text-right tabular-nums">{formatCents(totals.sageThisPeriodCents)}</td>
            <td className="py-2 text-right"><Difference left={totals.compassThisPeriodCents} right={totals.sageThisPeriodCents} /></td>
            <td className="py-2 text-right tabular-nums">{formatCents(totals.compassToDateCents)}</td>
            <td className="py-2 text-right tabular-nums">{formatCents(totals.sageToDateCents)}</td>
            <td className="py-2 text-right"><Difference left={totals.compassContractCents} right={totals.sageContractCents} /></td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

/**
 * The Sage part of a pay application's page: the Sage application it follows
 * or is linked to, the comparison and "Use Sage amounts" for one built in
 * Compass, and the checklist of shop tickets still to be entered in Sage.
 */
export function PayRequestSageSection({
  projectId,
  applicationId,
  applicationNumber,
  state,
  panel,
}: {
  readonly projectId: string
  readonly applicationId: string
  readonly applicationNumber: string
  readonly state: PayRequestSageState
  readonly panel: SagePayRequestPanel | null
}): React.ReactElement | null {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  if (state.origin !== "sage" && !state.link) return null

  function run(action: () => Promise<{ readonly success: boolean; readonly error?: string }>, done: string): void {
    setMessage(null)
    startTransition(async () => {
      const result = await action()
      setMessage(result.success ? done : (result.error ?? "Something went wrong."))
      router.refresh()
    })
  }

  const link = state.link
  const reconciliation = state.reconciliation
  // Opens by itself when Compass and Sage disagree; otherwise a single line.
  const needsAttention = sageReconciliationNeedsAttention(reconciliation)
  const ticketsToEnter = state.origin === "sage" ? state.unbilledShopTickets.length : 0
  const summary = [
    link
      ? `${state.billingSource === "sage" ? "Synced from" : "Linked to"} Sage's application ${link.sageApplicationNumber}`
      : "Not linked to a Sage progress billing",
    reconciliation ? (needsAttention ? "differs from Sage" : "matches Sage") : null,
    ticketsToEnter > 0 ? `${ticketsToEnter} shop ticket${ticketsToEnter === 1 ? "" : "s"} to enter in Sage` : null,
  ]
    .filter((part) => part !== null)
    .join(" · ")
  return (
    <PayRequestFold
      id="pay-request-sage"
      title="Sage"
      summary={summary}
      defaultOpen={needsAttention}
    >
      <div className="space-y-1">
        {link ? (
          <p className="text-sm text-muted-foreground">
            {state.billingSource === "sage" ? "Billed amounts are synced from" : "Linked to"} Sage&apos;s application {link.sageApplicationNumber}
            {link.periodTo ? `, period to ${formatDate(link.periodTo)}` : ""}
            {link.invoiceNumber ? `, invoice ${link.invoiceNumber}` : ""}. Last synced {formatDateTime(link.lastSyncedAt)}.
            {state.billingSource === "sage" ? " To change them, change the billing in Sage and sync again." : ""}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">This pay request isn&apos;t linked to a Sage progress billing yet.</p>
        )}
        {panel && panel.origin === "sage" ? <SagePayRequestSyncButton projectId={projectId} panel={panel} /> : null}
      </div>
      {message ? <p className="rounded-md border bg-muted/35 px-3 py-2 text-sm">{message}</p> : null}
      {state.unmappedLines.length > 0 ? (
        <p className="text-sm text-destructive">
          No Compass cost code matched these Sage lines, so they keep Sage&apos;s text: {state.unmappedLines.join("; ")}.
        </p>
      ) : null}

      {reconciliation ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              {reconciliation.mismatchCount === 0 && !reconciliation.totals.mismatch
                ? `Pay application ${applicationNumber} matches Sage.`
                : `Pay application ${applicationNumber} was built in Compass and differs from Sage on ${reconciliation.mismatchCount} cost code${reconciliation.mismatchCount === 1 ? "" : "s"}. Nothing changes until you choose.`}
            </p>
            {state.canUseSageAmounts ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" size="sm" disabled={isPending}>
                    <IconArrowsExchange className="size-4" />
                    Use Sage amounts
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Use Sage&apos;s amounts on pay application {applicationNumber}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Its lines and totals become Sage&apos;s, and from now on it follows Sage. The amounts it has now are kept in its history.
                      Shop ticket amounts imported in Compass come off; tickets Sage&apos;s billing covers count as already included.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep Compass amounts</AlertDialogCancel>
                    <AlertDialogAction onClick={() => run(() => applySageAmountsToPayRequest(projectId, applicationId), "Pay application now uses Sage's amounts.")}>
                      Use Sage amounts
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : null}
          </div>
          <ReconciliationTable reconciliation={reconciliation} />
        </div>
      ) : null}

      {state.origin === "sage" ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Shop tickets to enter in Sage</h3>
          {state.unbilledShopTickets.length === 0 && state.includedShopTickets.length === 0 ? (
            <p className="text-sm text-muted-foreground">No issued shop tickets are waiting to be billed.</p>
          ) : null}
          <ul className="space-y-2">
            {state.unbilledShopTickets.map((ticket) => (
              <li key={ticket.id} className="flex items-start gap-3 text-sm">
                <Checkbox
                  id={`sage-ticket-${ticket.id}`}
                  className="mt-0.5"
                  checked={false}
                  disabled={isPending || !state.canTickShopTickets}
                  onCheckedChange={() =>
                    run(() => setPayRequestShopTicketEnteredInSage(projectId, applicationId, ticket.id, true), `${ticket.ticketNumber} ticked as entered in Sage.`)
                  }
                />
                <label htmlFor={`sage-ticket-${ticket.id}`} className="space-y-0.5">
                  <span className="font-medium">
                    {ticket.ticketNumber} · {formatDate(ticket.ticketDate)} · {formatCents(ticket.totalCents)}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {ticket.lines.map((line) => `${line.costCode} ${formatCents(line.amountCents)}`).join(" · ") || "No amounts"}
                  </span>
                </label>
              </li>
            ))}
            {state.includedShopTickets.map((ticket) => (
              <li key={ticket.id} className="flex items-start gap-3 text-sm text-muted-foreground">
                <Checkbox
                  id={`sage-ticket-${ticket.id}`}
                  className="mt-0.5"
                  checked
                  disabled={isPending || !state.canTickShopTickets}
                  onCheckedChange={() =>
                    run(() => setPayRequestShopTicketEnteredInSage(projectId, applicationId, ticket.id, false), `${ticket.ticketNumber} unticked.`)
                  }
                />
                <label htmlFor={`sage-ticket-${ticket.id}`}>
                  {ticket.ticketNumber} · {formatCents(ticket.totalCents)} · included on this pay request
                </label>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </PayRequestFold>
  )
}
