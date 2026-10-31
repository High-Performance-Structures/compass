"use client"

import * as React from "react"
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
  type SortingState,
  type Table as TableInstance,
} from "@tanstack/react-table"

import { DataTablePagination, DEFAULT_TABLE_PAGE_SIZE } from "@/components/data-table-pagination"
import { Checkbox } from "@/components/ui/checkbox"
import {
  ariaSort,
  compareSortValues,
  TanstackSortableHeader,
} from "@/components/ui/sortable-header"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"

/** Shared list behavior: refreshes preserve the page; view changes reset it. */
export function useRecordTable<T>({
  data,
  columns,
  getRowId,
  resetKey,
  enableSelection = false,
  initialItemId = null,
  revealReady = true,
}: {
  readonly data: readonly T[]
  readonly columns: readonly ColumnDef<T>[]
  readonly getRowId: (row: T) => string
  readonly resetKey: string
  readonly enableSelection?: boolean
  readonly initialItemId?: string | null
  readonly revealReady?: boolean
}): TableInstance<T> {
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({})
  const [pagination, setPagination] = React.useState({
    pageIndex: 0,
    pageSize: DEFAULT_TABLE_PAGE_SIZE,
  })
  const rows = React.useMemo(() => [...data], [data])
  const tableColumns = React.useMemo(() => [...columns], [columns])
  const table = useReactTable({
    data: rows,
    columns: tableColumns,
    getRowId,
    state: { sorting, rowSelection, pagination },
    onSortingChange: (update) => {
      setSorting(update)
      setPagination((current) => ({ ...current, pageIndex: 0 }))
      setRowSelection({})
    },
    onRowSelectionChange: setRowSelection,
    onPaginationChange: setPagination,
    autoResetPageIndex: false,
    enableRowSelection: enableSelection,
    enableMultiSort: false,
    defaultColumn: {
      sortDescFirst: false,
      sortUndefined: "last",
      sortingFn: (a, b, id) => compareSortValues(a.getValue(id), b.getValue(id)),
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  })

  React.useEffect(() => {
    table.setPageIndex(0)
    table.resetRowSelection()
  }, [resetKey, table])

  // A bell/deep link may target a row beyond page one. Reveal it once per URL.
  const revealedId = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!initialItemId) {
      revealedId.current = null
      return
    }
    if (!revealReady) return
    if (revealedId.current === initialItemId) return
    const index = table.getPrePaginationRowModel().rows.findIndex((row) => row.id === initialItemId)
    if (index < 0) return
    revealedId.current = initialItemId
    table.setPageIndex(Math.floor(index / table.getState().pagination.pageSize))
  }, [data, initialItemId, revealReady, table])

  return table
}

export function recordSelectionColumn<T>(getLabel: (item: T) => string): ColumnDef<T> {
  return {
    id: "select",
    enableSorting: false,
    size: 40,
    header: ({ table }) => (
      <Checkbox
        aria-label="Select all records on this page"
        checked={
          table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && "indeterminate")
        }
        disabled={table.getRowModel().rows.length === 0}
        onCheckedChange={(checked) => table.toggleAllPageRowsSelected(checked === true)}
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        aria-label={`Select ${getLabel(row.original)}`}
        checked={row.getIsSelected()}
        onCheckedChange={(checked) => row.toggleSelected(checked === true)}
      />
    ),
  }
}

type RecordTableState =
  | { readonly kind: "ready" }
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }

/** Presentation shared by growing record lists; mutations stay with each domain. */
export function RecordTable<T>({
  table,
  itemLabel,
  emptyMessage,
  state = { kind: "ready" },
  focusedRowId = null,
}: {
  readonly table: TableInstance<T>
  readonly itemLabel: string
  readonly emptyMessage: string
  readonly state?: RecordTableState
  readonly focusedRowId?: string | null
}): React.ReactElement {
  const pageIndex = table.getState().pagination.pageIndex
  const paginationId = React.useId()
  React.useEffect(() => {
    if (!focusedRowId) return
    const element = document.getElementById(`record-${focusedRowId}`)
    element?.scrollIntoView({ block: "center" })
    element?.focus({ preventScroll: true })
  }, [focusedRowId, pageIndex])

  return (
    <div className="min-w-0 space-y-4" aria-busy={state.kind === "loading"}>
      {state.kind === "error" && (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      )}
      <Table aria-label={itemLabel} className="min-w-[52rem]" containerClassName="border-y">
        <TableHeader className="bg-muted/50">
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => (
                <TableHead
                  key={header.id}
                  scope="col"
                  style={{ width: header.getSize() }}
                  aria-sort={
                    header.column.getCanSort() ? ariaSort(header.column.getIsSorted()) : undefined
                  }
                >
                  <TanstackSortableHeader header={header} />
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {state.kind === "loading" ? (
            <TableRow>
              <TableCell
                colSpan={table.getVisibleLeafColumns().length}
                className="h-24 text-center"
                role="status"
              >
                Loading {itemLabel}…
              </TableCell>
            </TableRow>
          ) : table.getRowModel().rows.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                id={`record-${row.id}`}
                tabIndex={row.id === focusedRowId ? -1 : undefined}
                data-state={row.getIsSelected() ? "selected" : undefined}
                className={cn(row.id === focusedRowId && "bg-accent ring-2 ring-inset ring-ring")}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className="whitespace-normal align-top py-3">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell
                colSpan={table.getVisibleLeafColumns().length}
                className="h-24 text-center text-muted-foreground"
              >
                {emptyMessage}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <DataTablePagination table={table} itemLabel={itemLabel} id={paginationId} />
    </div>
  )
}
