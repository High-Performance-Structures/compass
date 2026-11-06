"use client"

import * as React from "react"
import Link from "next/link"
import type { ColumnDef } from "@tanstack/react-table"

import { RecordSearchInput, RecordTable, useRecordTable } from "@/components/record-table"
import { RecordStatusBadge } from "@/components/record-status-badge"
import { recordStatusColor, type RecordStatusFilter, type RecordStatusList } from "@/lib/domain/record-statuses/rules"
import { formatDate } from "@/lib/format"
import {
  rfiAssigneeSortValue,
  rfiDateSortValue,
  rfiMatchesSearch,
  rfiRecordHref,
  rfiStatusLabel,
  rfiStatusSortValue,
  type RfiListRow,
} from "@/lib/rfis/record-list"

/**
 * Staff see every column; the vendor view shows only what vendors saw before
 * the table (number, subject, status, who answers and the due date).
 */
type RfiTableAudience = "staff" | "vendor"

/** How a row opens its RFI: a link to its record, or the record below the table. */
type RfiRowOpen =
  | { readonly kind: "link"; readonly href: (row: RfiListRow) => string }
  | { readonly kind: "select"; readonly onSelect: (row: RfiListRow) => void }

const rowId = (row: RfiListRow): string => row.id

function DateCell({ value }: { readonly value: string | null }): React.ReactElement {
  return <span className="whitespace-nowrap tabular-nums">{formatDate(value, "medium", "—")}</span>
}

function Muted({ children }: { readonly children: React.ReactNode }): React.ReactElement {
  return <span className="text-muted-foreground">{children}</span>
}

function NumberCell({ row, open }: { readonly row: RfiListRow; readonly open: RfiRowOpen }): React.ReactElement {
  const className =
    "whitespace-nowrap text-left font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
  return open.kind === "link" ? (
    <Link href={open.href(row)} className={className}>
      {row.rfiNumber}
    </Link>
  ) : (
    <button type="button" className={className} onClick={() => open.onSelect(row)}>
      {row.rfiNumber}
    </button>
  )
}

export function rfiColumns(audience: RfiTableAudience, open: RfiRowOpen, statuses: RecordStatusList): ColumnDef<RfiListRow>[] {
  const staff = audience === "staff"
  const columns: (ColumnDef<RfiListRow> | null)[] = [
    {
      id: "number",
      accessorFn: (row) => row.rfiNumber,
      header: "RFI",
      size: 150,
      cell: ({ row: { original } }) => <NumberCell row={original} open={open} />,
    },
    {
      id: "subject",
      accessorFn: (row) => row.subject,
      header: "Subject",
      size: 280,
      cell: ({ row: { original } }) => (
        <div className="min-w-48 space-y-1">
          <p className="break-words font-medium">
            {original.subject}
            {original.priority === "high" && <span className="ml-2 text-xs font-semibold text-destructive">High</span>}
          </p>
          {original.question && original.question !== original.subject && (
            <p className="line-clamp-2 break-words text-xs text-muted-foreground">{original.question}</p>
          )}
        </div>
      ),
    },
    {
      id: "status",
      accessorFn: (row) => rfiStatusSortValue(row.status, statuses),
      header: "Status",
      size: 110,
      cell: ({ row }) => (
        <RecordStatusBadge
          label={rfiStatusLabel(row.original.status, statuses)}
          color={recordStatusColor(statuses, row.original.status)}
        />
      ),
    },
    {
      id: "assignedTo",
      accessorFn: rfiAssigneeSortValue,
      header: "Assigned to",
      size: 170,
      cell: ({ row: { original } }) =>
        original.assignedToName || original.companyName ? (
          <div className="min-w-32 space-y-0.5">
            {original.assignedToName && <p className="break-words">{original.assignedToName}</p>}
            {original.companyName && original.companyName !== original.assignedToName && (
              <p className="break-words text-xs text-muted-foreground">{original.companyName}</p>
            )}
          </div>
        ) : (
          <Muted>Unassigned</Muted>
        ),
    },
    staff
      ? {
          id: "requester",
          accessorFn: (row) => row.requesterName?.trim() || undefined,
          header: "Asked by",
          size: 140,
          cell: ({ row }) => row.original.requesterName || <Muted>—</Muted>,
        }
      : null,
    staff
      ? {
          id: "sent",
          accessorFn: (row) => rfiDateSortValue(row.submittedAt),
          header: "Sent",
          size: 115,
          cell: ({ row }) => <DateCell value={row.original.submittedAt} />,
        }
      : null,
    {
      id: "dueDate",
      accessorFn: (row) => rfiDateSortValue(row.dueDate),
      header: "Needed by",
      size: 115,
      cell: ({ row }) => <DateCell value={row.original.dueDate} />,
    },
    staff
      ? {
          id: "answered",
          accessorFn: (row) => rfiDateSortValue(row.answeredAt),
          header: "Answered",
          size: 115,
          cell: ({ row }) => <DateCell value={row.original.answeredAt} />,
        }
      : null,
  ]
  return columns.filter((column): column is ColumnDef<RfiListRow> => column !== null)
}

type ProjectRfiRecordTableProps = {
  readonly rows: readonly RfiListRow[]
  /** The company's RFI statuses: labels, colors and status sort order. */
  readonly statuses: RecordStatusList
  /** The RFI open below the list: its page is shown first. */
  readonly selectedId?: string | null
  readonly emptyMessage: string
} & (
  | {
      /** Staff rows link to the RFI's record on the job's RFI page. */
      readonly audience: "staff"
      readonly projectId: string
      readonly statusFilter: RecordStatusFilter
    }
  | {
      /** Vendor rows open the RFI below the table, read-only. */
      readonly audience: "vendor"
      readonly onSelect: (row: RfiListRow) => void
    }
)

/** A job's RFIs on the shared record table: sort, search, paging and row open. */
export function ProjectRfiRecordTable(props: ProjectRfiRecordTableProps): React.ReactElement {
  const { rows, statuses, selectedId = null, emptyMessage, audience } = props
  const [query, setQuery] = React.useState("")
  const visibleRows = React.useMemo(
    () => rows.filter((row) => rfiMatchesSearch(row, query, statuses)),
    [rows, query, statuses],
  )
  const projectId = props.audience === "staff" ? props.projectId : null
  const statusFilter = props.audience === "staff" ? props.statusFilter : null
  const onSelect = props.audience === "vendor" ? props.onSelect : null
  const open = React.useMemo<RfiRowOpen>(
    () =>
      onSelect
        ? { kind: "select", onSelect }
        : {
            kind: "link",
            href: (row) => rfiRecordHref(projectId ?? "", row.id, statusFilter ?? "all"),
          },
    [onSelect, projectId, statusFilter],
  )
  const columns = React.useMemo(() => rfiColumns(audience, open, statuses), [audience, open, statuses])
  const table = useRecordTable({
    data: visibleRows,
    columns,
    getRowId: rowId,
    resetKey: query,
    initialItemId: selectedId,
    // The trade partner view shows a subset of columns and has no company layout.
    sheetId: audience === "staff" ? "rfis.job" : "rfis.trade-partner",
  })

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <RecordSearchInput
        value={query}
        onChange={setQuery}
        label="Search RFIs"
        placeholder={audience === "staff" ? "Search RFI, subject, question or people…" : "Search RFI, subject or question…"}
        className="sm:max-w-md"
      />
      <RecordTable
        table={table}
        itemLabel="RFIs"
        emptyMessage={query ? "No RFIs match this search." : emptyMessage}
        rowIdPrefix="rfi-row"
        // The selected RFI's card opens below the table; highlight its row
        // without pulling the page back up to it.
        focusedRowId={selectedId}
        scrollToFocusedRow={false}
        {...(open.kind === "link" ? { getRowHref: open.href } : { onRowOpen: open.onSelect })}
      />
    </div>
  )
}
