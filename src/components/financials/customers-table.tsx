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

import type { Customer } from "@/db/schema"
import { useIsMobile } from "@/hooks/use-mobile"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
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
import { useDeveloperMode } from "@/components/developer-mode-provider"

interface CustomersTableProps {
  customers: Customer[]
  onEdit?: (customer: Customer) => void
  onDelete?: (id: string) => void
}

export function CustomersTable({
  customers,
  onEdit,
  onDelete,
}: CustomersTableProps) {
  const isMobile = useIsMobile()
  const { developerModeEnabled } = useDeveloperMode()
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

  const columns: ColumnDef<Customer>[] = [
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
      cell: ({ row }) => {
        const c = row.original
        const initials = c.name
          .split(/\s+/)
          .map((w) => w[0])
          .join("")
          .slice(0, 2)
          .toUpperCase()
        return (
          <div className="flex items-center gap-3">
            <Avatar size="sm">
              <AvatarFallback className="text-[10px]">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <span className="font-medium block truncate">
                {c.name}
              </span>
              {c.company ? (
                <span className="text-xs text-muted-foreground block truncate">
                  {c.company}
                </span>
              ) : null}
            </div>
          </div>
        )
      },
    },
    {
      accessorKey: "email",
      header: "Email",
      cell: ({ row }) => {
        const email = row.getValue("email") as string | null
        if (!email) {
          return (
            <span className="text-muted-foreground/40">—</span>
          )
        }
        return (
          <a
            href={`mailto:${email}`}
            className="text-sm hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {email}
          </a>
        )
      },
    },
    {
      accessorKey: "phone",
      header: "Phone",
      cell: ({ row }) => {
        const phone = row.getValue("phone") as string | null
        if (!phone) {
          return (
            <span className="text-muted-foreground/40">—</span>
          )
        }
        return (
          <a
            href={`tel:${phone}`}
            className="text-sm tabular-nums hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {phone}
          </a>
        )
      },
    },
    {
      accessorKey: "relationshipType",
      header: "Status",
      cell: ({ row }) => (
        <Badge
          variant={
            row.original.relationshipType === "lead" ? "secondary" : "outline"
          }
        >
          {row.original.relationshipType === "lead" ? "Lead" : "Client"}
        </Badge>
      ),
    },
    {
      id: "source",
      header: "Source",
      cell: ({ row }) => {
        const customer = row.original
        const isSageLinked = Boolean(
          customer.sageClientId || customer.sageClientNumber
        )
        const isBuildertrendLinked = Boolean(customer.buildertrendContactId)
        return (
          <div className="flex flex-wrap gap-1">
            {isSageLinked ? (
              <Badge variant="outline">
                Sage
                {customer.sageClientNumber
                  ? ` #${customer.sageClientNumber}`
                  : ""}
              </Badge>
            ) : null}
            {isBuildertrendLinked ? (
              <Badge variant="outline">Buildertrend</Badge>
            ) : null}
            {!isSageLinked && !isBuildertrendLinked ? (
              <Badge variant="outline">Compass</Badge>
            ) : null}
          </div>
        )
      },
    },
    {
      accessorKey: "createdAt",
      header: "Added",
      cell: ({ row }) => {
        const d = row.getValue("createdAt") as string
        return (
          <span className="text-muted-foreground text-xs tabular-nums">
            {new Date(d).toLocaleDateString("en-US", {
              month: "short",
              year: "numeric",
            })}
          </span>
        )
      },
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const customer = row.original
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="size-8 p-0">
                <span className="sr-only">open menu</span>
                <IconDotsVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit?.(customer)}>
                Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => onDelete?.(customer.id)}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  ]
  const visibleColumns = developerModeEnabled
    ? columns
    : columns.filter((column) => column.id !== "source")

  const table = useReactTable({
    data: customers,
    columns: visibleColumns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onRowSelectionChange: setRowSelection,
    initialState: { pagination: { pageSize: 100 } },
    state: { sorting, columnFilters, rowSelection },
  })

  const emptyState = (
    <div className="rounded-md border border-dashed p-8 text-center">
      <p className="text-muted-foreground">No client or lead contacts yet</p>
      <p className="text-sm text-muted-foreground/70 mt-1">
        Add a contact to associate them with projects when ready.
      </p>
    </div>
  )

  if (isMobile) {
    const rows = table.getRowModel().rows
    return (
      <div className="space-y-3">
        <Input
          placeholder="Search clients and leads..."
          value={
            (table.getColumn("name")?.getFilterValue() as string) ?? ""
          }
          onChange={(e) =>
            table.getColumn("name")?.setFilterValue(e.target.value)
          }
          className="w-full"
        />
        <Select value={sortKey} onValueChange={handleSort}>
          <SelectTrigger className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name-asc">Name A-Z</SelectItem>
            <SelectItem value="name-desc">Name Z-A</SelectItem>
            <SelectItem value="newest">Newest</SelectItem>
            <SelectItem value="oldest">Oldest</SelectItem>
          </SelectContent>
        </Select>
        {rows.length ? (
          <div className="rounded-md border divide-y">
            {rows.map((row) => {
              const c = row.original
              return (
                <div
                  key={row.id}
                  className="flex items-center gap-3 px-3 py-2.5"
                >
                  <Avatar size="sm">
                    <AvatarFallback className="text-[10px]">
                      {c.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {c.name}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {[c.company, c.email, c.phone]
                        .filter(Boolean)
                        .join(" \u00b7 ") || "No contact info"}
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
                      <DropdownMenuItem onClick={() => onEdit?.(c)}>
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => onDelete?.(c.id)}
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
    <div className="flex flex-1 flex-col min-h-0 gap-3">
      <Input
        placeholder="Search customers..."
        value={(table.getColumn("name")?.getFilterValue() as string) ?? ""}
        onChange={(e) =>
          table.getColumn("name")?.setFilterValue(e.target.value)
        }
        className="h-8 w-full sm:max-w-sm shrink-0"
      />
      <div className="rounded-md border flex-1 min-h-0 overflow-hidden">
        <div className="overflow-auto h-full">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
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
                    colSpan={visibleColumns.length}
                    className="h-24 text-center"
                  >
                    No customers found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
      {(table.getPageCount() > 1 ||
        table.getFilteredSelectedRowModel().rows.length > 0) && (
        <div className="flex items-center justify-between shrink-0">
          <div className="text-xs text-muted-foreground">
            {table.getFilteredSelectedRowModel().rows.length > 0
              ? `${table.getFilteredSelectedRowModel().rows.length} of ${table.getFilteredRowModel().rows.length} selected`
              : `${table.getFilteredRowModel().rows.length} contacts`}
          </div>
          {table.getPageCount() > 1 && (
            <div className="flex items-center gap-2">
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
          )}
        </div>
      )}
    </div>
  )
}
