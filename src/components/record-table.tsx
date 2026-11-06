"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type Row,
  type RowData,
  type RowSelectionState,
  type SortingState,
  type Table as TableInstance,
} from "@tanstack/react-table"

import { IconSearch } from "@tabler/icons-react"

import { DataTablePagination, DEFAULT_TABLE_PAGE_SIZE } from "@/components/data-table-pagination"
import { RecordColumnsButton } from "@/components/list-sheets/record-columns-button"
import { openingSort, useListSheetTableOptions, type ListSheetControl } from "@/components/list-sheets/use-list-sheet"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
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

declare module "@tanstack/react-table" {
  // TData is required by TanStack's declaration merging.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface TableMeta<TData extends RowData> {
    /** The registered sheet whose layout this table follows; RecordTable shows its Columns button. */
    readonly listSheet?: ListSheetControl
  }
}

/** Shared list behavior: refreshes preserve the page; view changes reset it. */
export function useRecordTable<T>({
  data,
  columns,
  getRowId,
  resetKey,
  enableSelection = false,
  initialItemId = null,
  revealReady = true,
  initialSorting = [],
  sheetId,
}: {
  readonly data: readonly T[]
  readonly columns: readonly ColumnDef<T>[]
  readonly getRowId: (row: T) => string
  readonly resetKey: string
  readonly enableSelection?: boolean
  readonly initialItemId?: string | null
  readonly revealReady?: boolean
  /** The sort a list opens with, such as required date; headers still change it. */
  readonly initialSorting?: SortingState
  /**
   * The sheet's id in the list sheet registry: its columns, order and
   * opening sort follow the person's and the company's settings, and
   * RecordTable shows a Columns button. The sheet's sort replaces
   * `initialSorting`.
   */
  readonly sheetId?: string
}): TableInstance<T> {
  const { sheet, state: sheetState } = useListSheetTableOptions(sheetId, columns)
  const [sorting, setSorting] = React.useState<SortingState>(() => openingSort(sheet, initialSorting))
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
    state: { sorting, rowSelection, pagination, ...sheetState },
    meta: sheet ? { listSheet: sheet } : undefined,
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

/**
 * Clicks that belong to a control inside the row, not to the row: checkboxes,
 * buttons, links, inputs, menus and drag handles. Mark anything else with
 * `data-row-click-ignore`.
 */
const ROW_CLICK_IGNORE = [
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "label",
  "summary",
  "[role='button']",
  "[role='checkbox']",
  "[role='menuitem']",
  "[role='combobox']",
  "[role='switch']",
  "[contenteditable='true']",
  "[data-row-click-ignore]",
].join(",")

/** Whether a click on a row should open its record. */
function isRowOpenClick(event: React.MouseEvent<HTMLElement>, button: 0 | 1 = 0): boolean {
  if (event.defaultPrevented || event.button !== button) return false
  const target = event.target
  // Clicks inside a portal (a dialog or menu opened from the row) bubble
  // through React to the row but are not inside it.
  if (!(target instanceof Element) || !event.currentTarget.contains(target)) return false
  const control = target.closest(ROW_CLICK_IGNORE)
  if (control && event.currentTarget.contains(control)) return false
  // Selecting text to copy it is not a request to open the record.
  const selection = typeof window === "undefined" ? null : window.getSelection()
  if (selection && !selection.isCollapsed && selection.toString().trim() !== "") return false
  return true
}

type RecordTableState =
  | { readonly kind: "ready" }
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }

type RecordTableProps<T> = {
  readonly table: TableInstance<T>
  readonly itemLabel: string
  readonly emptyMessage: string
  readonly state?: RecordTableState
  readonly focusedRowId?: string | null
  /**
   * Scroll the focused row into view and focus it (the default). Off when
   * something else on the page is the scroll target, such as the record
   * opened below the list; the row is still highlighted.
   */
  readonly scrollToFocusedRow?: boolean
  readonly rowIdPrefix?: string
  /**
   * Makes the whole row open the record (except its controls). Keep a link or
   * button on the record's name for keyboard and screen reader users.
   */
  readonly onRowOpen?: (row: T) => void
  readonly getRowHref?: (row: T) => string
}

/** Presentation shared by growing record lists; mutations stay with each domain. */
export function RecordTable<T>(props: RecordTableProps<T>): React.ReactElement {
  // Only linked rows need the router, so tables without links render anywhere.
  return props.getRowHref && !props.onRowOpen ? (
    <LinkedRecordTable {...props} />
  ) : (
    <RecordTableView {...props} navigate={null} />
  )
}

function LinkedRecordTable<T>(props: RecordTableProps<T>): React.ReactElement {
  const router = useRouter()
  return <RecordTableView {...props} navigate={(href) => router.push(href)} />
}

function RecordTableView<T>({
  table,
  itemLabel,
  emptyMessage,
  state = { kind: "ready" },
  focusedRowId = null,
  scrollToFocusedRow = true,
  rowIdPrefix = "record",
  onRowOpen,
  getRowHref,
  navigate,
}: RecordTableProps<T> & { readonly navigate: ((href: string) => void) | null }): React.ReactElement {
  const pageIndex = table.getState().pagination.pageIndex
  const paginationId = React.useId()
  const rows = table.getRowModel().rows
  const rowsOpen = Boolean(onRowOpen || getRowHref)
  const columnCount = table.getVisibleLeafColumns().length

  function openRow(event: React.MouseEvent<HTMLTableRowElement>, row: Row<T>): void {
    // A click in a checkbox cell's padding means the checkbox, never the record.
    const target = event.target
    const cell = target instanceof Element ? target.closest("td") : null
    const checkbox = cell?.querySelector("[role='checkbox']")
    if (checkbox instanceof HTMLElement && target instanceof Node && !checkbox.contains(target)) {
      if (event.button === 0 && !event.defaultPrevented) checkbox.click()
      return
    }
    if (!isRowOpenClick(event)) return
    if (onRowOpen) {
      onRowOpen(row.original)
      return
    }
    const href = getRowHref?.(row.original)
    if (!href || !navigate) return
    if (event.metaKey || event.ctrlKey) window.open(href, "_blank", "noopener")
    else navigate(href)
  }

  /** A middle-click on a linked row opens the record in a new tab, as a link would. */
  function openRowInNewTab(event: React.MouseEvent<HTMLTableRowElement>, row: Row<T>): void {
    if (!isRowOpenClick(event, 1)) return
    const href = getRowHref?.(row.original)
    if (href) window.open(href, "_blank", "noopener")
  }

  function renderRow(row: Row<T>): React.ReactElement {
    return (
      <TableRow
        key={row.id}
        id={`${rowIdPrefix}-${row.id}`}
        data-focused={row.id === focusedRowId ? "true" : undefined}
        tabIndex={row.id === focusedRowId ? -1 : undefined}
        data-state={row.getIsSelected() ? "selected" : undefined}
        onClick={rowsOpen ? (event) => openRow(event, row) : undefined}
        onAuxClick={getRowHref && !onRowOpen ? (event) => openRowInNewTab(event, row) : undefined}
        className={cn(rowsOpen && "cursor-pointer", row.id === focusedRowId && "bg-accent ring-2 ring-inset ring-ring")}
      >
        {row.getVisibleCells().map((cell) => (
          <TableCell key={cell.id} className="whitespace-normal align-top py-3">
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </TableCell>
        ))}
      </TableRow>
    )
  }

  const body = rows.map(renderRow)
  React.useEffect(() => {
    if (!focusedRowId || !scrollToFocusedRow) return
    const element = document.getElementById(`${rowIdPrefix}-${focusedRowId}`)
    element?.scrollIntoView({ block: "center" })
    element?.focus({ preventScroll: true })
  }, [focusedRowId, pageIndex, rowIdPrefix, scrollToFocusedRow])

  const tableElement = (
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
              colSpan={columnCount}
              className="h-24 text-center"
              role="status"
            >
              Loading {itemLabel}…
            </TableCell>
          </TableRow>
        ) : rows.length ? (
          body
        ) : (
          <TableRow>
            <TableCell
              colSpan={columnCount}
              className="h-24 text-center text-muted-foreground"
            >
              {emptyMessage}
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  )

  const listSheet = table.options.meta?.listSheet
  return (
    <div className="min-w-0 space-y-4" aria-busy={state.kind === "loading"}>
      {listSheet && (
        <div className="-mb-2 flex justify-end">
          <RecordColumnsButton sheet={listSheet} availableColumnIds={table.getAllLeafColumns().map((column) => column.id)} />
        </div>
      )}
      {state.kind === "error" && (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      )}
      {tableElement}
      <DataTablePagination table={table} itemLabel={itemLabel} id={paginationId} />
    </div>
  )
}


/** The search box over a record list's text columns. */
export function RecordSearchInput({
  value,
  onChange,
  label,
  placeholder,
  className,
}: {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly label: string
  readonly placeholder: string
  readonly className?: string
}): React.ReactElement {
  return (
    <div className={cn("relative w-full", className)}>
      <IconSearch
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        value={value}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-8 pl-9"
      />
    </div>
  )
}
