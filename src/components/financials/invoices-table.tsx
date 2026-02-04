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

import type { Invoice } from "@/db/schema-netsuite"
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

const STATUS_VARIANT: Record<string, "secondary" | "default" | "outline" | "destructive"> = {
  draft: "secondary",
  sent: "default",
  paid: "outline",
  overdue: "destructive",
  partially_paid: "default",
  void: "secondary",
}

interface InvoicesTableProps {
  invoices: Invoice[]
  customerMap: Record<string, string>
  projectMap: Record<string, string>
  onEdit?: (invoice: Invoice) => void
  onDelete?: (id: string) => void
}

export function InvoicesTable({
  invoices,
  customerMap,
  projectMap,
  onEdit,
  onDelete,
}: InvoicesTableProps) {
  const isMobile = useIsMobile()
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [columnFilters, setColumnFilters] =
    React.useState<ColumnFiltersState>([])
  const [rowSelection, setRowSelection] = React.useState({})

  const columns: ColumnDef<Invoice>[] = [
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
      accessorKey: "invoiceNumber",
      header: "Invoice #",
      cell: ({ row }) => (
        <span className="font-medium">
          {row.getValue("invoiceNumber") || "-"}
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
      id: "project",
      header: "Project",
      cell: ({ row }) =>
        row.original.projectId
          ? (projectMap[row.original.projectId] ?? "-")
          : "-",
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => {
        const status = row.getValue("status") as string
        return (
          <Badge variant={STATUS_VARIANT[status] ?? "secondary"}>
            {status.replace("_", " ")}
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
      accessorKey: "dueDate",
      header: "Due Date",
      cell: ({ row }) => {
        const d = row.getValue("dueDate") as string | null
        return d ? new Date(d).toLocaleDateString() : "-"
      },
    },
    {
      accessorKey: "total",
      header: "Total",
      cell: ({ row }) => formatCurrency(row.getValue("total") as number),
    },
    {
      accessorKey: "amountDue",
      header: "Amount Due",
      cell: ({ row }) =>
        formatCurrency(row.getValue("amountDue") as number),
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const invoice = row.original
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="size-8 p-0">
                <IconDotsVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit?.(invoice)}>
                Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => onDelete?.(invoice.id)}
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
    data: invoices,
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
      <p className="text-muted-foreground">No invoices yet</p>
      <p className="text-sm text-muted-foreground/70 mt-1">
        Create an invoice to bill a customer for project work.
      </p>
    </div>
  )

  if (isMobile) {
    const rows = table.getRowModel().rows
    return (
      <div className="space-y-3">
        <Input
          placeholder="Search by invoice number..."
          value={
            (table.getColumn("invoiceNumber")?.getFilterValue() as string) ??
            ""
          }
          onChange={(e) =>
            table.getColumn("invoiceNumber")?.setFilterValue(e.target.value)
          }
          className="w-full"
        />
        {rows.length ? (
          <div className="rounded-md border divide-y">
            {rows.map((row) => {
              const inv = row.original
              const status = inv.status
              return (
                <div
                  key={row.id}
                  className="flex items-center gap-3 px-3 py-2.5"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">
                        {inv.invoiceNumber || "-"}
                      </p>
                      <Badge
                        variant={STATUS_VARIANT[status] ?? "secondary"}
                        className="shrink-0 text-[10px] px-1.5 py-0"
                      >
                        {status.replace("_", " ")}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {customerMap[inv.customerId] ?? "-"}
                      {inv.dueDate && ` · Due ${new Date(inv.dueDate).toLocaleDateString()}`}
                    </p>
                  </div>
                  <span className="text-sm font-semibold shrink-0">
                    {formatCurrency(inv.total)}
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
                      <DropdownMenuItem onClick={() => onEdit?.(inv)}>
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => onDelete?.(inv.id)}
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
        placeholder="Search by invoice number..."
        value={
          (table.getColumn("invoiceNumber")?.getFilterValue() as string) ?? ""
        }
        onChange={(e) =>
          table.getColumn("invoiceNumber")?.setFilterValue(e.target.value)
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
                    No invoices found
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
