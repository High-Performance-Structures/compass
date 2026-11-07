"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { IconAlertTriangle, IconRefresh, IconSend } from "@tabler/icons-react"
import { toast } from "sonner"

import { sendEstimateToSage, type EstimateSageSyncState } from "@/app/actions/sage-estimates"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useVisibleInterval } from "@/hooks/use-visible-interval"
import { formatCents, formatDateTime } from "@/lib/format"

/*
 * The accepted estimate's Sage sync for office staff: queued, sent, failed or
 * needs attention, the proposal lines Compass sends (one per estimate line:
 * cost code, the line's description, Taxable, amount, total), and Send to
 * Sage / Retry. Staff-only; the client keeps seeing the assembly view.
 */

const SENDING_REFRESH_MS = 10_000

const LABELS: Record<NonNullable<EstimateSageSyncState["export"]>["status"], string> = {
  queued: "Queued for Sage",
  waiting_for_job: "Waiting for the Sage job",
  running: "Sending to Sage",
  succeeded: "In Sage",
  failed: "Sage didn't take it",
  needs_attention: "Needs attention",
}

export function EstimateSageSyncPanel({
  projectId,
  estimateId,
  state,
}: {
  readonly projectId: string
  readonly estimateId: string
  readonly state: EstimateSageSyncState
}): React.ReactElement | null {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const status = state.export?.status ?? null
  const sending = status === "queued" || status === "waiting_for_job" || status === "running"
  // The Sage writer reports back within a few minutes; refresh until it does.
  useVisibleInterval(() => router.refresh(), SENDING_REFRESH_MS, { enabled: sending, immediate: false })

  if (state.notApplicable && !state.export) return null
  const attention = status === "needs_attention" || status === "failed"

  function send(): void {
    startTransition(async () => {
      const result = await sendEstimateToSage(projectId, estimateId)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      if (result.data.status === "needs_attention") toast.warning(result.data.reason ?? "The Sage sync needs attention.")
      else toast.success("Sent to Sage. This updates when Sage finishes.")
      router.refresh()
    })
  }

  return (
    <section aria-labelledby={`estimate-sage-${estimateId}`} className="mb-4 space-y-3 border-y bg-background p-4 print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id={`estimate-sage-${estimateId}`} className="text-sm font-semibold">Sage</h2>
          {status ? (
            <Badge variant={attention ? "destructive" : status === "succeeded" ? "secondary" : "outline"} className="gap-1">
              {sending ? <IconRefresh className="size-3.5 animate-spin" aria-hidden /> : null}
              {attention ? <IconAlertTriangle className="size-3.5" aria-hidden /> : null}
              {LABELS[status]}
            </Badge>
          ) : (
            <Badge variant="outline">Not sent</Badge>
          )}
          {state.sageJobNumber ? <span className="text-xs text-muted-foreground">Sage job #{state.sageJobNumber}</span> : null}
        </div>
        {state.canSend ? (
          <Button type="button" size="sm" variant={attention ? "default" : "outline"} disabled={pending} onClick={send}>
            {pending ? <IconRefresh className="size-4 animate-spin" aria-hidden /> : <IconSend className="size-4" aria-hidden />}
            {attention ? "Retry" : "Send to Sage"}
          </Button>
        ) : null}
      </div>
      {attention && state.export?.errorMessage ? <p className="text-sm text-destructive">{state.export.errorMessage}</p> : null}
      {state.proposal && state.proposal.blockers.length > 0 && !attention ? (
        <ul className="list-disc space-y-1 pl-5 text-sm text-destructive">
          {state.proposal.blockers.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      ) : null}
      {state.proposal ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            Proposal: {state.proposal.lines.length} lines, {formatCents(state.proposal.totalCents)}
            {state.proposal.budgetLineCount === null ? "" : `; budget at cost: ${state.proposal.budgetLineCount} lines`}
          </summary>
          <table className="mt-2 w-full border-collapse text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="border-b py-1 pr-2 font-medium">Sage cost code</th>
                <th className="border-b py-1 pr-2 font-medium">Description</th>
                <th className="border-b py-1 pr-2 font-medium">Tax</th>
                <th className="border-b py-1 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {state.proposal.lines.map((line, index) => (
                // Lines may repeat a cost code and description; their order is fixed.
                <tr key={index}>
                  <td className="border-b py-1 pr-2 align-top">{line.sageCostCodeName ?? <span className="text-destructive">{line.costCode}: no Sage cost code</span>}</td>
                  <td className="border-b py-1 pr-2 align-top">{line.description}</td>
                  <td className="border-b py-1 pr-2 align-top">{line.taxable ? "Taxable" : ""}</td>
                  <td className="border-b py-1 text-right align-top tabular-nums">{formatCents(line.amountCents)}</td>
                </tr>
              ))}
              <tr>
                <td className="py-1 font-medium" colSpan={3}>Total</td>
                <td className="py-1 text-right font-medium tabular-nums">{formatCents(state.proposal.totalCents)}</td>
              </tr>
            </tbody>
          </table>
        </details>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {state.export?.completedAt && status === "succeeded"
          ? `Sent ${formatDateTime(state.export.completedAt)}.`
          : state.writesEnabled
            ? "An accepted estimate goes to Sage automatically when the company syncs estimates (Settings › Workflows › Sage estimates)."
            : "Sending estimates to Sage isn't turned on for this company yet."}
      </p>
    </section>
  )
}
