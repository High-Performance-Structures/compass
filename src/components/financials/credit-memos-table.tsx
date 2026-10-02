"use client"

import * as React from "react"
import { IconDotsVertical } from "@tabler/icons-react"
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
} from "@tanstack/react-table"

import type { CreditMemo } from "@/db/schema-netsuite"
import { useIsMobile } from "@/hooks/use-mobile"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DataTablePagination,
  DEFAULT_TABLE_PAGE_SIZE,
} from "@/components/data-table-pagination"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatCurrency } from "@/lib/utils"

const STATUS_VARIANT: Record<string, "secondary" | "default" | "outline"> = {
  draft: "secondary",
  applied: "default",
  void: "outline",
}

interface CreditMemosTableProps {
  creditMemos: CreditMemo[]
  customerMap: Record<string, string>
  onEdit?: (memo: CreditMemo) => void
  onDelete?: (id: string) => void
}

export function CreditMemosTable({
  creditMemos,
  customerMap,
  onEdit,
  onDelete,
}: CreditMemosTableProps) {
  const isMobile = useIsMobile()
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [columnFilters, setColumnFilters] =
    React.useState<ColumnFiltersState>([])
  const [rowSelection, setRowSelection] = React.useState({})
  const [pagination, setPagination] = React.useState({
    pageIndex: 0,
    pageSize: DEFAULT_TABLE_PAGE_SIZE,
  })

  const columns: ColumnDef<CreditMemo>[] = [
    {
      id: "select",
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllPageRowsSelected()}
          onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
          aria-label="select all"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(v) => row.toggleSelected(!!v)}
          aria-label="select row"
        />
      ),
      enableSorting: false,
      enableHiding: false,
    },
    {
      accessorKey: "memoNumber",
      header: "Memo #",
      cell: ({ row }) => (
        <span className="font-medium">
          {row.getValue("memoNumber") || "-"}
        </span>
      ),
    },
    {
      id: "customer",
      header: "Customer",
      cell: ({ row }) =>
        customerMap[row.original.customerId] ?? "-",
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => {
        const status = row.getValue("status") as string
        return (
          <Badge variant={STATUS_VARIANT[status] ?? "secondary"}>
            {status}
          </Badge>
        )
      },
    },
    {
      accessorKey: "issueDate",
      header: "Issue Date",
      cell: ({ row }) =>
        new Date(row.getValue("issueDate") as string).toLocaleDateString(),
    },
    {
      accessorKey: "total",
      header: "Total",
      cell: ({ row }) => formatCurrency(row.getValue("total") as number),
    },
    {
      accessorKey: "amountApplied",
      header: "Applied",
      cell: ({ row }) =>
        formatCurrency(row.getValue("amountApplied") as number),
    },
    {
      accessorKey: "amountRemaining",
      header: "Remaining",
      cell: ({ row }) =>
        formatCurrency(row.getValue("amountRemaining") as number),
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const memo = row.original
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="size-8 p-0">
                <IconDotsVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit?.(memo)}>
                Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => onDelete?.(memo.id)}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  ]

  const table = useReactTable({
    data: creditMemos,
    columns,
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
    onRowSelectionChange: setRowSelection,
    autoResetPageIndex: false,
    onPaginationChange: setPagination,
    state: { sorting, columnFilters, rowSelection, pagination },
  })

  const emptyState = (
    <div className="rounded-md border border-dashed p-8 text-center">
      <p className="text-muted-foreground">No credit memos yet</p>
      <p className="text-sm text-muted-foreground/70 mt-1">
        Create a credit memo to adjust a customer balance.
      </p>
    </div>
  )

  if (isMobile) {
    const rows = table.getRowModel().rows
    return (
      <div className="space-y-3">
        <Input
          placeholder="Search by memo number..."
          value={
            (table.getColumn("memoNumber")?.getFilterValue() as string) ?? ""
          }
          onChange={(e) =>
            table.getColumn("memoNumber")?.setFilterValue(e.target.value)
          }
          className="w-full"
        />
        {rows.length ? (
          <div className="rounded-md border divide-y">
            {rows.map((row) => {
              const memo = row.original
              const status = memo.status
              return (
                <div
                  key={row.id}
                  className="flex items-center gap-3 px-3 py-2.5"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">
                        {memo.memoNumber || "-"}
                      </p>
                      <Badge
                        variant={STATUS_VARIANT[status] ?? "secondary"}
                        className="shrink-0 text-[10px] px-1.5 py-0"
                      >
                        {status}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {customerMap[memo.customerId] ?? "-"}
                      {memo.amountRemaining > 0 && ` · ${formatCurrency(memo.amountRemaining)} remaining`}
                    </p>
                  </div>
                  <span className="text-sm font-semibold shrink-0">
                    {formatCurrency(memo.total)}
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 shrink-0"
                      >
                        <IconDotsVertical className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onEdit?.(memo)}>
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => onDelete?.(memo.id)}
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )
            })}
          </div>
        ) : (
          emptyState
        )}
        <DataTablePagination
          table={table}
          itemLabel="credit memos"
          id="credit-memos-mobile-items-per-page"
        />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Input
        placeholder="Search by memo number..."
        value={
          (table.getColumn("memoNumber")?.getFilterValue() as string) ?? ""
        }
        onChange={(e) =>
          table.getColumn("memoNumber")?.setFilterValue(e.target.value)
        }
        className="w-full sm:max-w-sm"
      />
      <div className="rounded-md border overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id}>
                  {hg.headers.map((header) => (
                    <TableHead key={header.id} className="whitespace-nowrap">
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
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
                    No credit memos found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
      <DataTablePagination table={table} itemLabel="credit memos" id="credit-memos-items-per-page" />
    </div>
  )
}
