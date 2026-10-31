"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import type { ColumnDef } from "@tanstack/react-table"
import { IconCash, IconSearch } from "@tabler/icons-react"

import {
  voidReceivedPaymentWithReason,
  type ProjectReceivablesData,
} from "@/app/actions/received-payments"
import { RecordPaymentDialog, type RecordPaymentTarget } from "@/components/financials/record-payment-dialog"
import { RecordTable, useRecordTable } from "@/components/record-table"
import { Badge } from "@/components/ui/badge"
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
import { Textarea } from "@/components/ui/textarea"
import type { ReceivableRow, ReceivedPaymentView } from "@/lib/domain/financials/receivables"
import { VOID_REASON_MAX } from "@/lib/domain/financials/rules"
import { paymentMethodLabel, type ReceivablePaidState } from "@/lib/domain/financials/statuses"
import { formatCents, formatDate } from "@/lib/format"

/*
 * Billed items with their paid and outstanding balances, and the payments
 * received against them. Shown on project financials (every item) and on a
 * pay application (that draw only). Both lists follow the record-list
 * standard (shared RecordTable, sortable headers, search, 25/50/100 paging).
 * Payments are voided with a reason, never deleted.
 */

const PAID_LABELS: Readonly<Record<ReceivablePaidState, string>> = {
  open: "Open",
  partially_paid: "Partially paid",
  paid: "Paid",
}

function paidVariant(state: ReceivablePaidState): "default" | "secondary" | "outline" {
  if (state === "paid") return "default"
  return state === "partially_paid" ? "secondary" : "outline"
}

function paymentState(payment: ReceivedPaymentView): string {
  if (payment.voidedAt) return "Void"
  if (payment.appliedCents === 0) return "Unapplied"
  return payment.unappliedCents > 0 ? "Partly applied" : "Applied"
}

/** Compass never posts receipts to Sage; say where the receipt stands instead. */
function sageStatus(payment: ReceivedPaymentView): string {
  if (payment.sourceSystem === "sage") return "Posted by the Square bridge"
  if (payment.voidedAt) return "Reverse in Sage if entered"
  return "Enter in Sage"
}

function appliedTo(payment: ReceivedPaymentView): string {
  return payment.allocations.map((allocation) => `${allocation.itemLabel} ${formatCents(allocation.cents)}`).join(", ") || "-"
}

function itemHref(projectId: string, item: ReceivableRow): string | null {
  return item.kind === "pay_application" ? `/dashboard/projects/${projectId}/financials/pay-applications/${item.id}` : null
}

function linkedTarget(data: ProjectReceivablesData, link: string | null): RecordPaymentTarget | null {
  if (!link || !data.canRecord) return null
  const item = data.receivables.find((entry) => `${entry.kind}:${entry.id}` === link && entry.openCents > 0)
  return item ? { focus: { kind: item.kind, id: item.id } } : null
}

function centsColumn<T>(id: string, header: string, read: (row: T) => number): ColumnDef<T> {
  return {
    id,
    header,
    accessorFn: read,
    cell: ({ row }) => <span className="block text-right tabular-nums">{formatCents(read(row.original))}</span>,
  }
}

function canChange(payment: ReceivedPaymentView): boolean {
  return !payment.voidedAt && (payment.sourceSystem === "compass" || payment.sourceSystem === "manual")
}

function matches(query: string, values: readonly (string | null)[]): boolean {
  const needle = query.trim().toLowerCase()
  return !needle || values.some((value) => value?.toLowerCase().includes(needle))
}

function SearchBox({
  value,
  onChange,
  label,
}: {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly label: string
}): React.ReactElement {
  return (
    <div className="relative w-full sm:max-w-sm">
      <IconSearch aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={value} aria-label={label} placeholder={`${label}…`} onChange={(event) => onChange(event.target.value)} className="pl-9" />
    </div>
  )
}

function BilledItemsList({
  projectId,
  items,
  canRecord,
  onRecord,
}: {
  readonly projectId: string
  readonly items: readonly ReceivableRow[]
  readonly canRecord: boolean
  readonly onRecord: (item: ReceivableRow) => void
}): React.ReactElement {
  const [query, setQuery] = React.useState("")
  const visible = React.useMemo(
    () => items.filter((item) => matches(query, [item.label, item.sageInvoiceNumber, PAID_LABELS[item.paidState]])),
    [items, query],
  )
  const columns = React.useMemo<ColumnDef<ReceivableRow>[]>(() => [
    {
      id: "item",
      header: "Item",
      accessorFn: (item) => item.label,
      cell: ({ row }) => {
        const href = itemHref(projectId, row.original)
        return (
          <div className="min-w-0">
            {href ? <Link href={href} className="font-medium hover:underline">{row.original.label}</Link> : <span className="font-medium">{row.original.label}</span>}
            {row.original.sageInvoiceNumber && <p className="text-xs text-muted-foreground">Sage invoice {row.original.sageInvoiceNumber}</p>}
          </div>
        )
      },
    },
    { id: "date", header: "Billed", accessorFn: (item) => item.date ?? undefined, cell: ({ row }) => formatDate(row.original.date, "medium", "-") },
    centsColumn<ReceivableRow>("billed", "Amount", (item) => item.billedCents),
    centsColumn<ReceivableRow>("paid", "Paid", (item) => item.paidCents),
    centsColumn<ReceivableRow>("open", "Outstanding", (item) => item.openCents),
    {
      id: "status",
      header: "Status",
      accessorFn: (item) => PAID_LABELS[item.paidState],
      cell: ({ row }) => <Badge variant={paidVariant(row.original.paidState)}>{PAID_LABELS[row.original.paidState]}</Badge>,
    },
    {
      id: "actions",
      enableSorting: false,
      cell: ({ row }) =>
        canRecord && row.original.openCents > 0 ? (
          <Button size="sm" variant="outline" onClick={() => onRecord(row.original)}>
            <IconCash className="size-4" />
            Record payment
          </Button>
        ) : null,
    },
  ], [projectId, canRecord, onRecord])
  const table = useRecordTable({ data: visible, columns, getRowId: (item) => `${item.kind}:${item.id}`, resetKey: query })
  return (
    <div className="space-y-3">
      <SearchBox value={query} onChange={setQuery} label="Search billed items" />
      <RecordTable table={table} itemLabel="billed items" emptyMessage="Nothing billed yet. Approve a pay application for billing or send an invoice first." rowIdPrefix="billed-item" />
    </div>
  )
}

function PaymentsList({
  payments,
  canRecord,
  canVoid,
  onApply,
  onVoid,
}: {
  readonly payments: readonly ReceivedPaymentView[]
  readonly canRecord: boolean
  readonly canVoid: boolean
  readonly onApply: (payment: ReceivedPaymentView) => void
  readonly onVoid: (payment: ReceivedPaymentView) => void
}): React.ReactElement {
  const [query, setQuery] = React.useState("")
  const visible = React.useMemo(
    () => payments.filter((payment) => matches(query, [
      payment.referenceNumber, paymentMethodLabel(payment.paymentMethod), appliedTo(payment), paymentState(payment), payment.voidReason,
    ])),
    [payments, query],
  )
  const columns = React.useMemo<ColumnDef<ReceivedPaymentView>[]>(() => [
    {
      id: "reference",
      header: "Reference",
      accessorFn: (payment) => payment.referenceNumber ?? undefined,
      cell: ({ row }) => <span className="font-medium">{row.original.referenceNumber || "-"}</span>,
    },
    { id: "received", header: "Received", accessorFn: (payment) => payment.paymentDate, cell: ({ row }) => formatDate(row.original.paymentDate, "medium", "-") },
    { id: "method", header: "Method", accessorFn: (payment) => paymentMethodLabel(payment.paymentMethod) },
    centsColumn<ReceivedPaymentView>("amount", "Amount", (payment) => payment.amountCents),
    {
      id: "appliedTo",
      header: "Applied to",
      accessorFn: appliedTo,
      cell: ({ row }) => (
        <ul className="space-y-0.5 text-sm">
          {row.original.allocations.map((allocation) => (
            <li key={allocation.id} className={allocation.released ? "text-muted-foreground line-through" : undefined}>
              {allocation.itemLabel} {formatCents(allocation.cents)}
            </li>
          ))}
          {row.original.allocations.length === 0 && <li>-</li>}
        </ul>
      ),
    },
    centsColumn<ReceivedPaymentView>("unapplied", "Unapplied", (payment) => payment.unappliedCents),
    {
      id: "status",
      header: "Status",
      accessorFn: paymentState,
      cell: ({ row }) => (
        <div>
          <Badge variant={row.original.voidedAt ? "destructive" : "secondary"}>{paymentState(row.original)}</Badge>
          {row.original.voidedAt && (
            <p className="mt-1 max-w-56 text-xs text-muted-foreground">
              {row.original.voidReason}
              {row.original.voidedByName ? ` (${row.original.voidedByName})` : ""}
            </p>
          )}
        </div>
      ),
    },
    { id: "sage", header: "Sage", accessorFn: sageStatus },
    {
      id: "actions",
      enableSorting: false,
      cell: ({ row }) => {
        const payment = row.original
        if (!canChange(payment)) return null
        return (
          <div className="flex justify-end gap-2">
            {canRecord && payment.unappliedCents > 0 && (
              <Button size="sm" variant="outline" onClick={() => onApply(payment)}>Apply</Button>
            )}
            {canVoid && <Button size="sm" variant="outline" onClick={() => onVoid(payment)}>Void</Button>}
          </div>
        )
      },
    },
  ], [canRecord, canVoid, onApply, onVoid])
  const table = useRecordTable({ data: visible, columns, getRowId: (payment) => payment.id, resetKey: query })
  return (
    <div className="space-y-3">
      <SearchBox value={query} onChange={setQuery} label="Search payments" />
      <RecordTable table={table} itemLabel="payments" emptyMessage="No payments recorded yet." rowIdPrefix="received-payment" />
    </div>
  )
}

export function ReceivedPaymentsPanel({
  projectId,
  data,
  applicationId = null,
  recordPayment = null,
}: {
  readonly projectId: string
  readonly data: ProjectReceivablesData
  /** On a pay application page: only that draw and the payments applied to it. */
  readonly applicationId?: string | null
  /** "invoice:<id>" or "pay_application:<id>" from a link: open Record payment for it. */
  readonly recordPayment?: string | null
}): React.ReactElement {
  const router = useRouter()
  const [target, setTarget] = React.useState<RecordPaymentTarget | null>(() => linkedTarget(data, recordPayment))
  const [voiding, setVoiding] = React.useState<ReceivedPaymentView | null>(null)
  const [reason, setReason] = React.useState("")
  const [message, setMessage] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()

  const receivables = React.useMemo(
    () => (applicationId ? data.receivables.filter((item) => item.kind === "pay_application" && item.id === applicationId) : data.receivables),
    [data.receivables, applicationId],
  )
  const payments = React.useMemo(
    () => (applicationId
      ? data.payments.filter((payment) => payment.allocations.some((allocation) => allocation.itemId === applicationId))
      : data.payments),
    [data.payments, applicationId],
  )
  const onRecord = React.useCallback((item: ReceivableRow) => setTarget({ focus: { kind: item.kind, id: item.id } }), [])
  const onApply = React.useCallback((payment: ReceivedPaymentView) => setTarget({ paymentId: payment.id }), [])
  const onVoid = React.useCallback((payment: ReceivedPaymentView) => {
    setReason("")
    setVoiding(payment)
  }, [])

  function confirmVoid(): void {
    if (!voiding) return
    const payment = voiding
    startTransition(async () => {
      const result = await voidReceivedPaymentWithReason(projectId, payment.id, reason)
      setMessage(result.success ? "Payment voided. What it applied is outstanding again." : result.error)
      if (result.success) {
        setVoiding(null)
        router.refresh()
      }
    })
  }

  return (
    <section className="space-y-5 rounded-lg border p-4">
      <div>
        <h2 className="text-base font-semibold">Payments received</h2>
        <p className="text-sm text-muted-foreground">
          What each billed item has been paid and still owes{data.clientName ? ` from ${data.clientName}` : ""}. Accounting
          enters receipts in Sage; Compass does not post them.
        </p>
      </div>
      {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}

      <BilledItemsList projectId={projectId} items={receivables} canRecord={data.canRecord} onRecord={onRecord} />
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Payments</h3>
        <PaymentsList payments={payments} canRecord={data.canRecord} canVoid={data.canVoid} onApply={onApply} onVoid={onVoid} />
      </div>

      <RecordPaymentDialog
        projectId={projectId}
        target={target}
        onOpenChange={(open) => {
          if (!open) setTarget(null)
        }}
        onMessage={setMessage}
      />

      <Dialog open={voiding !== null} onOpenChange={(open) => { if (!open) setVoiding(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void this {voiding ? formatCents(voiding.amountCents) : ""} payment?</DialogTitle>
            <DialogDescription>
              It stays on record as void, and what it applied is outstanding again on each pay application or invoice. If it
              was already entered in Sage, reverse it there too.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="void-reason">Reason</Label>
            <Textarea
              id="void-reason"
              rows={3}
              maxLength={VOID_REASON_MAX}
              placeholder="Check returned, entered twice, wrong job…"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoiding(null)} disabled={pending}>Keep payment</Button>
            <Button variant="destructive" onClick={confirmVoid} disabled={pending || reason.trim() === ""}>Void payment</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
