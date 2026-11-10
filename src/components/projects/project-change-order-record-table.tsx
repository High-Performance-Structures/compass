"use client"

import * as React from "react"
import Link from "next/link"
import type { ColumnDef } from "@tanstack/react-table"

import type { ProjectChangeOrderItem } from "@/app/actions/project-change-orders"
import { ProjectChangeOrderProvenance } from "@/components/projects/project-change-order-provenance"
import { RecordSearchInput, RecordTable, useRecordTable } from "@/components/record-table"
import { RecordStatusBadge } from "@/components/record-status-badge"
import { useListSheetFilterLabel } from "@/components/list-sheets/use-list-sheet"
import { StatusFilterBar } from "@/components/status-filter-bar"
import { Badge } from "@/components/ui/badge"
import {
  CHANGE_ORDER_LIST_FILTERS,
  changeOrderMatchesFilter,
  changeOrderMatchesSearch,
  changeOrderNumberSortValue,
  changeOrderStatusGroup,
  changeOrderStatusSortValue,
  type ChangeOrderListFilter,
  type ChangeOrderStatusGroup,
} from "@/lib/change-orders/record-list"
import { changeOrderDisplayStatus } from "@/lib/change-orders/status"
import type { RecordStatusColor } from "@/lib/domain/record-statuses/statuses"
import { formatDate, formatDollars } from "@/lib/format"

const rowId = (item: ProjectChangeOrderItem): string => item.id

const GROUP_COLOR: Readonly<Record<ChangeOrderStatusGroup, RecordStatusColor>> = {
  in_progress: "orange",
  with_owner: "blue",
  executed: "green",
  closed: "gray",
  ended: "gray",
}

function Muted({ children }: { readonly children: React.ReactNode }): React.ReactElement {
  return <span className="text-muted-foreground">{children}</span>
}

function DateCell({ value }: { readonly value: string | null }): React.ReactElement {
  return <span className="whitespace-nowrap tabular-nums">{formatDate(value, "medium", "—")}</span>
}

/** The Change Orders sheet's columns (registry sheet "change-orders.job"). */
export function changeOrderColumns(href: (item: ProjectChangeOrderItem) => string): ColumnDef<ProjectChangeOrderItem>[] {
  return [
    {
      id: "number",
      accessorFn: changeOrderNumberSortValue,
      header: "Number",
      size: 110,
      cell: ({ row: { original } }) => (
        <Link
          href={href(original)}
          className="whitespace-nowrap font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {original.changeOrderNumber}
        </Link>
      ),
    },
    {
      id: "title",
      accessorFn: (item) => item.title.toLocaleLowerCase(),
      header: "Title",
      size: 300,
      cell: ({ row: { original } }) => (
        <div className="min-w-48 space-y-1">
          <p className="break-words font-medium">{original.title}</p>
          {original.scope && original.scope !== original.title && (
            <p className="line-clamp-2 break-words text-xs text-muted-foreground">{original.scope}</p>
          )}
          {(original.budgetTreatment === "baseline_replacement" || original.recordIssues.length > 0) && (
            <div className="flex flex-wrap gap-1">
              {original.budgetTreatment === "baseline_replacement" && <Badge variant="outline">Baseline replacement</Badge>}
              {original.recordIssues.length > 0 && (
                <Badge variant="destructive" title={original.recordIssues.join(" ")}>Record needs correcting</Badge>
              )}
            </div>
          )}
        </div>
      ),
    },
    {
      id: "type",
      accessorFn: (item) => item.recordType,
      header: "Type",
      size: 120,
      cell: ({ row: { original } }) =>
        original.recordType === "variance" ? <Badge variant="secondary">Variance</Badge> : <Badge variant="outline">Change order</Badge>,
    },
    {
      id: "status",
      accessorFn: (item) => changeOrderStatusSortValue(item.status),
      header: "Status",
      size: 150,
      cell: ({ row: { original } }) => (
        <RecordStatusBadge
          label={changeOrderDisplayStatus(original.status, original.sourceType)}
          color={GROUP_COLOR[changeOrderStatusGroup(original.status)]}
        />
      ),
    },
    {
      id: "requestedBy",
      accessorFn: (item) => (item.sourceType === "buildertrend_import" ? undefined : item.requesterName.toLocaleLowerCase() || undefined),
      header: "Requested by",
      size: 170,
      cell: ({ row: { original } }) =>
        original.sourceType === "buildertrend_import" ? (
          <ProjectChangeOrderProvenance />
        ) : (
          <div className="min-w-28">
            <p className="break-words">{original.requesterName}</p>
            {original.requesterCompany && <p className="break-words text-xs text-muted-foreground">{original.requesterCompany}</p>}
          </div>
        ),
    },
    {
      id: "amount",
      accessorFn: (item) => item.amountCents ?? undefined,
      header: "Amount",
      size: 130,
      cell: ({ row: { original } }) => (
        <span className="block whitespace-nowrap text-right tabular-nums">
          {original.amountCents === null ? <Muted>Not priced</Muted> : formatDollars(original.amountCents / 100)}
        </span>
      ),
    },
    {
      id: "scheduleDays",
      accessorFn: (item) => item.scheduleImpactDays ?? undefined,
      header: "Schedule days",
      size: 110,
      cell: ({ row: { original } }) => (
        <span className="block text-right tabular-nums">{original.scheduleImpactDays ?? <Muted>—</Muted>}</span>
      ),
    },
    {
      id: "submitted",
      accessorFn: (item) => item.submittedAt ?? item.createdAt,
      header: "Submitted",
      size: 120,
      cell: ({ row: { original } }) => <DateCell value={original.submittedAt ?? original.createdAt} />,
    },
    {
      id: "executed",
      accessorFn: (item) => item.executedAt ?? undefined,
      header: "Executed",
      size: 120,
      cell: ({ row: { original } }) => <DateCell value={original.executedAt} />,
    },
  ]
}

/** A job's change orders and variances: filter buttons, search, sortable sheet; a row opens its page. */
export function ProjectChangeOrderRecordTable({
  items,
  detailBaseHref,
  initialFilter,
  openInDrawer = false,
}: {
  readonly items: readonly ProjectChangeOrderItem[]
  readonly detailBaseHref: string
  /** Staff open a change order in the record drawer (`?item=`) over the list. */
  readonly openInDrawer?: boolean
  /** The filter the sheet opens on (the company's choice in Settings › Lists). */
  readonly initialFilter: ChangeOrderListFilter
}): React.ReactElement {
  const [filter, setFilter] = React.useState<ChangeOrderListFilter>(initialFilter)
  const [query, setQuery] = React.useState("")
  const visible = React.useMemo(
    () => items.filter((item) => changeOrderMatchesFilter(item, filter) && changeOrderMatchesSearch(item, query)),
    [items, filter, query]
  )
  const href = React.useCallback(
    (item: ProjectChangeOrderItem) =>
      openInDrawer
        ? `${detailBaseHref}?item=${encodeURIComponent(item.id)}`
        : `${detailBaseHref}/${encodeURIComponent(item.id)}`,
    [detailBaseHref, openInDrawer]
  )
  const columns = React.useMemo(() => changeOrderColumns(href), [href])
  const filterLabel = useListSheetFilterLabel("change-orders.job")
  const table = useRecordTable({
    data: visible,
    columns,
    getRowId: rowId,
    resetKey: `${filter}:${query}`,
    sheetId: "change-orders.job",
  })

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatusFilterBar
          kind="button"
          label="Filter change orders by status"
          options={CHANGE_ORDER_LIST_FILTERS.map((option) => ({
            ...option,
            label: filterLabel(option.value, option.label),
            count: items.filter((item) => changeOrderMatchesFilter(item, option.value)).length,
            pinned: option.value === "open" || option.value === "all",
          }))}
          selected={filter}
          onSelect={setFilter}
        />
        <RecordSearchInput
          value={query}
          onChange={setQuery}
          label="Search change orders"
          placeholder="Search number, title, scope or requester…"
          className="sm:max-w-sm"
        />
      </div>
      <RecordTable
        table={table}
        itemLabel="change orders"
        emptyMessage={query ? "No change orders match this search." : "No change orders match this filter."}
        rowIdPrefix="change-order-row"
        getRowHref={href}
      />
    </div>
  )
}
