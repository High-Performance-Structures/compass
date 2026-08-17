"use client"

import * as React from "react"
import { IconDotsVertical } from "@tabler/icons-react"
import type { VendorDirectoryCompany } from "@/app/actions/vendors"
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

import { useIsMobile } from "@/hooks/use-mobile"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
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
import { SearchableCombobox } from "@/components/searchable-combobox"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useDeveloperMode } from "@/components/developer-mode-provider"

interface VendorsTableProps {
  vendors: readonly VendorDirectoryCompany[]
  categories: readonly string[]
  onEdit?: (vendor: VendorDirectoryCompany) => void
  onDelete?: (id: string) => void
}

function vendorSourceLabel(vendor: VendorDirectoryCompany): string {
  if (vendor.sourceSystem?.includes("sage")) return "Sage"
  if (vendor.sourceSystem === "buildertrend") return "BT only"
  return "Compass"
}

function vendorSyncLabel(vendor: VendorDirectoryCompany): string {
  if (vendor.syncStatus === "needs_sage_review") return "Needs Sage review"
  if (vendor.syncStatus === "synced") return "Synced"
  return "Manual"
}

export function VendorsTable({
  vendors,
  categories,
  onEdit,
  onDelete,
}: VendorsTableProps) {
  const isMobile = useIsMobile()
  const { developerModeEnabled } = useDeveloperMode()
  const [sorting, setSorting] = React.useState<SortingState>([
    { id: "name", desc: false },
  ])
  const [columnFilters, setColumnFilters] =
    React.useState<ColumnFiltersState>([])
  const [rowSelection, setRowSelection] = React.useState({})
  const [columnVisibility] = React.useState({ category: false })

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

  const columns: ColumnDef<VendorDirectoryCompany>[] = [
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
        const v = row.original
        const initials = v.name
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
            <div className="min-w-0 flex items-center gap-2">
              <span className="font-medium truncate">
                {v.name}
              </span>
              <Badge
                variant="secondary"
                className="shrink-0 text-[10px] px-1.5 py-0"
              >
                {v.category}
              </Badge>
            </div>
          </div>
        )
      },
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
      id: "contacts",
      header: "People",
      cell: ({ row }) => {
        const contacts = row.original.contacts
        const primary = contacts.find((contact) => contact.isPrimary)
        if (contacts.length === 0) {
          return <span className="text-muted-foreground/40">—</span>
        }
        return (
          <div className="flex flex-col">
            <span>{primary?.name ?? contacts[0]?.name}</span>
            <span className="text-xs text-muted-foreground">
              {contacts.length} {contacts.length === 1 ? "person" : "people"}
            </span>
          </div>
        )
      },
    },
    {
      accessorKey: "email",
      header: "Company email",
      cell: ({ row }) => {
        const email = row.original.email
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
      header: "Company phone",
      cell: ({ row }) => {
        const phone = row.original.phone
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
      id: "source",
      header: "Source",
      cell: ({ row }) => {
        const vendor = row.original
        const needsReview = vendor.syncStatus === "needs_sage_review"
        return (
          <div className="flex items-center gap-1.5">
            <Badge variant={needsReview ? "outline" : "secondary"}>
              {vendorSourceLabel(vendor)}
            </Badge>
            {needsReview && (
              <Badge variant="outline" className="text-amber-700">
                Review
              </Badge>
            )}
          </div>
        )
      },
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
  const visibleColumns = developerModeEnabled
    ? columns
    : columns.filter((column) => column.id !== "source")

  const table = useReactTable({
    data: [...vendors],
    columns: visibleColumns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onRowSelectionChange: setRowSelection,
    initialState: { pagination: { pageSize: 100 } },
    state: { sorting, columnFilters, rowSelection, columnVisibility },
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
    <SearchableCombobox
      value={
        (table.getColumn("category")?.getFilterValue() as string) ?? "all"
      }
      onValueChange={(v) =>
        table.getColumn("category")?.setFilterValue(v === "all" ? "" : v)
      }
      ariaLabel="Filter vendors by category"
      placeholder="All Categories"
      searchPlaceholder="Search categories..."
      className="h-8 flex-1 sm:w-[200px] sm:flex-none"
      options={[
        { value: "all", label: "All Categories" },
        ...categories.map((categoryOption) => ({
          value: categoryOption,
          label: categoryOption,
        })),
      ]}
    />
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
          <SearchableCombobox
            value={
              (table.getColumn("category")?.getFilterValue() as string) ??
              "all"
            }
            onValueChange={(v) =>
              table
                .getColumn("category")
                ?.setFilterValue(v === "all" ? "" : v)
            }
            ariaLabel="Filter vendors by category"
            placeholder="All Categories"
            searchPlaceholder="Search categories..."
            options={[
              { value: "all", label: "All Categories" },
              ...categories.map((categoryOption) => ({
                value: categoryOption,
                label: categoryOption,
              })),
            ]}
          />
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
                  <Avatar size="sm">
                    <AvatarFallback className="text-[10px]">
                      {v.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
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
                      {v.contacts.length > 0
                        ? `${v.contacts.length} ${v.contacts.length === 1 ? "person" : "people"}`
                        : "No contact people"}
                    </p>
                    {developerModeEnabled && (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {vendorSourceLabel(v)} · {vendorSyncLabel(v)}
                      </p>
                    )}
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
    <div className="flex flex-1 flex-col min-h-0 gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center shrink-0">
        <Input
          placeholder="Search vendors..."
          value={(table.getColumn("name")?.getFilterValue() as string) ?? ""}
          onChange={(e) =>
            table.getColumn("name")?.setFilterValue(e.target.value)
          }
          className="h-8 w-full sm:max-w-sm"
        />
        {categoryFilter}
      </div>
      <div className="rounded-md border flex-1 min-h-0 overflow-hidden">
        <div className="overflow-auto h-full">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
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
                    colSpan={visibleColumns.length}
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
