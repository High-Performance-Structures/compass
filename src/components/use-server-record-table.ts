"use client"

import * as React from "react"
import {
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type PaginationState,
  type RowSelectionState,
  type SortingState,
  type Table as TableInstance,
} from "@tanstack/react-table"

import type { ActionResult } from "@/lib/action-result"
import { DEFAULT_RECORD_PAGE_QUERY, type RecordPage, type RecordPageQuery } from "@/lib/record-page"

const SEARCH_DEBOUNCE_MS = 250

type ServerRecordTableState =
  | { readonly kind: "ready" }
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }

export type ServerRecordTable<T, P extends RecordPage<T>> = {
  readonly table: TableInstance<T>
  readonly state: ServerRecordTableState
  /** The last page the server returned, with any extra data it carried. */
  readonly page: P | null
  readonly search: string
  readonly setSearch: (value: string) => void
  /** Selected rows, kept across pages and searches until cleared. */
  readonly selectedRows: readonly T[]
  readonly clearSelection: () => void
}

/**
 * The server-paged variant of `useRecordTable` for lists too large to send
 * whole. The server searches, sorts and pages; the browser holds one page.
 * Search, sort and filter changes go back to page 1; a reload keeps the page.
 */
export function useServerRecordTable<T, P extends RecordPage<T>>({
  columns,
  getRowId,
  load,
  filterKey = "",
  reloadToken = 0,
  initialPage = null,
  enableSelection = false,
}: {
  readonly columns: readonly ColumnDef<T>[]
  readonly getRowId: (row: T) => string
  readonly load: (query: RecordPageQuery) => Promise<ActionResult<P>>
  /** Changes when a list filter outside the table changes. */
  readonly filterKey?: string
  /** Bump to re-read the current page after a change elsewhere. */
  readonly reloadToken?: number
  /** The first page, read on the server with the default query. */
  readonly initialPage?: P | null
  readonly enableSelection?: boolean
}): ServerRecordTable<T, P> {
  const [search, setSearchValue] = React.useState("")
  const [debouncedSearch, setDebouncedSearch] = React.useState("")
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [pagination, setPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize: DEFAULT_RECORD_PAGE_QUERY.pageSize,
  })
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({})
  const [page, setPage] = React.useState<P | null>(initialPage)
  const [state, setState] = React.useState<ServerRecordTableState>(
    initialPage ? { kind: "ready" } : { kind: "loading" },
  )
  const selectedCache = React.useRef(new Map<string, T>())
  const loadRef = React.useRef(load)
  React.useEffect(() => { loadRef.current = load }, [load])

  React.useEffect(() => {
    const term = search.trim()
    if (term === debouncedSearch) return
    // Search and the return to page 1 land in one update, so one read runs.
    const timer = window.setTimeout(() => {
      setDebouncedSearch(term)
      setPagination((current) => (current.pageIndex === 0 ? current : { ...current, pageIndex: 0 }))
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [search, debouncedSearch])

  // A filter change goes back to page 1 in the same render, so only one read runs.
  const [seenFilterKey, setSeenFilterKey] = React.useState(filterKey)
  if (seenFilterKey !== filterKey) {
    setSeenFilterKey(filterKey)
    setPagination((current) => ({ ...current, pageIndex: 0 }))
  }

  const sort = sorting[0]
  const query: RecordPageQuery = React.useMemo(() => ({
    search: debouncedSearch,
    sortId: sort?.id ?? null,
    sortDesc: sort?.desc ?? false,
    pageIndex: pagination.pageIndex,
    pageSize: pagination.pageSize,
  }), [debouncedSearch, sort?.id, sort?.desc, pagination.pageIndex, pagination.pageSize])

  // The server already sent the default first page; read again only when the
  // query, filter or reload token moves away from it.
  const skipInitial = React.useRef(initialPage !== null)
  React.useEffect(() => {
    if (skipInitial.current) {
      skipInitial.current = false
      return
    }
    let active = true
    setState({ kind: "loading" })
    void loadRef.current(query).then((result) => {
      if (!active) return
      if (result.success) {
        setPage(result.data)
        setState({ kind: "ready" })
      } else {
        setState({ kind: "error", message: result.error })
      }
    }).catch(() => {
      if (active) setState({ kind: "error", message: "Could not load this list. Please try again." })
    })
    return () => { active = false }
  }, [query, filterKey, reloadToken])

  const rows = React.useMemo(() => [...(page?.rows ?? [])], [page])
  const tableColumns = React.useMemo(() => [...columns], [columns])
  const table = useReactTable({
    data: rows,
    columns: tableColumns,
    getRowId,
    rowCount: page?.total ?? 0,
    state: { sorting, pagination, rowSelection },
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    onSortingChange: (update) => {
      setSorting(update)
      setPagination((current) => ({ ...current, pageIndex: 0 }))
    },
    onPaginationChange: setPagination,
    onRowSelectionChange: setRowSelection,
    autoResetPageIndex: false,
    enableRowSelection: enableSelection,
    enableMultiSort: false,
    defaultColumn: { sortDescFirst: false },
    getCoreRowModel: getCoreRowModel(),
  })

  const selectedRows = React.useMemo(() => {
    const cache = selectedCache.current
    for (const row of rows) {
      const id = getRowId(row)
      if (rowSelection[id]) cache.set(id, row)
    }
    for (const id of Array.from(cache.keys())) {
      if (!rowSelection[id]) cache.delete(id)
    }
    return Array.from(cache.values())
  }, [rows, rowSelection, getRowId])

  const setSearch = React.useCallback((value: string) => setSearchValue(value), [])
  const clearSelection = React.useCallback(() => setRowSelection({}), [])
  return { table, state, page, search, setSearch, selectedRows, clearSelection }
}
