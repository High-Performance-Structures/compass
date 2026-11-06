"use client"

import * as React from "react"
import Link from "next/link"
import type { ColumnDef, SortingState } from "@tanstack/react-table"

import { RecordSearchInput, RecordTable, useRecordTable } from "@/components/record-table"
import type { PurchaseOrderListRow } from "@/lib/domain/operations/types"
import { formatDate } from "@/lib/format"
import { PURCHASE_ORDER_STATUS_OPTIONS, statusLabel } from "@/lib/project-operations/status"
import { formatPurchaseOrderMoney } from "@/lib/purchase-orders/money"
import { purchaseOrderRecordHref } from "@/lib/purchase-orders/record-href"
import { canonicalPurchaseOrderStatus } from "@/lib/purchase-orders/status-filter"

const rowId = (row: PurchaseOrderListRow): string => row.id
// PO sheets open sorted by required date, soonest first (blank dates last).
const REQUIRED_DATE_FIRST: SortingState = [{ id: "dueDate", desc: false }]

/** Status sorts in workflow order (draft first, void last), not alphabetically. */
function statusSortValue(status: string): number {
  const canonical = canonicalPurchaseOrderStatus(status)
  const index = PURCHASE_ORDER_STATUS_OPTIONS.findIndex((option) => option.value === canonical)
  return index < 0 ? PURCHASE_ORDER_STATUS_OPTIONS.length : index
}

/** The PO's record on its job's purchase order page. */
function rowHref(row: PurchaseOrderListRow, statusFilter: string): string {
  return purchaseOrderRecordHref(row.projectId, row.id, statusFilter)
}

function projectLabel(row: PurchaseOrderListRow): string {
  return [row.projectNumber, row.projectName].filter(Boolean).join(" · ") || "Project"
}

function matchesSearch(row: PurchaseOrderListRow, query: string, showProject: boolean): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return [
    row.number,
    row.title,
    row.description,
    row.vendorName,
    row.siteContactName,
    statusLabel(row.status),
    showProject ? row.projectNumber : null,
    showProject ? row.projectName : null,
  ].some((value) => value?.toLowerCase().includes(needle))
}

function DateCell({ value }: { readonly value: string | null }): React.ReactElement {
  return <span className="whitespace-nowrap tabular-nums">{formatDate(value, "medium", "—")}</span>
}

function purchaseOrderColumns(showProject: boolean, statusFilter: string): ColumnDef<PurchaseOrderListRow>[] {
  const columns: (ColumnDef<PurchaseOrderListRow> | null)[] = [
    {
      id: "number",
      accessorFn: (row) => row.number ?? undefined,
      header: "P.O. number",
      size: 140,
      cell: ({ row: { original } }) => (
        <Link
          href={rowHref(original, statusFilter)}
          className="whitespace-nowrap font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {original.number ?? "Unnumbered"}
        </Link>
      ),
    },
    {
      id: "title",
      accessorFn: (row) => row.title,
      header: "Title",
      size: 240,
      cell: ({ row: { original } }) => (
        <div className="min-w-40 space-y-1">
          <p className="break-words font-medium">{original.title}</p>
          {original.description && original.description !== original.title && (
            <p className="line-clamp-2 break-words text-xs text-muted-foreground">{original.description}</p>
          )}
        </div>
      ),
    },
    showProject
      ? {
          id: "project",
          accessorFn: (row) => projectLabel(row),
          header: "Project",
          size: 180,
          cell: ({ row: { original } }) => (
            <div className="min-w-32 space-y-0.5">
              <p className="whitespace-nowrap font-medium">{original.projectNumber ?? "Project"}</p>
              {original.projectName && <p className="break-words text-xs text-muted-foreground">{original.projectName}</p>}
            </div>
          ),
        }
      : null,
    {
      id: "vendor",
      accessorFn: (row) => row.vendorName ?? undefined,
      header: "Vendor",
      size: 160,
      cell: ({ row }) => row.original.vendorName ?? <span className="text-muted-foreground">Vendor TBD</span>,
    },
    {
      id: "status",
      accessorFn: (row) => statusSortValue(row.status),
      header: "Status",
      size: 110,
      cell: ({ row }) => <span className="whitespace-nowrap">{statusLabel(row.original.status)}</span>,
    },
    {
      id: "siteContact",
      accessorFn: (row) => row.siteContactName ?? undefined,
      header: "Site contact",
      size: 140,
      cell: ({ row }) => row.original.siteContactName ?? <span className="text-muted-foreground">—</span>,
    },
    {
      id: "orderDate",
      accessorFn: (row) => row.orderDate ?? undefined,
      header: "Order date",
      size: 115,
      cell: ({ row }) => <DateCell value={row.original.orderDate} />,
    },
    {
      id: "dueDate",
      accessorFn: (row) => row.dueDate ?? undefined,
      header: "Required",
      size: 115,
      cell: ({ row }) => <DateCell value={row.original.dueDate} />,
    },
    {
      id: "amount",
      accessorFn: (row) => row.amount ?? undefined,
      header: "Amount",
      size: 120,
      cell: ({ row }) => (
        <span className="block whitespace-nowrap text-right tabular-nums">{formatPurchaseOrderMoney(row.original.amount)}</span>
      ),
    },
  ]
  return columns.filter((column): column is ColumnDef<PurchaseOrderListRow> => column !== null)
}

/**
 * A purchase order sheet: a job's POs, or every job's (with a Project
 * column). It opens sorted by required date. Sort by a column header, search,
 * and click a row to open the PO's record. The status filter buttons sit
 * above it, on the page.
 */
export function PurchaseOrderRecordTable({
  rows,
  allJobs,
  statusFilter,
  selectedId = null,
  emptyMessage,
}: {
  readonly rows: readonly PurchaseOrderListRow[]
  /** Every job's POs: adds the Project column. */
  readonly allJobs: boolean
  /** The job page status filter a row link keeps. */
  readonly statusFilter: string
  /** The PO open below the list: its page is shown first. */
  readonly selectedId?: string | null
  readonly emptyMessage: string
}): React.ReactElement {
  const [query, setQuery] = React.useState("")
  const visibleRows = React.useMemo(
    () => rows.filter((row) => matchesSearch(row, query, allJobs)),
    [rows, query, allJobs],
  )
  const columns = React.useMemo(() => purchaseOrderColumns(allJobs, statusFilter), [allJobs, statusFilter])
  const table = useRecordTable({
    data: visibleRows,
    columns,
    getRowId: rowId,
    resetKey: query,
    initialItemId: selectedId,
    initialSorting: REQUIRED_DATE_FIRST,
  })

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <RecordSearchInput
        value={query}
        onChange={setQuery}
        label="Search purchase orders"
        placeholder={allJobs ? "Search P.O., title, project, vendor or contact…" : "Search P.O., title, vendor or contact…"}
        className="sm:max-w-md"
      />
      <RecordTable
        table={table}
        itemLabel="purchase orders"
        emptyMessage={query ? "No purchase orders match this search." : emptyMessage}
        rowIdPrefix="purchase-order-row"
        getRowHref={(row) => rowHref(row, statusFilter)}
      />
    </div>
  )
}
