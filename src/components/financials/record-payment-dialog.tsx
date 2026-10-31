"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import {
  applyReceivedPaymentToItems,
  getRecordPaymentOptions,
  recordReceivedPayment,
  type ReceivableFocus,
  type RecordPaymentOptions,
} from "@/app/actions/received-payments"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { paymentMethodLabel, RECEIVED_PAYMENT_METHODS } from "@/lib/domain/financials/statuses"
import { formatCents, toCents } from "@/lib/format"

/**
 * Record a payment received against a pay application or invoice, split
 * across the customer's other open items on the project if it covers more,
 * or apply what an existing payment still has unapplied. The totals shown
 * here are a preview; the server checks every amount against the stored
 * balances before it saves.
 */

export type RecordPaymentTarget = { readonly focus: ReceivableFocus } | { readonly paymentId: string }

function today(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, "0")
  const day = String(now.getDate()).padStart(2, "0")
  return `${now.getFullYear()}-${month}-${day}`
}

function dollarsText(cents: number): string {
  return (cents / 100).toFixed(2)
}

function itemKey(item: { readonly kind: string; readonly id: string }): string {
  return `${item.kind}:${item.id}`
}

export function RecordPaymentDialog({
  projectId,
  target,
  onOpenChange,
  onMessage,
}: {
  readonly projectId: string
  /** null keeps the dialog closed. */
  readonly target: RecordPaymentTarget | null
  readonly onOpenChange: (open: boolean) => void
  readonly onMessage: (message: string) => void
}): React.ReactElement {
  const router = useRouter()
  const [options, setOptions] = React.useState<RecordPaymentOptions | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [amount, setAmount] = React.useState("")
  const [paymentDate, setPaymentDate] = React.useState(today())
  const [method, setMethod] = React.useState<string>("check")
  const [reference, setReference] = React.useState("")
  const [memo, setMemo] = React.useState("")
  const [applied, setApplied] = React.useState<Readonly<Record<string, string>>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()

  React.useEffect(() => {
    if (!target) return
    let active = true
    setOptions(null)
    setLoadError(null)
    setError(null)
    setReference("")
    setMemo("")
    setPaymentDate(today())
    setMethod("check")
    void getRecordPaymentOptions(projectId, target).then((result) => {
      if (!active) return
      if (!result.success) {
        setLoadError(result.error)
        return
      }
      setOptions(result.data)
      // Start with the focused item's open balance (or the payment's unapplied amount) applied to it.
      const first = result.data.openItems[0]
      const startCents = first
        ? Math.min(first.openCents, result.data.payment ? result.data.payment.unappliedCents : first.openCents)
        : 0
      setAmount(result.data.payment ? "" : dollarsText(startCents))
      setApplied(first && "focus" in target ? { [itemKey(first)]: dollarsText(startCents) } : {})
    })
    return () => {
      active = false
    }
  }, [projectId, target])

  const appliedCents = Object.values(applied).reduce((sum, value) => sum + (toCents(value) ?? 0), 0)
  const paymentCents = options?.payment ? options.payment.unappliedCents : (toCents(amount) ?? 0)
  const unappliedCents = paymentCents - appliedCents
  const applyMode = Boolean(options?.payment)

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!target || !options) return
    const allocations = options.openItems.map((item) => ({ kind: item.kind, id: item.id, amount: applied[itemKey(item)] ?? "" }))
    setError(null)
    startTransition(async () => {
      const result = options.payment
        ? await applyReceivedPaymentToItems(projectId, options.payment.id, allocations)
        : "focus" in target
          ? await recordReceivedPayment({
              projectId,
              focus: target.focus,
              amount,
              paymentDate,
              method,
              reference,
              memo,
              allocations,
            })
          : null
      if (!result) return
      if (!result.success) {
        setError(result.error)
        return
      }
      onMessage(options.payment ? "Payment applied." : "Payment recorded.")
      onOpenChange(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{applyMode ? "Apply unapplied payment" : "Record payment"}</DialogTitle>
          <DialogDescription>
            {options?.customerName ? `From ${options.customerName}. ` : ""}
            Apply it to this item and, if it covers more, to the customer&apos;s other open items on this project.
            Compass does not post receipts to Sage; enter the receipt there as usual.
          </DialogDescription>
        </DialogHeader>
        {loadError ? (
          <p role="alert" className="text-sm text-destructive">{loadError}</p>
        ) : !options ? (
          <p className="text-sm text-muted-foreground">Loading open items...</p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            {applyMode ? (
              <p className="text-sm">
                {formatCents(options.payment?.unappliedCents ?? 0)} of this payment is not applied yet.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="payment-amount">Amount received</Label>
                  <Input
                    id="payment-amount"
                    inputMode="decimal"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="payment-date">Date received</Label>
                  <Input
                    id="payment-date"
                    type="date"
                    value={paymentDate}
                    onChange={(event) => setPaymentDate(event.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="payment-method">Method</Label>
                  <Select value={method} onValueChange={setMethod}>
                    <SelectTrigger id="payment-method">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RECEIVED_PAYMENT_METHODS.map((value) => (
                        <SelectItem key={value} value={value}>{paymentMethodLabel(value)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="payment-reference">Reference</Label>
                  <Input
                    id="payment-reference"
                    placeholder="Check number, ACH trace, last 4"
                    maxLength={100}
                    value={reference}
                    onChange={(event) => setReference(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="payment-memo">Memo</Label>
                  <Textarea
                    id="payment-memo"
                    rows={2}
                    maxLength={500}
                    value={memo}
                    onChange={(event) => setMemo(event.target.value)}
                  />
                </div>
              </div>
            )}

            <div className="space-y-2">
              <p className="text-sm font-medium">Apply to</p>
              {options.openItems.length === 0 ? (
                <p className="text-sm text-muted-foreground">This customer has no open items on the project.</p>
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted-foreground">
                      <tr className="border-b">
                        <th className="px-3 py-2 text-left font-medium">Item</th>
                        <th className="px-3 py-2 text-right font-medium">Billed</th>
                        <th className="px-3 py-2 text-right font-medium">Open</th>
                        <th className="px-3 py-2 text-right font-medium">Apply</th>
                      </tr>
                    </thead>
                    <tbody>
                      {options.openItems.map((item) => {
                        const key = itemKey(item)
                        return (
                          <tr key={key} className="border-b last:border-b-0">
                            <td className="px-3 py-2">{item.label}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatCents(item.billedCents)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatCents(item.openCents)}</td>
                            <td className="px-3 py-2 text-right">
                              <Input
                                aria-label={`Apply to ${item.label}`}
                                inputMode="decimal"
                                className="ml-auto h-8 w-28 text-right"
                                placeholder="0.00"
                                value={applied[key] ?? ""}
                                onChange={(event) => setApplied({ ...applied, [key]: event.target.value })}
                              />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-right text-sm tabular-nums text-muted-foreground">
                Applied {formatCents(appliedCents)} · {unappliedCents >= 0 ? `Unapplied ${formatCents(unappliedCents)}` : `Over by ${formatCents(-unappliedCents)}`}
              </p>
            </div>

            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || appliedCents <= 0 || unappliedCents < 0}>
                {applyMode ? "Apply payment" : "Record payment"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
