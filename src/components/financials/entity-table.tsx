"use client"

import * as React from "react"
import type { Table as TanstackTable } from "@tanstack/react-table"

import { useIsMobile } from "@/hooks/use-mobile"
import { DataTablePagination } from "@/components/data-table-pagination"
import { useListSheetFilterLabel } from "@/components/list-sheets/use-list-sheet"
import { RecordSearchInput, RecordTable } from "@/components/record-table"
import { StatusFilterBar } from "@/components/status-filter-bar"

/**
 * The shared frame for the company Financials lists (invoices, vendor bills,
 * credit memos, payments). Each list builds its sheet with `useRecordTable`
 * and a registered sheetId; this frame adds the search box, the status
 * buttons, the phone list and the empty states so the lists behave the same.
 */

type StatusOption = { readonly value: string; readonly label: string }

type StatusFilterOption = StatusOption & { readonly count: number; readonly pinned?: boolean }

/** "All" status filter value: the lists open on every record, as they always have. */
export const ALL_STATUSES = "all"

/**
 * Status buttons for a list: each known status in order, then any other
 * status the rows carry, then All. Statuses with no rows hide.
 */
function entityStatusOptions<T>(
  rows: readonly T[],
  statusOf: (row: T) => string,
  known: readonly StatusOption[],
): readonly StatusFilterOption[] {
  const counts = new Map<string, number>()
  for (const row of rows) counts.set(statusOf(row), (counts.get(statusOf(row)) ?? 0) + 1)
  const others = [...counts.keys()]
    .filter((value) => !known.some((option) => option.value === value))
    .map((value) => ({ value, label: value.replaceAll("_", " ") }))
  return [
    ...[...known, ...others].map((option) => ({ ...option, count: counts.get(option.value) ?? 0 })),
    { value: ALL_STATUSES, label: "All", count: rows.length, pinned: true },
  ]
}

/** Rows matching the search text (in `searchText`) and the chosen status. */
export function filterEntityRows<T>(
  rows: readonly T[],
  search: string,
  searchText: (row: T) => string,
  status?: { readonly selected: string; readonly of: (row: T) => string },
): readonly T[] {
  const query = search.trim().toLowerCase()
  return rows.filter(
    (row) =>
      (!status || status.selected === ALL_STATUSES || status.of(row) === status.selected) &&
      (!query || searchText(row).toLowerCase().includes(query)),
  )
}

type EntityTableProps<T> = {
  readonly table: TanstackTable<T>
  readonly search: {
    readonly value: string
    readonly onChange: (value: string) => void
    readonly label: string
    readonly placeholder: string
  }
  /** Status buttons, when the record has a status. */
  readonly statusFilter?: {
    readonly label: string
    /** Every row before filtering, for the counts. */
    readonly rows: readonly T[]
    readonly of: (row: T) => string
    readonly known: readonly StatusOption[]
    /** The registered sheet whose company filter names (Settings > Lists) the buttons use. */
    readonly sheetId: string
    readonly selected: string
    readonly onSelect: (value: string) => void
  }
  /** Opens the record (its edit window) from a click anywhere on the row. */
  readonly onRowOpen?: (row: T) => void
  /** The content of one mobile row. */
  readonly mobileRow: (row: T) => React.ReactNode
  readonly mobileEmpty: React.ReactNode
  readonly desktopEmpty: string
  readonly itemLabel: string
  /** Prefix of the phone page-size picker id, such as "invoices". */
  readonly paginationId: string
}

export function EntityTable<T>({
  table,
  search,
  statusFilter,
  onRowOpen,
  mobileRow,
  mobileEmpty,
  desktopEmpty,
  itemLabel,
  paginationId,
}: EntityTableProps<T>): React.ReactElement {
  const isMobile = useIsMobile()
  const filterLabel = useListSheetFilterLabel(statusFilter?.sheetId ?? "")
  const statusBar = statusFilter ? (
    <StatusFilterBar
      kind="button"
      label={statusFilter.label}
      selected={statusFilter.selected}
      onSelect={statusFilter.onSelect}
      options={entityStatusOptions(statusFilter.rows, statusFilter.of, statusFilter.known).map((option) => ({
        ...option,
        label: filterLabel(option.value, option.label),
      }))}
    />
  ) : null

  if (isMobile) {
    const rows = table.getRowModel().rows
    return (
      <div className="space-y-3">
        <RecordSearchInput {...search} className="w-full" />
        {statusBar}
        {rows.length ? (
          <div className="rounded-md border divide-y">
            {rows.map((row) => (
              <div key={row.id} className="flex items-center gap-3 px-3 py-2.5">
                {mobileRow(row.original)}
              </div>
            ))}
          </div>
        ) : (
          mobileEmpty
        )}
        <DataTablePagination table={table} itemLabel={itemLabel} id={`${paginationId}-mobile-items-per-page`} />
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <RecordSearchInput {...search} className="sm:max-w-sm" />
        {statusBar}
      </div>
      <RecordTable table={table} itemLabel={itemLabel} emptyMessage={desktopEmpty} rowIdPrefix={paginationId} onRowOpen={onRowOpen} />
    </div>
  )
}
