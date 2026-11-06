"use client"

import * as React from "react"
import Link from "next/link"
import type { ColumnDef } from "@tanstack/react-table"

import { RecordSearchInput, RecordTable, useRecordTable } from "@/components/record-table"
import { RecordStatusBadge } from "@/components/record-status-badge"
import {
  recordStatusColor,
  recordStatusLabel,
  type RecordStatusFilter,
  type RecordStatusList,
} from "@/lib/domain/record-statuses/rules"
import { formatDate, formatDollars } from "@/lib/format"
import { rfiDateSortValue } from "@/lib/rfis/record-list"
import {
  rfqMatchesSearch,
  rfqQuoteSortValue,
  rfqRecordHref,
  rfqRequestedFromSortValue,
  rfqRespondedAt,
  rfqStatusSortValue,
  type RfqListRow,
} from "@/lib/rfqs/record-list"

const rowId = (row: RfqListRow): string => row.id

function DateCell({ value }: { readonly value: string | null }): React.ReactElement {
  return <span className="whitespace-nowrap tabular-nums">{formatDate(value, "medium", "—")}</span>
}

function Muted({ children }: { readonly children: React.ReactNode }): React.ReactElement {
  return <span className="text-muted-foreground">{children}</span>
}

export function rfqColumns(href: (row: RfqListRow) => string, statuses: RecordStatusList): ColumnDef<RfqListRow>[] {
  return [
    {
      id: "number",
      accessorFn: (row) => row.rfqNumber,
      header: "RFQ",
      size: 150,
      cell: ({ row: { original } }) => (
        <Link
          href={href(original)}
          className="whitespace-nowrap font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {original.rfqNumber}
        </Link>
      ),
    },
    {
      id: "title",
      accessorFn: (row) => row.title,
      header: "Title",
      size: 280,
      cell: ({ row: { original } }) => (
        <div className="min-w-48 space-y-1">
          <p className="break-words font-medium">
            {original.title}
            {(original.priority === "high" || original.priority === "critical") && (
              <span className="ml-2 text-xs font-semibold text-destructive">
                {original.priority === "critical" ? "Critical" : "High"}
              </span>
            )}
          </p>
          {original.description && original.description !== original.title && (
            <p className="line-clamp-2 break-words text-xs text-muted-foreground">{original.description}</p>
          )}
        </div>
      ),
    },
    {
      id: "status",
      accessorFn: (row) => rfqStatusSortValue(row.status, statuses),
      header: "Status",
      size: 130,
      cell: ({ row }) => (
        <RecordStatusBadge
          label={recordStatusLabel(statuses, row.original.status)}
          color={recordStatusColor(statuses, row.original.status)}
        />
      ),
    },
    {
      id: "requestedFrom",
      accessorFn: rfqRequestedFromSortValue,
      header: "Requested from",
      size: 190,
      cell: ({ row: { original } }) =>
        original.companyName || original.recipientEmail ? (
          <div className="min-w-32 space-y-0.5">
            {original.companyName && <p className="break-words">{original.companyName}</p>}
            {original.recipientEmail && (
              <p className="break-all text-xs text-muted-foreground">{original.recipientEmail}</p>
            )}
          </div>
        ) : (
          <Muted>Not sent yet</Muted>
        ),
    },
    {
      id: "trade",
      accessorFn: (row) => row.vendorCategory?.trim() || undefined,
      header: "Trade",
      size: 140,
      cell: ({ row }) => row.original.vendorCategory || <Muted>—</Muted>,
    },
    {
      id: "dueDate",
      accessorFn: (row) => rfiDateSortValue(row.dueDate),
      header: "Needed by",
      size: 115,
      cell: ({ row }) => <DateCell value={row.original.dueDate} />,
    },
    {
      id: "quote",
      accessorFn: rfqQuoteSortValue,
      header: "Quote",
      size: 120,
      cell: ({ row: { original } }) =>
        original.response.kind === "quoted" ? (
          <span className="block whitespace-nowrap text-right tabular-nums">
            {formatDollars(original.response.amount ?? 0)}
          </span>
        ) : original.response.kind === "declined" ? (
          <span className="block text-right text-muted-foreground">Declined</span>
        ) : (
          <span className="block text-right text-muted-foreground">Waiting</span>
        ),
    },
    {
      id: "responded",
      accessorFn: (row) => rfiDateSortValue(rfqRespondedAt(row)),
      header: "Responded",
      size: 115,
      cell: ({ row }) => <DateCell value={rfqRespondedAt(row.original)} />,
    },
  ]
}

type ProjectRfqRecordTableProps = {
  readonly rows: readonly RfqListRow[]
  readonly projectId: string
  /** The company's RFQ statuses: labels, colors and status sort order. */
  readonly statuses: RecordStatusList
  readonly statusFilter: RecordStatusFilter
  /** The RFQ open below the list. */
  readonly selectedId: string | null
  readonly emptyMessage: string
}

/** A job's RFQs on the shared record table: sort, search, paging and row open. */
export function ProjectRfqRecordTable({
  rows,
  projectId,
  statuses,
  statusFilter,
  selectedId,
  emptyMessage,
}: ProjectRfqRecordTableProps): React.ReactElement {
  const [query, setQuery] = React.useState("")
  const visibleRows = React.useMemo(
    () => rows.filter((row) => rfqMatchesSearch(row, query, statuses)),
    [rows, query, statuses],
  )
  const href = React.useCallback(
    (row: RfqListRow) => rfqRecordHref(projectId, row.id, statusFilter),
    [projectId, statusFilter],
  )
  const columns = React.useMemo(() => rfqColumns(href, statuses), [href, statuses])
  const table = useRecordTable({
    data: visibleRows,
    columns,
    getRowId: rowId,
    resetKey: query,
    initialItemId: selectedId,
    sheetId: "rfqs.job",
  })

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <RecordSearchInput
        value={query}
        onChange={setQuery}
        label="Search RFQs"
        placeholder="Search RFQ, title, vendor or trade…"
        className="sm:max-w-md"
      />
      <RecordTable
        table={table}
        itemLabel="RFQs"
        emptyMessage={query ? "No RFQs match this search." : emptyMessage}
        rowIdPrefix="rfq-row"
        // The selected RFQ's card opens below the table; highlight its row
        // without pulling the page back up to it.
        focusedRowId={selectedId}
        scrollToFocusedRow={false}
        getRowHref={href}
      />
    </div>
  )
}
