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

import type { Payment } from "@/db/schema-netsuite"
import { useIsMobile } from "@/hooks/use-mobile"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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

interface PaymentsTableProps {
  payments: Payment[]
  customerMap: Record<string, string>
  vendorMap: Record<string, string>
  projectMap: Record<string, string>
  onEdit?: (payment: Payment) => void
  onDelete?: (id: string) => void
}

export function PaymentsTable({
  payments,
  customerMap,
  vendorMap,
  projectMap,
  onEdit,
  onDelete,
}: PaymentsTableProps) {
  const isMobile = useIsMobile()
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [columnFilters, setColumnFilters] =
    React.useState<ColumnFiltersState>([])
  const [rowSelection, setRowSelection] = React.useState({})

  const columns: ColumnDef<Payment>[] = [
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
      accessorKey: "referenceNumber",
      header: "Reference #",
      cell: ({ row }) => (
        <span className="font-medium">
          {row.getValue("referenceNumber") || "-"}
        </span>
      ),
    },
    {
      accessorKey: "paymentType",
      header: "Type",
      cell: ({ row }) => {
        const type = row.getValue("paymentType") as string
        return (
          <Badge variant={type === "received" ? "default" : "secondary"}>
            {type}
          </Badge>
        )
      },
    },
    {
      id: "counterparty",
      header: "Customer/Vendor",
      cell: ({ row }) => {
        const p = row.original
        if (p.customerId) return customerMap[p.customerId] ?? "-"
        if (p.vendorId) return vendorMap[p.vendorId] ?? "-"
        return "-"
      },
    },
    {
      id: "project",
      header: "Project",
      cell: ({ row }) =>
        row.original.projectId
          ? (projectMap[row.original.projectId] ?? "-")
          : "-",
    },
    {
      accessorKey: "amount",
      header: "Amount",
      cell: ({ row }) => formatCurrency(row.getValue("amount") as number),
    },
    {
      accessorKey: "paymentDate",
      header: "Date",
      cell: ({ row }) =>
        new Date(
          row.getValue("paymentDate") as string
        ).toLocaleDateString(),
    },
    {
      accessorKey: "paymentMethod",
      header: "Method",
      cell: ({ row }) => {
        const m = row.getValue("paymentMethod") as string | null
        return m ? m.replace("_", " ") : "-"
      },
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const payment = row.original
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="size-8 p-0">
                <IconDotsVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit?.(payment)}>
                Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => onDelete?.(payment.id)}
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
    data: payments,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onRowSelectionChange: setRowSelection,
    state: { sorting, columnFilters, rowSelection },
  })

  const emptyState = (
    <div className="rounded-md border border-dashed p-8 text-center">
      <p className="text-muted-foreground">No payments yet</p>
      <p className="text-sm text-muted-foreground/70 mt-1">
        Record a payment to track money in or out.
      </p>
    </div>
  )

  if (isMobile) {
    const rows = table.getRowModel().rows
    return (
      <div className="space-y-3">
        <Input
          placeholder="Search by reference number..."
          value={
            (table.getColumn("referenceNumber")?.getFilterValue() as string) ??
            ""
          }
          onChange={(e) =>
            table
              .getColumn("referenceNumber")
              ?.setFilterValue(e.target.value)
          }
          className="w-full"
        />
        {rows.length ? (
          <div className="rounded-md border divide-y">
            {rows.map((row) => {
              const p = row.original
              const counterparty = p.customerId
                ? customerMap[p.customerId]
                : p.vendorId
                  ? vendorMap[p.vendorId]
                  : null
              return (
                <div
                  key={row.id}
                  className="flex items-center gap-3 px-3 py-2.5"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">
                        {p.referenceNumber || "-"}
                      </p>
                      <Badge
                        variant={
                          p.paymentType === "received"
                            ? "default"
                            : "secondary"
                        }
                        className="shrink-0 text-[10px] px-1.5 py-0"
                      >
                        {p.paymentType}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {counterparty ?? "-"}
                      {` · ${new Date(p.paymentDate).toLocaleDateString()}`}
                    </p>
                  </div>
                  <span className="text-sm font-semibold shrink-0">
                    {formatCurrency(p.amount)}
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
                      <DropdownMenuItem onClick={() => onEdit?.(p)}>
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => onDelete?.(p.id)}
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
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Input
        placeholder="Search by reference number..."
        value={
          (table.getColumn("referenceNumber")?.getFilterValue() as string) ??
          ""
        }
        onChange={(e) =>
          table
            .getColumn("referenceNumber")
            ?.setFilterValue(e.target.value)
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
                    No payments found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-muted-foreground">
          {table.getFilteredSelectedRowModel().rows.length} of{" "}
          {table.getFilteredRowModel().rows.length} row(s) selected
        </div>
        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  )
}
