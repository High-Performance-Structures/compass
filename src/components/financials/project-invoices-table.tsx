"use client"

import * as React from "react"
import Link from "next/link"
import type { ColumnDef } from "@tanstack/react-table"

import { RecordSearchInput, RecordTable, useRecordTable } from "@/components/record-table"
import { RecordStatusBadge } from "@/components/record-status-badge"
import type { RecordStatusColor } from "@/lib/domain/record-statuses/statuses"
import type { SimpleInvoiceListItem } from "@/lib/financials/simple-invoices-server"
import { formatCents, formatDate } from "@/lib/format"

const STATUS: Readonly<Record<string, { readonly label: string; readonly color: RecordStatusColor }>> = {
  draft: { label: "Draft", color: "gray" },
  open: { label: "Open", color: "blue" },
  partially_paid: { label: "Partly paid", color: "orange" },
  paid: { label: "Paid", color: "green" },
  void: { label: "Void", color: "gray" },
}

const SAGE: Readonly<Record<string, string>> = {
  queued: "Sage: queued",
  running: "Sage: sending",
  succeeded: "In Sage",
  failed: "Sage: failed",
  needs_attention: "Sage: needs attention",
  cancelled: "",
}

function sentLabel(item: SimpleInvoiceListItem): string {
  return [
    item.sageStatus ? SAGE[item.sageStatus] ?? "" : "",
    item.emailedAt ? "Emailed" : "",
    item.squareState === "published" ? "Square" : "",
  ]
    .filter(Boolean)
    .join(" · ")
}

/** The Invoices sheet's columns (registry sheet "invoices.job"). */
export function invoiceColumns(href: (item: SimpleInvoiceListItem) => string): ColumnDef<SimpleInvoiceListItem>[] {
  return [
    {
      id: "number",
      accessorFn: (item) => item.invoiceNumber ?? "",
      header: "Invoice",
      size: 150,
      cell: ({ row: { original } }) => (
        <Link href={href(original)} className="whitespace-nowrap font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {original.invoiceNumber ?? "Draft"}
          {original.invoiceKind === "credit_memo" ? <span className="ml-1 text-xs font-normal text-muted-foreground">(credit memo)</span> : null}
        </Link>
      ),
    },
    {
      id: "title",
      accessorFn: (item) => item.title?.toLocaleLowerCase() ?? undefined,
      header: "Description",
      size: 240,
      cell: ({ row: { original } }) => <span className="break-words">{original.title ?? ""}</span>,
    },
    {
      id: "billTo",
      accessorFn: (item) => item.customerName?.toLocaleLowerCase() ?? undefined,
      header: "Bill to",
      size: 180,
      cell: ({ row: { original } }) => <span className="break-words">{original.customerName ?? ""}</span>,
    },
    {
      id: "date",
      accessorFn: (item) => item.issueDate,
      header: "Date",
      size: 110,
      cell: ({ row: { original } }) => <span className="whitespace-nowrap tabular-nums">{formatDate(original.issueDate)}</span>,
    },
    {
      id: "total",
      accessorFn: (item) => item.totalCents,
      header: "Total",
      size: 120,
      cell: ({ row: { original } }) => <span className="block whitespace-nowrap text-right tabular-nums">{original.invoiceKind === "credit_memo" ? `(${formatCents(original.totalCents)})` : formatCents(original.totalCents)}</span>,
    },
    {
      id: "paid",
      accessorFn: (item) => item.amountPaidCents,
      header: "Paid",
      size: 110,
      cell: ({ row: { original } }) => <span className="block whitespace-nowrap text-right tabular-nums">{formatCents(original.amountPaidCents)}</span>,
    },
    {
      id: "status",
      accessorFn: (item) => item.status,
      header: "Status",
      size: 120,
      cell: ({ row: { original } }) => {
        const status = STATUS[original.status] ?? { label: original.status, color: "gray" }
        return <RecordStatusBadge label={status.label} color={status.color} />
      },
    },
    {
      id: "sent",
      accessorFn: (item) => sentLabel(item) || undefined,
      header: "Sent",
      size: 180,
      cell: ({ row: { original } }) => <span className="text-xs text-muted-foreground">{sentLabel(original)}</span>,
    },
  ]
}

export function ProjectInvoicesTable({ projectId, invoices }: { readonly projectId: string; readonly invoices: readonly SimpleInvoiceListItem[] }): React.ReactElement {
  const [query, setQuery] = React.useState("")
  const href = React.useCallback((item: SimpleInvoiceListItem) => `/dashboard/projects/${projectId}/financials/invoices/${item.id}`, [projectId])
  const columns = React.useMemo(() => invoiceColumns(href), [href])
  const needle = query.trim().toLocaleLowerCase()
  const data = React.useMemo(
    () =>
      needle
        ? invoices.filter((item) => [item.invoiceNumber, item.title, item.customerName].some((value) => value?.toLocaleLowerCase().includes(needle)))
        : invoices,
    [invoices, needle]
  )
  const table = useRecordTable({ data, columns, getRowId: (item) => item.id, resetKey: needle, sheetId: "invoices.job" })
  return (
    <div className="space-y-2">
      <RecordSearchInput value={query} onChange={setQuery} placeholder="Search invoices" label="Search invoices" className="sm:max-w-xs" />
      <RecordTable table={table} itemLabel="invoices" emptyMessage="No invoices yet." getRowHref={href} rowIdPrefix="invoice" />
    </div>
  )
}
