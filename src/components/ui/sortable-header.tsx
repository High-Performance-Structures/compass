"use client"

import * as React from "react"
import { flexRender, type Header } from "@tanstack/react-table"
import { IconArrowDown, IconArrowUp, IconArrowsSort } from "@tabler/icons-react"
import { TableHead } from "@/components/ui/table"
import { cn } from "@/lib/utils"

export type SortDirection = "asc" | "desc"
export type TableSort<K extends string> = { readonly key: K; readonly direction: SortDirection } | null

function SortIcon({ direction }: { readonly direction: SortDirection | false }): React.ReactElement {
  if (direction === "asc") return <IconArrowUp className="size-3.5" aria-hidden />
  if (direction === "desc") return <IconArrowDown className="size-3.5" aria-hidden />
  return <IconArrowsSort className="size-3.5 opacity-0 transition-opacity group-hover/sort:opacity-60 group-focus-visible/sort:opacity-60" aria-hidden />
}

function SortButton({
  direction,
  onClick,
  children,
  align = "left",
}: {
  readonly direction: SortDirection | false
  readonly onClick: () => void
  readonly children: React.ReactNode
  readonly align?: "left" | "right"
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group/sort -mx-1 inline-flex items-center gap-1 rounded-sm px-1 py-0.5 font-inherit text-inherit hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        align === "right" && "flex-row-reverse",
        direction && "text-foreground",
      )}
    >
      <span>{children}</span>
      <SortIcon direction={direction} />
    </button>
  )
}

/** aria-sort value for a header cell. */
export function ariaSort(direction: SortDirection | false): "ascending" | "descending" | "none" {
  return direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"
}

/**
 * Header content for a TanStack table column: clickable to sort when the
 * column can sort (ascending, descending, then off), plain otherwise.
 */
export function TanstackSortableHeader<T>({ header }: { readonly header: Header<T, unknown> }): React.ReactNode {
  if (header.isPlaceholder) return null
  const content = flexRender(header.column.columnDef.header, header.getContext())
  if (!header.column.getCanSort()) return content
  return (
    <SortButton direction={header.column.getIsSorted()} onClick={() => header.column.toggleSorting(undefined, false)}>
      {content}
    </SortButton>
  )
}

type SortValue = string | number | null | undefined

/** Compares values for sorting: blanks last, numbers numerically, text naturally. */
export function compareSortValues(a: SortValue, b: SortValue): number {
  const aBlank = a === null || a === undefined || a === ""
  const bBlank = b === null || b === undefined || b === ""
  if (aBlank || bBlank) return aBlank === bBlank ? 0 : aBlank ? 1 : -1
  if (typeof a === "number" && typeof b === "number") return a - b
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" })
}

/** Next sort after clicking a column: ascending, then descending, then off. */
export function nextSort<K extends string>(current: TableSort<K>, key: K): TableSort<K> {
  if (!current || current.key !== key) return { key, direction: "asc" }
  return current.direction === "asc" ? { key, direction: "desc" } : null
}

/** Sorts rows for a hand-built table; blanks stay last in both directions. */
export function sortRows<T, K extends string>(
  rows: readonly T[],
  sort: TableSort<K>,
  accessors: Readonly<Record<K, (row: T) => SortValue>>,
): readonly T[] {
  if (!sort) return rows
  const accessor = accessors[sort.key]
  const factor = sort.direction === "asc" ? 1 : -1
  return rows
    .map((row, index) => ({ row, index, value: accessor(row) }))
    .sort((a, b) => {
      const aBlank = a.value === null || a.value === undefined || a.value === ""
      const bBlank = b.value === null || b.value === undefined || b.value === ""
      if (aBlank !== bBlank) return aBlank ? 1 : -1
      return compareSortValues(a.value, b.value) * factor || a.index - b.index
    })
    .map((item) => item.row)
}

/** Sort state plus sorted rows for a hand-built table. */
export function useTableSort<T, K extends string>(
  rows: readonly T[],
  accessors: Readonly<Record<K, (row: T) => SortValue>>,
  initial: TableSort<K> = null,
): {
  readonly rows: readonly T[]
  readonly sort: TableSort<K>
  readonly toggle: (key: K) => void
} {
  const [sort, setSort] = React.useState<TableSort<K>>(initial)
  // Accessors are usually inline objects; sorting cost is small for list sizes here.
  const sorted = React.useMemo(() => sortRows(rows, sort, accessors), [rows, sort, accessors])
  return { rows: sorted, sort, toggle: (key) => setSort((current) => nextSort(current, key)) }
}

/** A <th> whose label sorts the table; pass the table's sort state. */
export function SortableTh<K extends string>({
  sortKey,
  sort,
  onSort,
  className,
  align = "left",
  children,
}: {
  readonly sortKey: K
  readonly sort: TableSort<K>
  readonly onSort: (key: K) => void
  readonly className?: string
  readonly align?: "left" | "right"
  readonly children: React.ReactNode
}): React.ReactElement {
  const direction = sort?.key === sortKey ? sort.direction : false
  return (
    <th className={className} aria-sort={ariaSort(direction)} scope="col">
      <SortButton direction={direction} onClick={() => onSort(sortKey)} align={align}>
        {children}
      </SortButton>
    </th>
  )
}

/** SortableTh styled as a shadcn TableHead. */
export function SortableTableHead<K extends string>({
  sortKey,
  sort,
  onSort,
  className,
  align = "left",
  children,
}: {
  readonly sortKey: K
  readonly sort: TableSort<K>
  readonly onSort: (key: K) => void
  readonly className?: string
  readonly align?: "left" | "right"
  readonly children: React.ReactNode
}): React.ReactElement {
  const direction = sort?.key === sortKey ? sort.direction : false
  return (
    <TableHead className={className} aria-sort={ariaSort(direction)} scope="col">
      <SortButton direction={direction} onClick={() => onSort(sortKey)} align={align}>
        {children}
      </SortButton>
    </TableHead>
  )
}
