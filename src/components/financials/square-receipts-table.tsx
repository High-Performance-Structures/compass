"use client"

import Link from "next/link"
import * as React from "react"

import type { SquareReceiptListItem } from "@/app/actions/sage-square-receipts"
import type { ColumnDef } from "@tanstack/react-table"

import { useListSheetStartFilter } from "@/components/list-sheets/use-list-sheet"
import { RecordSearchInput, RecordTable, useRecordTable } from "@/components/record-table"
import { StatusFilterBar } from "@/components/status-filter-bar"
import { formatCents } from "@/lib/format"

type SquareReceiptsTableProps = {
  readonly receipts: readonly SquareReceiptListItem[]
  readonly selectedReceiptId: string | null
}

function statusLabel(status: string): string {
  if (status === "manual_action_required") return "Awaiting Sage receipt"
  if (status === "queued") return "Queued"
  if (status === "running") return "Processing"
  if (status === "succeeded") return "Posted in Sage"
  if (status === "already_in_sage") return "Already in Sage"
  if (status === "attention" || status === "failed") return "Needs review"
  return status.replaceAll("_", " ")
}

function statusClass(status: string): string {
  if (status === "attention" || status === "failed") {
    return "text-destructive"
  }
  if (status === "succeeded" || status === "already_in_sage") return "text-primary"
  return "text-muted-foreground"
}

/** Status buttons group the raw states the way the Status column names them. */
type ReceiptStatusFilter = "awaiting" | "in_progress" | "posted" | "review" | "other" | "all"

function receiptStatusGroup(status: string): Exclude<ReceiptStatusFilter, "all"> {
  if (status === "manual_action_required") return "awaiting"
  if (status === "queued" || status === "running") return "in_progress"
  if (status === "succeeded" || status === "already_in_sage") return "posted"
  if (status === "attention" || status === "failed") return "review"
  return "other"
}

const STATUS_FILTERS: readonly { readonly value: ReceiptStatusFilter; readonly label: string; readonly pinned?: boolean }[] = [
  { value: "review", label: "Needs review" },
  { value: "awaiting", label: "Awaiting Sage receipt" },
  { value: "in_progress", label: "Queued or processing" },
  { value: "posted", label: "Posted in Sage" },
  { value: "other", label: "Other" },
  { value: "all", label: "All", pinned: true },
]

const receiptRowId = (receipt: SquareReceiptListItem): string => receipt.id

function receiptHref(receipt: SquareReceiptListItem): string {
  return `/dashboard/projects/${encodeURIComponent(receipt.projectId)}/financials`
}

function receiptSearchText(receipt: SquareReceiptListItem): string {
  return [
    receipt.projectNumber,
    receipt.sageJobShortName,
    receipt.projectName,
    receipt.clientName,
    receipt.sageInvoiceNumber,
    receipt.squarePaymentId,
    statusLabel(receipt.receiptStatus),
  ].filter(Boolean).join(" ").toLowerCase()
}

function Right({ children }: { readonly children: React.ReactNode }): React.ReactElement {
  return <span className="block text-right">{children}</span>
}

/** The Square receipts sheet's columns (sheet "financials.square-receipts"). */
export function squareReceiptColumns(): ColumnDef<SquareReceiptListItem>[] {
  return [
    {
      id: "project",
      accessorFn: (receipt) => receipt.projectNumber ?? receipt.projectName,
      header: "Project / client",
      cell: ({ row: { original: receipt } }) => (
        <>
          <Link href={receiptHref(receipt)} className="font-medium underline-offset-4 hover:underline">
            {receipt.projectNumber ?? receipt.sageJobShortName ?? "Project"}
            {` — ${receipt.projectName}`}
          </Link>
          <div className="text-xs text-muted-foreground">{receipt.clientName ?? "Client not listed"}</div>
        </>
      ),
    },
    {
      id: "invoice",
      accessorFn: (receipt) => receipt.sageInvoiceNumber,
      header: "Sage invoice",
      cell: ({ row: { original: receipt } }) => (
        <>
          <div className="font-medium">{receipt.sageInvoiceNumber}</div>
          <div className="text-xs text-muted-foreground">
            Record {receipt.sageInvoiceId} · {receipt.department}
          </div>
        </>
      ),
    },
    {
      id: "payment",
      accessorFn: (receipt) => receipt.paymentCompletedAt,
      header: "Square payment",
      cell: ({ row: { original: receipt } }) => (
        <>
          <div className="font-mono text-xs">{receipt.squarePaymentId}</div>
          <div className="text-xs text-muted-foreground">{new Date(receipt.paymentCompletedAt).toLocaleString()}</div>
        </>
      ),
    },
    {
      id: "received",
      accessorFn: (receipt) => receipt.amountCents,
      header: () => <Right>Received</Right>,
      cell: ({ row: { original: receipt } }) => <Right><span className="font-medium">{formatCents(receipt.amountCents)}</span></Right>,
    },
    {
      id: "fee",
      accessorFn: (receipt) => receipt.feeCents,
      header: () => <Right>Square fee</Right>,
      cell: ({ row: { original: receipt } }) => (
        <Right>
          {formatCents(receipt.feeCents)}
          {receipt.feeStatus ? <span className="block text-xs text-muted-foreground">{statusLabel(receipt.feeStatus)}</span> : null}
        </Right>
      ),
    },
    {
      id: "status",
      accessorFn: (receipt) => statusLabel(receipt.receiptStatus),
      header: "Status",
      cell: ({ row: { original: receipt } }) => (
        <>
          <div className={statusClass(receipt.receiptStatus)}>{statusLabel(receipt.receiptStatus)}</div>
          {receipt.errorMessage ? (
            <div className="max-w-72 text-xs text-destructive">{receipt.errorMessage}</div>
          ) : (
            <div className="text-xs text-muted-foreground">
              Deposit {receipt.depositAccountNumber}; fees {receipt.merchantFeeAccountNumber}
            </div>
          )}
        </>
      ),
    },
  ]
}

export function SquareReceiptsTable({
  receipts,
  selectedReceiptId,
}: SquareReceiptsTableProps): React.ReactElement {
  const startFilter = useListSheetStartFilter("financials.square-receipts", "all")
  const [status, setStatus] = React.useState<ReceiptStatusFilter>(
    () => STATUS_FILTERS.find((option) => option.value === startFilter)?.value ?? "all",
  )
  const [search, setSearch] = React.useState("")
  const counts = React.useMemo(() => {
    const result: Record<ReceiptStatusFilter, number> = { awaiting: 0, in_progress: 0, posted: 0, review: 0, other: 0, all: receipts.length }
    for (const receipt of receipts) result[receiptStatusGroup(receipt.receiptStatus)] += 1
    return result
  }, [receipts])
  const rows = React.useMemo(() => {
    const query = search.trim().toLowerCase()
    return receipts.filter(
      (receipt) =>
        (status === "all" || receiptStatusGroup(receipt.receiptStatus) === status) &&
        (!query || receiptSearchText(receipt).includes(query)),
    )
  }, [receipts, status, search])
  const columns = React.useMemo(squareReceiptColumns, [])
  const table = useRecordTable({
    data: rows,
    columns,
    getRowId: receiptRowId,
    resetKey: `${status}|${search}`,
    initialItemId: selectedReceiptId,
    sheetId: "financials.square-receipts",
  })

  return (
    <section className="rounded-lg border">
      <div className="space-y-1 border-b px-4 py-3">
        <h3 className="font-medium">Square receipts</h3>
        <p className="text-sm text-muted-foreground">
          Payments received in Square, matched to an exact Compass project,
          and tracked through Sage posting. These do not require a second
          business approval.
        </p>
      </div>
      {receipts.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">
          No project-linked Square receipts have been recorded yet.
        </p>
      ) : (
        <div className="flex min-w-0 flex-col gap-3 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4">
            <StatusFilterBar
              kind="button"
              label="Filter Square receipts by status"
              selected={status}
              onSelect={setStatus}
              options={STATUS_FILTERS.map((option) => ({ ...option, count: counts[option.value] }))}
            />
            <RecordSearchInput
              value={search}
              onChange={setSearch}
              label="Search Square receipts"
              placeholder="Search project, client, invoice or payment…"
              className="sm:max-w-sm"
            />
          </div>
          <RecordTable
            table={table}
            itemLabel="Square receipts"
            emptyMessage="No Square receipts match this view."
            rowIdPrefix="square-receipt"
            focusedRowId={selectedReceiptId}
            getRowHref={receiptHref}
          />
        </div>
      )}
    </section>
  )
}
