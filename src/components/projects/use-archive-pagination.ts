"use client"

import * as React from "react"
import { getCoreRowModel, getPaginationRowModel, useReactTable, type Table, type PaginationState } from "@tanstack/react-table"

import { DataTablePagination, DEFAULT_TABLE_PAGE_SIZE } from "@/components/data-table-pagination"

export function useArchivePagination<T extends { readonly title: string; readonly period: string }>(documents: readonly T[], pageSizeId: string): { readonly controls: React.ReactElement; readonly table: Table<T>; readonly query: string; readonly setQuery: (query: string) => void } {
  const [pagination, setPagination] = React.useState<PaginationState>({ pageIndex: 0, pageSize: DEFAULT_TABLE_PAGE_SIZE })
  const [query, updateQuery] = React.useState("")
  const data = React.useMemo(() => documents.filter((row) => `${row.title} ${row.period}`.toLowerCase().includes(query.toLowerCase())), [documents, query])
  const table = useReactTable({ data, columns: [{ id: "title", accessorFn: (row) => row.title }], getCoreRowModel: getCoreRowModel(), getPaginationRowModel: getPaginationRowModel(), state: { pagination }, onPaginationChange: setPagination, autoResetPageIndex: false })
  return { table, controls: React.createElement(DataTablePagination<T>, { table, itemLabel: "archive editions", id: pageSizeId }), query, setQuery: (value) => { updateQuery(value); table.setPageIndex(0) } }
}
