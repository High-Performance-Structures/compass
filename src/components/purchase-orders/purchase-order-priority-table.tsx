"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import type { ColumnDef } from "@tanstack/react-table"

import { reorderPurchaseOrderPriority } from "@/app/actions/purchase-order-priority"
import { RecordSearchInput, RecordTable } from "@/components/record-table"
import { usePriorityRecordTable } from "@/components/record-table-priority"
import type { ActionDone } from "@/lib/action-result"
import type { PriorityOrderScope, PurchaseOrderListRow } from "@/lib/domain/operations/types"
import { formatDate } from "@/lib/format"
import { statusLabel } from "@/lib/project-operations/status"
import { formatPurchaseOrderMoney } from "@/lib/purchase-orders/money"

const rowId = (row: PurchaseOrderListRow): string => row.id
const rowLabel = (row: PurchaseOrderListRow): string => row.number ?? row.title

/** The PO's record on its job's purchase order page. */
function purchaseOrderRecordHref(row: PurchaseOrderListRow, statusFilter: string): string {
  const project = encodeURIComponent(row.projectId)
  const item = encodeURIComponent(row.id)
  return `/dashboard/projects/${project}/purchase-orders?status=${encodeURIComponent(statusFilter)}&item=${item}#purchase-order-${item}`
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
          href={purchaseOrderRecordHref(original, statusFilter)}
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
      accessorFn: (row) => statusLabel(row.status),
      header: "Status",
      size: 110,
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
 * Purchase orders in ordering priority: a job's PO list, or the company-wide
 * ordering queue (with a Project column). Rows open the PO's record.
 */
export function PurchaseOrderPriorityTable({
  rows,
  scope,
  canReorder,
  statusFilter,
  selectedId = null,
  emptyMessage,
}: {
  readonly rows: readonly PurchaseOrderListRow[]
  readonly scope: PriorityOrderScope
  readonly canReorder: boolean
  /** The job page status filter a row link keeps ("all" from the queue). */
  readonly statusFilter: string
  /** The PO open below the list: its page is shown first. */
  readonly selectedId?: string | null
  readonly emptyMessage: string
}): React.ReactElement {
  const router = useRouter()
  const [query, setQuery] = React.useState("")
  const showProject = scope.kind === "organization"
  const visibleRows = React.useMemo(
    () => rows.filter((row) => matchesSearch(row, query, showProject)),
    [rows, query, showProject],
  )
  const columns = React.useMemo(() => purchaseOrderColumns(showProject, statusFilter), [showProject, statusFilter])
  const onReorder = React.useCallback(
    async (previousIds: readonly string[], orderedIds: readonly string[]): Promise<ActionDone> => {
      const result = await reorderPurchaseOrderPriority({ scope, previousIds, orderedIds })
      if (result.success) router.refresh()
      return result
    },
    [scope, router],
  )
  const { table, priority } = usePriorityRecordTable({
    data: visibleRows,
    columns,
    getRowId: rowId,
    resetKey: query,
    initialItemId: selectedId,
    priorityOrder: {
      label: "Ordering priority",
      canReorder,
      searching: query.trim() !== "",
      getLabel: rowLabel,
      onReorder,
    },
  })

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <RecordSearchInput
        value={query}
        onChange={setQuery}
        label="Search purchase orders"
        placeholder={showProject ? "Search P.O., title, project, vendor or contact…" : "Search P.O., title, vendor or contact…"}
        className="sm:max-w-md"
      />
      <RecordTable
        table={table}
        priority={priority}
        itemLabel="purchase orders"
        emptyMessage={query ? "No purchase orders match this search." : emptyMessage}
        rowIdPrefix="purchase-order-row"
        getRowHref={(row) => purchaseOrderRecordHref(row, statusFilter)}
      />
    </div>
  )
}
