"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { IconAlertTriangle, IconRefresh, IconSend } from "@tabler/icons-react"
import { toast } from "sonner"

import { confirmProjectOwnerPayApplicationNotInSage } from "@/app/actions/pay-application-billing"
import { sendPayRequestToSage, type PayRequestSageInvoiceState } from "@/app/actions/sage-ar-invoices"
import { PayRequestFold } from "@/components/financials/pay-request-fold"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useVisibleInterval } from "@/hooks/use-visible-interval"
import { formatCents, formatDate, formatDateTime } from "@/lib/format"

/*
 * The pay request's Sage AR invoice for office staff: queued, in Sage, failed
 * or needs attention, every line Compass sends (Sage cost code, description,
 * taxable, amount), the sales tax Sage adds, retention and the net due, and
 * Send to Sage / Retry.
 */

const SENDING_REFRESH_MS = 10_000

const LABELS: Record<NonNullable<PayRequestSageInvoiceState["export"]>["status"], string> = {
  queued: "Queued for Sage",
  running: "Sending to Sage",
  succeeded: "In Sage",
  failed: "Sage didn't take it",
  needs_attention: "Needs attention",
  cancelled: "Not sent (billing taken back)",
}

export function PayRequestSageInvoice({
  projectId,
  applicationId,
  state,
}: {
  readonly projectId: string
  readonly applicationId: string
  readonly state: PayRequestSageInvoiceState
}): React.ReactElement | null {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const status = state.export?.status ?? null
  const sending = status === "queued" || status === "running"
  // The Sage writer reports back within a few minutes; refresh until it does.
  useVisibleInterval(() => router.refresh(), SENDING_REFRESH_MS, { enabled: sending, immediate: false })

  if (state.notApplicable && !state.export) return null
  const attention = status === "needs_attention" || status === "failed"
  const invoice = state.invoice
  const billed = state.applicationStatus === "billed"

  function confirmNotInSage(): void {
    if (!window.confirm("You checked Sage and this pay request's invoice isn't there? Compass then lets you take the billing approval back as if it never reached Sage.")) return
    startTransition(async () => {
      const result = await confirmProjectOwnerPayApplicationNotInSage(projectId, applicationId)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Noted: the invoice isn't in Sage.")
      router.refresh()
    })
  }

  function send(): void {
    startTransition(async () => {
      const result = await sendPayRequestToSage(projectId, applicationId)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      if (result.data.status === "needs_attention") toast.warning(result.data.reason ?? "The Sage invoice needs attention.")
      else toast.success("Sent to Sage. This updates when Sage finishes.")
      router.refresh()
    })
  }

  const badge = status ? (
    <Badge variant={attention ? "destructive" : status === "succeeded" ? "secondary" : "outline"} className="gap-1">
      {sending ? <IconRefresh className="size-3.5 animate-spin" aria-hidden /> : null}
      {attention ? <IconAlertTriangle className="size-3.5" aria-hidden /> : null}
      {LABELS[status]}
    </Badge>
  ) : (
    <Badge variant="outline">{billed ? "Not sent" : "Preview"}</Badge>
  )

  return (
    <PayRequestFold
      id={`pay-request-sage-invoice-${applicationId}`}
      title={`Sage AR invoice ${invoice.number}`}
      badge={badge}
      summary={`${formatCents(invoice.netDueCents)} due${state.sageJobNumber ? ` · Sage job #${state.sageJobNumber}` : ""}`}
      // Opens by itself when Sage refused it, or a billed draw is still waiting to be sent.
      defaultOpen={attention || (billed && state.canSend && !status)}
    >
      {state.canSend ? (
        <div>
          <Button type="button" size="sm" variant={attention ? "default" : "outline"} disabled={pending} onClick={send}>
            {pending ? <IconRefresh className="size-4 animate-spin" aria-hidden /> : <IconSend className="size-4" aria-hidden />}
            {attention ? "Retry" : "Send to Sage"}
          </Button>
        </div>
      ) : null}
      {attention && state.export?.errorMessage ? <p className="text-sm text-destructive">{state.export.errorMessage}</p> : null}
      {attention && state.export?.possiblyInSage && !state.export.sageRecordId ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Sage may have this invoice. Check Sage before taking the billing approval back.</span>
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={confirmNotInSage}>
            I checked Sage: it isn&apos;t there
          </Button>
        </div>
      ) : null}
      {invoice.blockers.length > 0 && !attention && status !== "succeeded" ? (
        <ul className="list-disc space-y-1 pl-5 text-sm text-destructive">
          {invoice.blockers.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      ) : null}
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">
          {invoice.description || "Invoice"}: {invoice.lines.length} lines, {formatCents(invoice.netDueCents)} due
          {invoice.date ? `, dated ${formatDate(invoice.date)}` : ""}
          {invoice.dueDate ? `, due ${formatDate(invoice.dueDate)}` : ""}
        </summary>
        <div className="overflow-x-auto">
          <table className="mt-2 w-full min-w-[640px] border-collapse text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="border-b py-1 pr-2 font-medium">Sage cost code</th>
                <th className="border-b py-1 pr-2 font-medium">Description</th>
                <th className="border-b py-1 pr-2 font-medium">Taxable</th>
                <th className="border-b py-1 pr-2 text-right font-medium">Billed</th>
                <th className="border-b py-1 text-right font-medium">To Sage</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((line) => (
                <tr key={line.key}>
                  <td className="border-b py-1 pr-2 align-top">
                    {line.kind === "deposit"
                      ? `Account ${line.accountNumber ?? "not chosen"}`
                      : line.sageCostCodeRecord
                        ? `${line.sageCostCodeName ?? line.costCode} (#${line.sageCostCodeRecord})`
                        : <span className="text-destructive">{line.costCode}: no Sage cost code record</span>}
                  </td>
                  <td className="border-b py-1 pr-2 align-top">{line.description}</td>
                  <td className="border-b py-1 pr-2 align-top">{line.taxable ? "Yes" : "No"}</td>
                  <td className="border-b py-1 pr-2 text-right align-top tabular-nums">{formatCents(line.billedCents)}</td>
                  <td className="border-b py-1 text-right align-top tabular-nums">{formatCents(line.amountCents)}</td>
                </tr>
              ))}
              <tr>
                <td className="py-1" colSpan={4}>Lines</td>
                <td className="py-1 text-right tabular-nums">{formatCents(invoice.linesTotalCents)}</td>
              </tr>
              {invoice.expectedSalesTaxCents !== 0 ? (
                <tr>
                  <td className="py-1" colSpan={4}>Sales tax Sage adds{invoice.taxDistrictName ? ` (${invoice.taxDistrictName})` : ""}</td>
                  <td className="py-1 text-right tabular-nums">{formatCents(invoice.expectedSalesTaxCents)}</td>
                </tr>
              ) : null}
              <tr>
                <td className="py-1" colSpan={4}>Retention held this period</td>
                <td className="py-1 text-right tabular-nums">{formatCents(-invoice.retentionCents)}</td>
              </tr>
              <tr>
                <td className="py-1 font-medium" colSpan={4}>Net due (pay request current payment due {formatCents(invoice.currentPaymentDueCents)})</td>
                <td className="py-1 text-right font-medium tabular-nums">{formatCents(invoice.netDueCents)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
      <p className="text-xs text-muted-foreground">
        {state.export?.completedAt && status === "succeeded"
          ? `Added to Sage ${formatDateTime(state.export.completedAt)}${state.export.sageRecordId ? ` (Sage record ${state.export.sageRecordId})` : ""}. Posting stays with the office.`
          : !state.writesEnabled
            ? "Sending pay requests to Sage isn't turned on for this company yet."
            : billed
              ? "A billed pay request goes to Sage as an AR invoice (Settings › Workflows › Sage AR invoices)."
              : "This is what goes to Sage when the pay request is approved for billing."}
      </p>
    </PayRequestFold>
  )
}
