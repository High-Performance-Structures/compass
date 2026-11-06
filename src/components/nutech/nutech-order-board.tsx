"use client"

import * as React from "react"
import Link from "next/link"
import type { ColumnDef, SortingState } from "@tanstack/react-table"

import type { NuTechOrderBoardView } from "@/app/actions/nutech-order-board"
import { RecordSearchInput, RecordTable, useRecordTable } from "@/components/record-table"
import { StatusFilterBar } from "@/components/status-filter-bar"
import { formatDate } from "@/lib/format"
import {
  matchesNuTechBoardStatus,
  NUTECH_BOARD_QUEUES,
  type NuTechBoardQueue,
  type NuTechBoardRow,
  type NuTechBoardStatusFilter,
} from "@/lib/nutech/order-board"
import { NUTECH_ORDER_STATUS_OPTIONS } from "@/lib/nutech/workflow"
import { cn } from "@/lib/utils"

const rowId = (row: NuTechBoardRow): string => row.orderId
// Soonest pickup or delivery first; orders with no date go last.
const REQUESTED_DATE_FIRST: SortingState = [{ id: "requested", desc: false }]

function orderHref(row: NuTechBoardRow): string {
  return `/dashboard/projects/${encodeURIComponent(row.projectId)}/nutech?order=${encodeURIComponent(row.orderId)}`
}

function orderLabel(row: NuTechBoardRow): string {
  return row.orderTitle ? `Order ${row.orderNumber} · ${row.orderTitle}` : `Order ${row.orderNumber}`
}

/** Status sorts in workflow order, not alphabetically. */
function statusSortValue(row: NuTechBoardRow): number {
  return NUTECH_ORDER_STATUS_OPTIONS.findIndex((option) => option.value === row.orderStatus)
}

function queueText(queue: NuTechBoardQueue, view: NuTechOrderBoardView): { readonly label: string; readonly rule: string } {
  const manufacturer = view.manufacturerName || "the manufacturer"
  const { shipsWithinDays, confirmationBusinessDays, invoiceAfterDeliveryDays } = view.settings
  switch (queue) {
    case "ships_soon":
      return {
        label: "Ships soon",
        rule: `Pickup or delivery requested within ${shipsWithinDays} days. Unpaid orders show in the Paid column.`,
      }
    case "approved_unpaid":
      return { label: "Approved, not paid", rule: "The customer approved, and no payment is recorded." }
    case "unconfirmed":
      return {
        label: `PO sent, ${view.manufacturerName || "manufacturer"} hasn't confirmed`,
        rule: `No confirmation from ${manufacturer} ${confirmationBusinessDays === 1 ? "1 business day" : `${confirmationBusinessDays} business days`} after the PO.`,
      }
    case "no_invoice":
      return {
        label: "Past pickup or delivery, no invoice",
        rule: `Confirmed, ${invoiceAfterDeliveryDays} or more days past the date, and no vendor invoice.`,
      }
  }
}

function matchesSearch(row: NuTechBoardRow, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return [
    row.projectNumber,
    row.projectName,
    row.clientName,
    row.orderTitle,
    row.statusLabel,
    row.vendorConfirmationNumber,
    row.vendorInvoiceNumber,
    row.nextStep,
  ].some((value) => value?.toLowerCase().includes(needle))
}

function DateCell({ value, empty = "—" }: { readonly value: string | null; readonly empty?: string }): React.ReactElement {
  return <span className="whitespace-nowrap tabular-nums">{formatDate(value, "medium", empty)}</span>
}

function boardColumns(): ColumnDef<NuTechBoardRow>[] {
  return [
    {
      id: "order",
      accessorFn: (row) => `${row.projectNumber ?? ""} ${String(row.orderNumber).padStart(3, "0")}`,
      header: "Order",
      size: 160,
      cell: ({ row: { original } }) => (
        <div className="min-w-32 space-y-0.5">
          <Link
            href={orderHref(original)}
            className="whitespace-nowrap font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {original.projectNumber ?? original.projectName}
          </Link>
          <p className="break-words text-xs text-muted-foreground">{orderLabel(original)}</p>
        </div>
      ),
    },
    {
      id: "customer",
      accessorFn: (row) => row.clientName ?? row.projectName,
      header: "Customer",
      size: 160,
      cell: ({ row }) => <span className="break-words">{row.original.clientName ?? row.original.projectName}</span>,
    },
    {
      id: "status",
      accessorFn: statusSortValue,
      header: "Status",
      size: 140,
      cell: ({ row }) => <span className="whitespace-nowrap">{row.original.statusLabel}</span>,
    },
    {
      id: "paid",
      accessorFn: (row) => row.customerPaidAt ?? undefined,
      header: "Customer paid",
      size: 120,
      cell: ({ row: { original } }) =>
        original.customerPaidAt ? (
          <DateCell value={original.customerPaidAt} />
        ) : (
          <span className={cn("whitespace-nowrap", original.queues.includes("approved_unpaid") ? "font-medium text-warning" : "text-muted-foreground")}>
            Not paid
          </span>
        ),
    },
    {
      id: "released",
      accessorFn: (row) => row.purchaseOrderReleasedAt ?? undefined,
      header: "PO sent",
      size: 115,
      cell: ({ row }) => <DateCell value={row.original.purchaseOrderReleasedAt} />,
    },
    {
      id: "confirmation",
      accessorFn: (row) => row.vendorConfirmationNumber ?? undefined,
      header: "Confirmation",
      size: 130,
      cell: ({ row: { original } }) =>
        original.vendorConfirmationNumber ? (
          <span className="whitespace-nowrap">{original.vendorConfirmationNumber}</span>
        ) : (
          <span className={cn("whitespace-nowrap", original.queues.includes("unconfirmed") ? "font-medium text-warning" : "text-muted-foreground")}>
            {original.queues.includes("unconfirmed") ? "Not confirmed" : "—"}
          </span>
        ),
    },
    {
      id: "requested",
      accessorFn: (row) => row.requestedDeliveryDate ?? undefined,
      header: "Requested date",
      size: 125,
      cell: ({ row }) => <DateCell value={row.original.requestedDeliveryDate} empty="Not set" />,
    },
    {
      id: "method",
      accessorFn: (row) => row.deliveryMethod,
      header: "Pickup / delivery",
      size: 120,
      cell: ({ row }) => (
        <span className="whitespace-nowrap">
          {row.original.deliveryMethod === "delivery" ? "Delivery" : row.original.deliveryMethod === "customer_pickup" ? "Customer pickup" : "Will call"}
        </span>
      ),
    },
    {
      id: "invoice",
      accessorFn: (row) => row.vendorInvoiceNumber ?? undefined,
      header: "Vendor invoice",
      size: 130,
      cell: ({ row: { original } }) =>
        original.vendorInvoiceNumber ? (
          <span className="whitespace-nowrap">{original.vendorInvoiceNumber}</span>
        ) : (
          <span className={cn("whitespace-nowrap", original.queues.includes("no_invoice") ? "font-medium text-warning" : "text-muted-foreground")}>
            {original.queues.includes("no_invoice") ? "Missing" : "—"}
          </span>
        ),
    },
    {
      id: "next",
      accessorFn: (row) => (row.nextStepUrgent ? 0 : 1),
      header: "Next step",
      size: 240,
      cell: ({ row: { original } }) => (
        <span className={cn("block min-w-48 break-words", original.nextStepUrgent ? "font-medium" : "text-muted-foreground")}>
          {original.nextStep || "—"}
        </span>
      ),
    },
  ]
}

const STATUS_FILTERS: readonly { readonly value: NuTechBoardStatusFilter; readonly label: string; readonly pinned?: boolean }[] = [
  { value: "open", label: "Open", pinned: true },
  { value: "complete", label: "Complete" },
  { value: "cancelled", label: "Cancelled" },
  { value: "all", label: "All", pinned: true },
]

/**
 * Every Nu-Tech order on one sheet. The needs-attention boxes filter it to the
 * orders someone has to chase today; the status buttons switch between open
 * and closed orders. A row opens the order on its job.
 */
export function NuTechOrderBoard({ view }: { readonly view: NuTechOrderBoardView }): React.ReactElement {
  const [queue, setQueue] = React.useState<NuTechBoardQueue | null>(null)
  const [status, setStatus] = React.useState<NuTechBoardStatusFilter>("open")
  const [query, setQuery] = React.useState("")
  const visibleRows = React.useMemo(
    () =>
      view.rows.filter(
        (row) =>
          (queue ? row.queues.includes(queue) : matchesNuTechBoardStatus(row, status)) && matchesSearch(row, query),
      ),
    [view.rows, queue, status, query],
  )
  const columns = React.useMemo(boardColumns, [])
  const table = useRecordTable({
    data: visibleRows,
    columns,
    getRowId: rowId,
    resetKey: `${queue ?? status}|${query}`,
    initialSorting: REQUESTED_DATE_FIRST,
  })

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <section aria-labelledby="nutech-board-attention" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="nutech-board-attention" className="text-sm font-semibold">Needs attention</h2>
          <p className="text-xs text-muted-foreground">
            {queue ? (
              <button type="button" className="text-primary hover:underline" onClick={() => setQueue(null)}>
                Show all orders
              </button>
            ) : (
              "Choose a box to see its orders."
            )}{" "}
            Rules are in{" "}
            <Link href="/dashboard/settings?section=workflows&workflow=nutech-order-board" className="text-primary hover:underline">
              Settings
            </Link>
            .
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {NUTECH_BOARD_QUEUES.map((id) => {
            const { label, rule } = queueText(id, view)
            const count = view.queueCounts[id]
            const active = queue === id
            return (
              <button
                key={id}
                type="button"
                aria-pressed={active}
                onClick={() => setQueue(active ? null : id)}
                className={cn(
                  "flex min-h-11 flex-col items-start gap-1 rounded-lg border bg-background p-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active && "border-brand-nutech-gold bg-muted",
                )}
              >
                <span className={cn("text-2xl font-semibold tabular-nums leading-none", count > 0 ? "text-warning" : "text-muted-foreground")}>
                  {count}
                </span>
                <span className="text-sm font-medium">{label}</span>
                <span className="text-xs text-muted-foreground">{rule}</span>
              </button>
            )
          })}
        </div>
      </section>

      <section aria-label="Orders" className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {queue ? (
            <p className="text-sm font-medium">{queueText(queue, view).label}</p>
          ) : (
            <StatusFilterBar
              kind="button"
              label="Filter Nu-Tech orders by status"
              selected={status}
              onSelect={setStatus}
              options={STATUS_FILTERS.map((option) => ({ ...option, count: view.statusCounts[option.value] }))}
            />
          )}
          <RecordSearchInput
            value={query}
            onChange={setQuery}
            label="Search Nu-Tech orders"
            placeholder="Search job, customer, confirmation or invoice…"
            className="sm:max-w-sm"
          />
        </div>
        <RecordTable
          table={table}
          itemLabel="orders"
          emptyMessage={query ? "No orders match this search." : queue ? "Nothing waiting here." : "No orders yet."}
          rowIdPrefix="nutech-order-row"
          getRowHref={orderHref}
        />
      </section>
    </div>
  )
}
