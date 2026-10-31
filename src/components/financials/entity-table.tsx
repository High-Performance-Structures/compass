"use client"

import * as React from "react"
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type RowSelectionState,
  type SortingState,
  type Table as TanstackTable,
  type VisibilityState,
} from "@tanstack/react-table"

import { useIsMobile } from "@/hooks/use-mobile"
import {
  DataTablePagination,
  DEFAULT_TABLE_PAGE_SIZE,
} from "@/components/data-table-pagination"
import { Input } from "@/components/ui/input"
import { TanstackSortableHeader } from "@/components/ui/sortable-header"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"

/**
 * One typed TanStack table for the financial and directory lists (invoices,
 * vendor bills, credit memos, payments, customers, vendors). Each list
 * passes its columns, toolbars, mobile row and empty states; the table owns
 * sorting, filtering, pagination and selection so they behave the same
 * everywhere.
 */

type EntityTableControls<T> = {
  readonly table: TanstackTable<T>
  readonly sorting: SortingState
  /** Sets the sort and returns to the first page. */
  readonly sortBy: (next: SortingState) => void
}

/** A column's text filter value, or `fallback` when none is set. */
export function columnFilterText<T>(table: TanstackTable<T>, columnId: string, fallback = ""): string {
  const value = table.getColumn(columnId)?.getFilterValue()
  return typeof value === "string" ? value : fallback
}

/** The search box every list shows above its rows. */
export function EntitySearchInput<T>({
  table,
  columnId,
  placeholder,
  className,
}: {
  readonly table: TanstackTable<T>
  readonly columnId: string
  readonly placeholder: string
  readonly className: string
}): React.ReactElement {
  return (
    <Input
      placeholder={placeholder}
      value={columnFilterText(table, columnId)}
      onChange={(e) => table.getColumn(columnId)?.setFilterValue(e.target.value)}
      className={className}
    />
  )
}

type Selection = {
  readonly selectedIds: readonly string[]
  readonly onSelectionChange?: (ids: readonly string[]) => void
}

type EntityTableProps<T> = {
  readonly data: readonly T[]
  readonly columns: ColumnDef<T>[]
  readonly getRowId?: (row: T) => string
  readonly initialSorting?: SortingState
  readonly columnVisibility?: VisibilityState
  /** Selection kept by the caller by row id; otherwise the table keeps it. */
  readonly selection?: Selection
  /** "fill" stretches to the page height with a sticky header. */
  readonly layout?: "page" | "fill"
  readonly mobileToolbar: (controls: EntityTableControls<T>) => React.ReactNode
  readonly desktopToolbar: (controls: EntityTableControls<T>) => React.ReactNode
  /** The content of one mobile row. */
  readonly mobileRow: (row: T) => React.ReactNode
  readonly mobileEmpty: React.ReactNode
  readonly desktopEmpty: string
  readonly itemLabel: string
  /** Prefix of the page-size picker ids, such as "invoices". */
  readonly paginationId: string
}

const NO_SELECTION: RowSelectionState = {}

export function EntityTable<T>({
  data,
  columns,
  getRowId,
  initialSorting,
  columnVisibility,
  selection,
  layout = "page",
  mobileToolbar,
  desktopToolbar,
  mobileRow,
  mobileEmpty,
  desktopEmpty,
  itemLabel,
  paginationId,
}: EntityTableProps<T>): React.ReactElement {
  const isMobile = useIsMobile()
  const [sorting, setSorting] = React.useState<SortingState>(initialSorting ?? [])
  const [columnFilters, setColumnFilters] =
    React.useState<ColumnFiltersState>([])
  const [ownSelection, setOwnSelection] = React.useState<RowSelectionState>(NO_SELECTION)
  const selectedIds = selection?.selectedIds
  const callerSelection = React.useMemo<RowSelectionState | null>(
    () => (selectedIds ? Object.fromEntries(selectedIds.map((id) => [id, true])) : null),
    [selectedIds]
  )
  const rowSelection = callerSelection ?? ownSelection
  const [pagination, setPagination] = React.useState({
    pageIndex: 0,
    pageSize: DEFAULT_TABLE_PAGE_SIZE,
  })
  // TanStack Table must receive stable data/column references across local state updates.
  const tableData = React.useMemo(() => [...data], [data])
  const onSelectionChange = selection?.onSelectionChange

  const table = useReactTable({
    data: tableData,
    columns,
    getRowId,
    onSortingChange: (updater) => {
      setSorting(updater)
      setPagination((current) => ({ ...current, pageIndex: 0 }))
    },
    onColumnFiltersChange: (updater) => {
      setColumnFilters(updater)
      setPagination((current) => ({ ...current, pageIndex: 0 }))
    },
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onRowSelectionChange: !selection
      ? setOwnSelection
      : onSelectionChange
        ? (updater) => {
            const next = typeof updater === "function" ? updater(rowSelection) : updater
            onSelectionChange(Object.keys(next).filter((id) => next[id]))
          }
        : undefined,
    autoResetPageIndex: false,
    onPaginationChange: setPagination,
    state: columnVisibility
      ? { sorting, columnFilters, columnVisibility, rowSelection, pagination }
      : { sorting, columnFilters, rowSelection, pagination },
  })

  const controls: EntityTableControls<T> = {
    table,
    sorting,
    sortBy: (next) => {
      setPagination((current) => ({ ...current, pageIndex: 0 }))
      setSorting(next)
    },
  }

  if (isMobile) {
    const rows = table.getRowModel().rows
    return (
      <div className="space-y-3">
        {mobileToolbar(controls)}
        {rows.length ? (
          <div className="rounded-md border divide-y">
            {rows.map((row) => (
              <div
                key={row.id}
                className="flex items-center gap-3 px-3 py-2.5"
              >
                {mobileRow(row.original)}
              </div>
            ))}
          </div>
        ) : (
          mobileEmpty
        )}
        <DataTablePagination
          table={table}
          itemLabel={itemLabel}
          id={`${paginationId}-mobile-items-per-page`}
        />
      </div>
    )
  }

  const fill = layout === "fill"
  return (
    <div className={fill ? "flex flex-1 flex-col min-h-0 gap-3" : "space-y-4"}>
      {desktopToolbar(controls)}
      <div className={fill ? "rounded-md border flex-1 min-h-0 overflow-hidden" : "rounded-md border overflow-hidden"}>
        <div className={fill ? "overflow-auto h-full" : "overflow-x-auto"}>
          <Table>
            <TableHeader className={cn(fill && "sticky top-0 z-10 bg-background")}>
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id}>
                  {hg.headers.map((header) => (
                    <TableHead key={header.id} className="whitespace-nowrap">
                      <TanstackSortableHeader header={header} />
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows?.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() && "selected"}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className="whitespace-nowrap">
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={columns.length}
                    className="h-24 text-center"
                  >
                    {desktopEmpty}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
      <DataTablePagination
        table={table}
        itemLabel={itemLabel}
        id={`${paginationId}-items-per-page`}
      />
    </div>
  )
}
