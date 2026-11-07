"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { IconRefresh, IconSend } from "@tabler/icons-react"
import { toast } from "sonner"

import { sendChangeOrdersToSage, type SageChangeOrderSendState } from "@/app/actions/sage-change-orders"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ResponsiveDialog, ResponsiveDialogBody, ResponsiveDialogFooter } from "@/components/ui/responsive-dialog"
import { useVisibleInterval } from "@/hooks/use-visible-interval"
import { sageChangeOrderNumberError, type SageChangeOrderState } from "@/lib/domain/sage-bridge/change-order-rules"
import type { SageChangeOrderSendItem } from "@/lib/financials/sage-change-order-send-server"
import { formatCents, formatDate, formatDateTime } from "@/lib/format"

/*
 * Send to Sage for approved change orders and variances: each one's Sage
 * status, and a confirmation listing the number, date, description and every
 * line (Sage cost code, cost type, amount) before anything is queued.
 */

const SENDING_REFRESH_MS = 10_000

function SageChangeOrderStateBadge({ sage, item }: { readonly sage: SageChangeOrderState; readonly item: SageChangeOrderSendItem }): React.ReactElement {
  if (item.export && (item.export.status === "queued" || item.export.status === "running")) {
    return (
      <Badge variant="outline" className="gap-1">
        <IconRefresh className="size-3.5 animate-spin" aria-hidden />
        Sending to Sage
      </Badge>
    )
  }
  if (sage.state === "in_sage") return <Badge variant="secondary">In Sage ({sage.sageNumber})</Badge>
  if (sage.state === "differs") return <Badge variant="destructive">Differs in Sage</Badge>
  if (sage.state === "not_in_sage") return <Badge variant="outline">Not in Sage</Badge>
  return <Badge variant="outline">Sage not read yet</Badge>
}

function LinesTable({ item }: { readonly item: SageChangeOrderSendItem }): React.ReactElement {
  return (
    <table className="w-full border-collapse text-xs">
      <thead>
        <tr className="text-left text-muted-foreground">
          <th className="border-b py-1 pr-2 font-medium">Sage cost code</th>
          <th className="border-b py-1 pr-2 font-medium">Cost type</th>
          <th className="border-b py-1 text-right font-medium">Amount</th>
        </tr>
      </thead>
      <tbody>
        {item.plan.lines.map((line) => (
          <tr key={line.costCode}>
            <td className="border-b py-1 pr-2 align-top">
              {line.sageCostCodeName ?? line.costCode}
              {line.sageCostCodeRecord ? <span className="text-muted-foreground"> (#{line.sageCostCodeRecord})</span> : null}
              <div className="text-muted-foreground">{line.description}</div>
            </td>
            <td className="border-b py-1 pr-2 align-top">{line.costTypeNumber}</td>
            <td className="border-b py-1 text-right align-top tabular-nums">{formatCents(line.amountCents)}</td>
          </tr>
        ))}
        <tr>
          <td className="py-1 font-medium" colSpan={2}>Total</td>
          <td className="py-1 text-right font-medium tabular-nums">{formatCents(item.plan.totalCents)}</td>
        </tr>
      </tbody>
    </table>
  )
}

/**
 * The Sage status of a project's approved change orders with a Send to Sage
 * button. `bulk` lists them all and sends the ones staff tick; otherwise the
 * one change order on the page.
 */
export function SageChangeOrderSendPanel({
  projectId,
  state,
  bulk = false,
}: {
  readonly projectId: string
  readonly state: SageChangeOrderSendState
  readonly bulk?: boolean
}): React.ReactElement | null {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [pending, startTransition] = React.useTransition()
  const sendable = state.items.filter((item) => item.canSend)
  const [unselected, setUnselected] = React.useState<ReadonlySet<string>>(() => new Set())
  const [numbers, setNumbers] = React.useState<Readonly<Record<string, string>>>({})
  const sending = state.items.some((item) => item.export?.status === "queued" || item.export?.status === "running")

  // The Sage writer reports back within a few minutes; refresh until it does.
  useVisibleInterval(() => router.refresh(), SENDING_REFRESH_MS, { enabled: sending, immediate: false })

  if (state.items.length === 0) return null
  const numberOf = (item: SageChangeOrderSendItem): string => numbers[item.plan.changeOrderId] ?? item.plan.suggestedNumber
  const chosen = sendable.filter((item) => !unselected.has(item.plan.changeOrderId))
  const numberErrors = new Map<string, string>()
  const taken: string[] = []
  for (const item of chosen) {
    const value = numberOf(item)
    const error = sageChangeOrderNumberError(value, { sageNumbers: state.sageNumbers, compassNumbers: taken })
    if (error) numberErrors.set(item.plan.changeOrderId, error)
    taken.push(value)
  }

  function send(): void {
    startTransition(async () => {
      const result = await sendChangeOrdersToSage(
        projectId,
        chosen.map((item) => ({ changeOrderId: item.plan.changeOrderId, sageNumber: numberOf(item) }))
      )
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`${result.data.queued === 1 ? "Change order" : `${result.data.queued} change orders`} sent to Sage. This updates when Sage finishes.`)
      setOpen(false)
      router.refresh()
    })
  }

  const disabledReason = state.writesEnabled ? null : "Sending change orders to Sage isn't turned on for this company yet."

  return (
    <section aria-labelledby={`sage-change-orders-${projectId}`} className="space-y-3 border-y bg-background p-4 print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`sage-change-orders-${projectId}`} className="text-sm font-semibold">
          {bulk ? "Change orders for Sage" : "Sage"}
        </h2>
        <Button type="button" size="sm" disabled={!state.writesEnabled || sendable.length === 0 || pending} onClick={() => setOpen(true)}>
          <IconSend className="size-4" aria-hidden />
          {bulk ? "Send approved change orders to Sage" : "Send to Sage"}
        </Button>
      </div>
      {state.sageJobNumber ? null : <p className="text-sm text-muted-foreground">This project isn&apos;t linked to a Sage job.</p>}
      <ul className="divide-y text-sm">
        {state.items.map((item) => (
          <li key={item.plan.changeOrderId} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>
              <span className="font-medium">{item.plan.sageName}</span> <span className="text-muted-foreground">{item.title}</span>{" "}
              <span className="tabular-nums">{formatCents(item.plan.totalCents)}</span>
            </span>
            <span className="flex flex-wrap items-center gap-2">
              <SageChangeOrderStateBadge sage={item.sage} item={item} />
              {item.export?.status === "failed" && item.export.errorMessage ? (
                <span className="text-xs text-destructive">Sage didn&apos;t take it: {item.export.errorMessage}</span>
              ) : item.reason ? (
                <span className="text-xs text-muted-foreground">{item.reason}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        {state.sageReadAt ? `Sage's change orders read ${formatDateTime(state.sageReadAt)}.` : "Compass hasn't read this job's change orders from Sage yet; the Sage writer still checks for duplicates before adding."}
        {disabledReason ? ` ${disabledReason}` : ""}
      </p>

      <ResponsiveDialog
        open={open}
        onOpenChange={setOpen}
        title={bulk ? "Send approved change orders to Sage" : `Send ${sendable[0]?.plan.sageName ?? "change order"} to Sage`}
        description={`Each one is added to Sage job ${state.sageJobNumber ?? ""} as an approved prime change order with its own lines.`}
        className="sm:max-w-2xl"
      >
        <ResponsiveDialogBody className="space-y-4">
          {sendable.map((item) => {
            const id = item.plan.changeOrderId
            const error = numberErrors.get(id)
            return (
              <div key={id} className="space-y-2 border-b pb-3">
                <div className="flex items-center gap-2">
                  {bulk ? (
                    <Checkbox
                      id={`send-${id}`}
                      checked={!unselected.has(id)}
                      onCheckedChange={(checked) =>
                        setUnselected((current) => {
                          const next = new Set(current)
                          if (checked === true) next.delete(id)
                          else next.add(id)
                          return next
                        })
                      }
                      aria-label={`Send ${item.plan.sageName}`}
                    />
                  ) : null}
                  <span className="text-sm font-medium">{item.plan.sageName}</span>
                  <span className="text-sm text-muted-foreground">{item.title}</span>
                </div>
                <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
                  <div>
                    <Label htmlFor={`number-${id}`} className="text-xs text-muted-foreground">Sage number</Label>
                    <Input
                      id={`number-${id}`}
                      value={numberOf(item)}
                      maxLength={40}
                      onChange={(event) => setNumbers((current) => ({ ...current, [id]: event.target.value }))}
                      aria-invalid={error ? true : undefined}
                    />
                    {error && !unselected.has(id) ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Date (approved)</dt>
                    <dd className="font-medium">{formatDate(item.plan.date)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Description</dt>
                    <dd className="font-medium">{item.plan.description}</dd>
                  </div>
                </dl>
                <LinesTable item={item} />
              </div>
            )
          })}
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" onClick={send} disabled={pending || chosen.length === 0 || numberErrors.size > 0}>
            {pending ? <IconRefresh className="size-4 animate-spin" aria-hidden /> : <IconSend className="size-4" aria-hidden />}
            {chosen.length === 1 ? "Send to Sage" : `Send ${chosen.length} to Sage`}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialog>
    </section>
  )
}
