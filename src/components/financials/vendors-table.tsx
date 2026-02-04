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

import type { Vendor } from "@/db/schema"
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

interface VendorsTableProps {
  vendors: Vendor[]
  onEdit?: (vendor: Vendor) => void
  onDelete?: (id: string) => void
}

export function VendorsTable({
  vendors,
  onEdit,
  onDelete,
}: VendorsTableProps) {
  const isMobile = useIsMobile()
  const [sorting, setSorting] = React.useState<SortingState>([
    { id: "name", desc: false },
  ])
  const [columnFilters, setColumnFilters] =
    React.useState<ColumnFiltersState>([])
  const [rowSelection, setRowSelection] = React.useState({})

  const sortKey = React.useMemo(() => {
    if (!sorting.length) return "name-asc"
    const s = sorting[0]
    if (s.id === "name") return s.desc ? "name-desc" : "name-asc"
    if (s.id === "createdAt") return s.desc ? "newest" : "oldest"
    return "name-asc"
  }, [sorting])

  const handleSort = (value: string) => {
    switch (value) {
      case "name-asc":
        setSorting([{ id: "name", desc: false }])
        break
      case "name-desc":
        setSorting([{ id: "name", desc: true }])
        break
      case "newest":
        setSorting([{ id: "createdAt", desc: true }])
        break
      case "oldest":
        setSorting([{ id: "createdAt", desc: false }])
        break
    }
  }

  const columns: ColumnDef<Vendor>[] = [
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
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => (
        <span className="font-medium">{row.getValue("name")}</span>
      ),
    },
    {
      accessorKey: "category",
      header: "Category",
      cell: ({ row }) => (
        <Badge variant="secondary">{row.getValue("category")}</Badge>
      ),
      filterFn: (row, id, value) => {
        if (!value || value === "all") return true
        return row.getValue(id) === value
      },
    },
    {
      accessorKey: "email",
      header: "Email",
      cell: ({ row }) =>
        row.getValue("email") || (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      accessorKey: "phone",
      header: "Phone",
      cell: ({ row }) =>
        row.getValue("phone") || (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const vendor = row.original
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="size-8 p-0">
                <span className="sr-only">open menu</span>
                <IconDotsVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit?.(vendor)}>
                Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => onDelete?.(vendor.id)}
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
    data: vendors,
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
      <p className="text-muted-foreground">No vendors yet</p>
      <p className="text-sm text-muted-foreground/70 mt-1">
        Add your first vendor to manage subcontractors, suppliers, and bills.
      </p>
    </div>
  )

  const categoryFilter = (
    <Select
      value={
        (table.getColumn("category")?.getFilterValue() as string) ?? "all"
      }
      onValueChange={(v) =>
        table.getColumn("category")?.setFilterValue(v === "all" ? "" : v)
      }
    >
      <SelectTrigger className="flex-1 sm:w-[180px] sm:flex-none">
        <SelectValue placeholder="Filter by category" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All Categories</SelectItem>
        <SelectItem value="Subcontractor">Subcontractor</SelectItem>
        <SelectItem value="Supplier">Supplier</SelectItem>
        <SelectItem value="Equipment">Equipment</SelectItem>
        <SelectItem value="Material">Material</SelectItem>
        <SelectItem value="Consultant">Consultant</SelectItem>
        <SelectItem value="Other">Other</SelectItem>
      </SelectContent>
    </Select>
  )

  if (isMobile) {
    const rows = table.getRowModel().rows
    return (
      <div className="space-y-3">
        <Input
          placeholder="Search vendors..."
          value={
            (table.getColumn("name")?.getFilterValue() as string) ?? ""
          }
          onChange={(e) =>
            table.getColumn("name")?.setFilterValue(e.target.value)
          }
          className="w-full"
        />
        <div className="grid grid-cols-2 gap-2">
          <Select value={sortKey} onValueChange={handleSort}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name-asc">Name A-Z</SelectItem>
              <SelectItem value="name-desc">Name Z-A</SelectItem>
              <SelectItem value="newest">Newest</SelectItem>
              <SelectItem value="oldest">Oldest</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={
              (table.getColumn("category")?.getFilterValue() as string) ??
              "all"
            }
            onValueChange={(v) =>
              table
                .getColumn("category")
                ?.setFilterValue(v === "all" ? "" : v)
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              <SelectItem value="Subcontractor">Subcontractor</SelectItem>
              <SelectItem value="Supplier">Supplier</SelectItem>
              <SelectItem value="Equipment">Equipment</SelectItem>
              <SelectItem value="Material">Material</SelectItem>
              <SelectItem value="Consultant">Consultant</SelectItem>
              <SelectItem value="Other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {rows.length ? (
          <div className="rounded-md border divide-y">
            {rows.map((row) => {
              const v = row.original
              return (
                <div
                  key={row.id}
                  className="flex items-center gap-3 px-3 py-2.5"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">
                        {v.name}
                      </p>
                      <Badge
                        variant="secondary"
                        className="shrink-0 text-[10px] px-1.5 py-0"
                      >
                        {v.category}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {[v.email, v.phone].filter(Boolean).join(" \u00b7 ") ||
                        "No contact info"}
                    </p>
                  </div>
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
                      <DropdownMenuItem onClick={() => onEdit?.(v)}>
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => onDelete?.(v.id)}
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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <Input
          placeholder="Search vendors..."
          value={(table.getColumn("name")?.getFilterValue() as string) ?? ""}
          onChange={(e) =>
            table.getColumn("name")?.setFilterValue(e.target.value)
          }
          className="w-full sm:max-w-sm"
        />
        {categoryFilter}
      </div>
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
                    No vendors found
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
