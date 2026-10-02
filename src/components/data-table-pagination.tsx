"use client"

import * as React from "react"
import {
  IconChevronLeft,
  IconChevronRight,
  IconChevronsLeft,
  IconChevronsRight,
} from "@tabler/icons-react"
import type { Table } from "@tanstack/react-table"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export const TABLE_PAGE_SIZES = [25, 50, 100] as const
export const DEFAULT_TABLE_PAGE_SIZE: number = TABLE_PAGE_SIZES[0]

interface DataTablePaginationProps<TData> {
  readonly table: Table<TData>
  readonly itemLabel?: string
  readonly id?: string
}

export function DataTablePagination<TData>({
  table,
  itemLabel = "items",
  id = "table-items-per-page",
}: DataTablePaginationProps<TData>): React.ReactElement {
  const pageCount = Math.max(table.getPageCount(), 1)
  const pageIndex = table.getState().pagination.pageIndex
  const currentPage = Math.min(pageIndex + 1, pageCount)

  React.useEffect(() => {
    const lastPageIndex = Math.max(pageCount - 1, 0)
    if (pageIndex > lastPageIndex) {
      table.setPageIndex(lastPageIndex)
    }
  }, [pageCount, pageIndex, table])

  const totalRows = table.getFilteredRowModel().rows.length
  const selectedRows = table.getFilteredSelectedRowModel().rows.length

  return (
    <div className="flex shrink-0 flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="text-muted-foreground">
        {selectedRows > 0
          ? `${selectedRows} of ${totalRows} ${itemLabel} selected`
          : `${totalRows} ${itemLabel}`}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3">
        <div className="flex items-center gap-2">
          <Label htmlFor={id} className="whitespace-nowrap text-sm font-medium">
            Items per page
          </Label>
          <Select
            value={`${table.getState().pagination.pageSize}`}
            onValueChange={(value) => {
              table.setPageSize(Number(value))
            }}
          >
            <SelectTrigger size="sm" className="w-20" id={id}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent side="top">
              {TABLE_PAGE_SIZES.map((pageSize) => (
                <SelectItem key={pageSize} value={`${pageSize}`}>
                  {pageSize}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <span className="whitespace-nowrap font-medium" aria-live="polite">
          Page {currentPage} of {pageCount}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => table.setPageIndex(0)}
            disabled={!table.getCanPreviousPage()}
            aria-label="Go to first page"
          >
            <IconChevronsLeft />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            aria-label="Go to previous page"
          >
            <IconChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            aria-label="Go to next page"
          >
            <IconChevronRight />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => table.setPageIndex(pageCount - 1)}
            disabled={!table.getCanNextPage()}
            aria-label="Go to last page"
          >
            <IconChevronsRight />
          </Button>
        </div>
      </div>
    </div>
  )
}
