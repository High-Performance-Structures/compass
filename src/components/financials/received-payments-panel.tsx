"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import type { ColumnDef } from "@tanstack/react-table"
import { IconCash } from "@tabler/icons-react"

import {
  voidReceivedPaymentWithReason,
  type ProjectReceivablesData,
} from "@/app/actions/received-payments"
import { EntitySearchInput, EntityTable } from "@/components/financials/entity-table"
import { RecordsEmpty, searchInputClass } from "@/components/financials/record-columns"
import { RecordPaymentDialog, type RecordPaymentTarget } from "@/components/financials/record-payment-dialog"
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
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { ReceivableRow, ReceivedPaymentView } from "@/lib/domain/financials/receivables"
import { VOID_REASON_MAX } from "@/lib/domain/financials/rules"
import { paymentMethodLabel, type ReceivablePaidState } from "@/lib/domain/financials/statuses"
import { formatCents, formatDate } from "@/lib/format"

/*
 * Billed items with their paid and open balances, and the payments received
 * against them. Shown on project financials (every item) and on a pay
 * application (that draw only). Payments are voided with a reason, never
 * deleted.
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
  if (payment.sourceSystem === "sage") return "Square bridge (see Square receipts)"
  return "Enter in Sage"
}

function appliedTo(payment: ReceivedPaymentView): string {
  const active = payment.allocations.filter((allocation) => !allocation.released || payment.voidedAt)
  return active.map((allocation) => `${allocation.itemLabel} ${formatCents(allocation.cents)}`).join(", ") || "-"
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
    cell: ({ row }) => <span className="tabular-nums">{formatCents(read(row.original))}</span>,
  }
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

  const receivables = applicationId
    ? data.receivables.filter((item) => item.kind === "pay_application" && item.id === applicationId)
    : data.receivables
  const payments = applicationId
    ? data.payments.filter((payment) => payment.allocations.some((allocation) => allocation.itemId === applicationId))
    : data.payments

  function confirmVoid(): void {
    if (!voiding) return
    const payment = voiding
    startTransition(async () => {
      const result = await voidReceivedPaymentWithReason(projectId, payment.id, reason)
      setMessage(result.success ? "Payment voided. Its applied amounts are open again." : result.error)
      if (result.success) {
        setVoiding(null)
        setReason("")
        router.refresh()
      }
    })
  }

  const itemColumns: ColumnDef<ReceivableRow>[] = [
    {
      id: "item",
      header: "Item",
      accessorFn: (item) => `${item.label} ${item.sageInvoiceNumber ?? ""}`,
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
    { id: "date", header: "Billed", accessorFn: (item) => item.date ?? "", cell: ({ row }) => formatDate(row.original.date, "medium", "-") },
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
        data.canRecord && row.original.openCents > 0 ? (
          <Button size="sm" variant="outline" onClick={() => setTarget({ focus: { kind: row.original.kind, id: row.original.id } })}>
            <IconCash className="size-4" />
            Record payment
          </Button>
        ) : null,
    },
  ]

  const paymentColumns: ColumnDef<ReceivedPaymentView>[] = [
    {
      id: "reference",
      header: "Reference",
      accessorFn: (payment) => `${payment.referenceNumber ?? ""} ${paymentMethodLabel(payment.paymentMethod)} ${appliedTo(payment)}`,
      cell: ({ row }) => <span className="font-medium">{row.original.referenceNumber || "-"}</span>,
    },
    { id: "received", header: "Received", accessorFn: (payment) => payment.paymentDate, cell: ({ row }) => formatDate(row.original.paymentDate, "medium", "-") },
    { id: "method", header: "Method", accessorFn: (payment) => paymentMethodLabel(payment.paymentMethod) },
    centsColumn<ReceivedPaymentView>("amount", "Amount", (payment) => payment.amountCents),
    { id: "appliedTo", header: "Applied to", accessorFn: appliedTo },
    centsColumn<ReceivedPaymentView>("unapplied", "Unapplied", (payment) => payment.unappliedCents),
    {
      id: "status",
      header: "Status",
      accessorFn: paymentState,
      cell: ({ row }) => (
        <div>
          <Badge variant={row.original.voidedAt ? "destructive" : "secondary"}>{paymentState(row.original)}</Badge>
          {row.original.voidedAt && (
            <p className="mt-1 max-w-56 truncate text-xs text-muted-foreground" title={row.original.voidReason ?? ""}>
              {row.original.voidReason}
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
        const editable = !payment.voidedAt && (payment.sourceSystem === "compass" || payment.sourceSystem === "manual")
        return (
          <div className="flex justify-end gap-2">
            {data.canRecord && editable && payment.unappliedCents > 0 && (
              <Button size="sm" variant="outline" onClick={() => setTarget({ paymentId: payment.id })}>Apply</Button>
            )}
            {data.canVoid && editable && (
              <Button size="sm" variant="outline" onClick={() => setVoiding(payment)}>Void</Button>
            )}
          </div>
        )
      },
    },
  ]

  return (
    <section className="space-y-4 rounded-lg border p-4">
      <div>
        <h2 className="text-base font-semibold">Payments received</h2>
        <p className="text-sm text-muted-foreground">
          What each billed item has been paid and still owes{data.clientName ? ` from ${data.clientName}` : ""}. Payments are entered in
          Sage by accounting; Compass does not post them.
        </p>
      </div>
      {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}

      <EntityTable
        data={receivables}
        columns={itemColumns}
        getRowId={(item) => `${item.kind}:${item.id}`}
        mobileToolbar={({ table }) => <EntitySearchInput table={table} columnId="item" placeholder="Search billed items..." className={searchInputClass.mobile} />}
        desktopToolbar={({ table }) => <EntitySearchInput table={table} columnId="item" placeholder="Search billed items..." className={searchInputClass.desktop} />}
        mobileRow={(item) => (
          <>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{item.label}</p>
              <p className="text-xs text-muted-foreground">
                {PAID_LABELS[item.paidState]} · {formatCents(item.openCents)} outstanding of {formatCents(item.billedCents)}
              </p>
            </div>
            {data.canRecord && item.openCents > 0 && (
              <Button size="sm" variant="outline" onClick={() => setTarget({ focus: { kind: item.kind, id: item.id } })}>Record</Button>
            )}
          </>
        )}
        mobileEmpty={<RecordsEmpty title="Nothing billed yet" hint="Approve a pay application for billing or send an invoice first." />}
        desktopEmpty="Nothing billed yet. Approve a pay application for billing or send an invoice first."
        itemLabel="billed items"
        paginationId={applicationId ? "pay-app-billed-items" : "project-billed-items"}
      />

      <EntityTable
        data={payments}
        columns={paymentColumns}
        getRowId={(payment) => payment.id}
        mobileToolbar={({ table }) => <EntitySearchInput table={table} columnId="reference" placeholder="Search payments..." className={searchInputClass.mobile} />}
        desktopToolbar={({ table }) => <EntitySearchInput table={table} columnId="reference" placeholder="Search payments..." className={searchInputClass.desktop} />}
        mobileRow={(payment) => (
          <>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {formatCents(payment.amountCents)} · {paymentMethodLabel(payment.paymentMethod)} {payment.referenceNumber ?? ""}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {formatDate(payment.paymentDate, "medium", "-")} · {paymentState(payment)} · {appliedTo(payment)}
              </p>
            </div>
            {data.canVoid && !payment.voidedAt && payment.sourceSystem !== "sage" && (
              <Button size="sm" variant="outline" onClick={() => setVoiding(payment)}>Void</Button>
            )}
          </>
        )}
        mobileEmpty={<RecordsEmpty title="No payments recorded" hint="Use Record payment on a billed item." />}
        desktopEmpty="No payments recorded yet."
        itemLabel="payments"
        paginationId={applicationId ? "pay-app-received-payments" : "project-received-payments"}
      />

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
              It stays on record as void, and what it applied is open again on each pay application or invoice. If it was
              already entered in Sage, reverse it there too.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="void-reason">Reason</Label>
            <Textarea
              id="void-reason"
              rows={3}
              maxLength={VOID_REASON_MAX}
              placeholder="Check returned, entered twice, wrong job..."
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
