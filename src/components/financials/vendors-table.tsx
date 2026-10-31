"use client"

import * as React from "react"
import { IconDotsVertical } from "@tabler/icons-react"
import type { VendorDirectoryCompany } from "@/app/actions/vendors"
import type { ColumnDef, Table as TanstackTable } from "@tanstack/react-table"

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
import { SearchableCombobox } from "@/components/searchable-combobox"
import { useDeveloperMode } from "@/components/developer-mode-provider"
import { TradeDocStatusBadge } from "@/components/financials/trade-doc-status-badge"
import type { VendorTradeDocStatus } from "@/app/actions/vendor-trade-docs"
import {
  columnFilterText,
  EntitySearchInput,
  EntityTable,
} from "@/components/financials/entity-table"
import { DirectorySortSelect } from "@/components/financials/directory-sort-select"
import { RecordsEmpty } from "@/components/financials/record-columns"

interface VendorsTableProps {
  vendors: readonly VendorDirectoryCompany[]
  categories: readonly string[]
  onEdit?: (vendor: VendorDirectoryCompany) => void
  onDelete?: (id: string) => void
  onView?: (vendor: VendorDirectoryCompany) => void
  /** Opens the vendor's trade docs (W-9, certificates, agreement). */
  onTradeDocs?: (vendor: VendorDirectoryCompany) => void
  /** Trade doc standing by vendor id; vendors that need nothing are absent. */
  tradeDocStatuses?: Readonly<Record<string, VendorTradeDocStatus>>
  selectedIds?: readonly string[]
  onSelectionChange?: (ids: readonly string[]) => void
}

const EMPTY_SELECTION: readonly string[] = []
const INITIAL_SORTING = [{ id: "name", desc: false }]
const COLUMN_VISIBILITY = { category: false }

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

function nameInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}

function CategoryFilter({
  table,
  categories,
  className,
}: {
  readonly table: TanstackTable<VendorDirectoryCompany>
  readonly categories: readonly string[]
  readonly className?: string
}) {
  return (
    <SearchableCombobox
      value={columnFilterText(table, "category", "all")}
      onValueChange={(v) =>
        table.getColumn("category")?.setFilterValue(v === "all" ? "" : v)
      }
      ariaLabel="Filter vendors by category"
      placeholder="All Categories"
      searchPlaceholder="Search categories..."
      className={className}
      options={[
        { value: "all", label: "All Categories" },
        ...categories.map((categoryOption) => ({
          value: categoryOption,
          label: categoryOption,
        })),
      ]}
    />
  )
}

type VendorMenuProps = {
  readonly vendor: VendorDirectoryCompany
  readonly onEdit?: (vendor: VendorDirectoryCompany) => void
  readonly onDelete?: (id: string) => void
  readonly onView?: (vendor: VendorDirectoryCompany) => void
  readonly onTradeDocs?: (vendor: VendorDirectoryCompany) => void
  readonly mobile: boolean
}

function VendorMenu({ vendor, onEdit, onDelete, onView, onTradeDocs, mobile }: VendorMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {mobile ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
          >
            <IconDotsVertical className="size-4" />
          </Button>
        ) : (
          <Button variant="ghost" className="size-8 p-0">
            <span className="sr-only">open menu</span>
            <IconDotsVertical className="size-4" />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {onView && <DropdownMenuItem onClick={() => onView(vendor)}>View people</DropdownMenuItem>}
        {onTradeDocs && <DropdownMenuItem onClick={() => onTradeDocs(vendor)}>Trade docs</DropdownMenuItem>}
        {onEdit && <DropdownMenuItem onClick={() => onEdit(vendor)}>Edit</DropdownMenuItem>}
        {onEdit && onDelete && <DropdownMenuSeparator />}
        {onDelete && <DropdownMenuItem
          className="text-destructive"
          onClick={() => onDelete(vendor.id)}
        >
          Delete
        </DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function VendorsTable({
  vendors,
  categories,
  onEdit,
  onDelete,
  onView,
  onTradeDocs,
  tradeDocStatuses,
  selectedIds = EMPTY_SELECTION,
  onSelectionChange,
}: VendorsTableProps) {
  const { developerModeEnabled } = useDeveloperMode()

  const columns = React.useMemo<ColumnDef<VendorDirectoryCompany>[]>(() => [
    {
      id: "select",
      header: ({ table }) => <Checkbox
        checked={table.getIsAllPageRowsSelected() ? true : table.getIsSomePageRowsSelected() ? "indeterminate" : false}
        onCheckedChange={(checked) => table.toggleAllPageRowsSelected(checked === true)}
        aria-label="Select all vendors on this page"
      />,
      cell: ({ row }) => <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(checked) => row.toggleSelected(checked === true)}
        aria-label={`Select ${row.original.name}`}
      />,
      enableSorting: false,
      enableHiding: false,
    },
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => {
        const v = row.original
        return (
          <div className="flex items-center gap-3">
            <Avatar size="sm">
              <AvatarFallback className="text-[10px]">
                {nameInitials(v.name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex items-center gap-2">
              <span className="font-medium truncate">
                {v.name}
              </span>
              <Badge
                variant="secondary"
                className="shrink-0 text-xs px-1.5 py-0"
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
        <Badge variant="secondary">{row.original.category}</Badge>
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
      id: "tradeDocs",
      header: "Trade docs",
      cell: ({ row }) => {
        const status = tradeDocStatuses?.[row.original.id]
        if (!status) return <span className="text-muted-foreground/40">—</span>
        const label = <TradeDocStatusBadge status={status} />
        if (!onTradeDocs) return label
        return (
          <button
            type="button"
            className="rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={(event) => {
              event.stopPropagation()
              onTradeDocs(row.original)
            }}
          >
            {label}
          </button>
        )
      },
    },
    {
      id: "email",
      accessorFn: (vendor) => vendor.primaryEmail || vendor.email,
      header: "Contact email",
      cell: ({ row }) => {
        const email = row.original.primaryEmail || row.original.email
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
              <Badge variant="outline" className="text-warning">
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
        if (!onEdit && !onDelete && !onView && !onTradeDocs) return null
        return (
          <VendorMenu
            vendor={row.original}
            onEdit={onEdit}
            onDelete={onDelete}
            onView={onView}
            onTradeDocs={onTradeDocs}
            mobile={false}
          />
        )
      },
    },
  ], [onEdit, onDelete, onView, onTradeDocs, tradeDocStatuses])
  const visibleColumns = React.useMemo(() => columns.filter((column) =>
    (developerModeEnabled || column.id !== "source") &&
    (onSelectionChange !== undefined || column.id !== "select") &&
    (onEdit !== undefined || onDelete !== undefined || onView !== undefined || column.id !== "actions")
  ), [columns, developerModeEnabled, onEdit, onDelete, onView, onSelectionChange])

  return (
    <EntityTable
      data={vendors}
      columns={visibleColumns}
      getRowId={(vendor) => vendor.id}
      initialSorting={INITIAL_SORTING}
      columnVisibility={COLUMN_VISIBILITY}
      selection={{ selectedIds, onSelectionChange }}
      layout="fill"
      mobileToolbar={({ table, sorting, sortBy }) => (
        <>
          <EntitySearchInput
            table={table}
            columnId="name"
            placeholder="Search vendors..."
            className="w-full"
          />
          <div className="grid grid-cols-2 gap-2">
            <DirectorySortSelect sorting={sorting} sortBy={sortBy} />
            <CategoryFilter table={table} categories={categories} />
          </div>
        </>
      )}
      desktopToolbar={({ table }) => (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center shrink-0">
          <EntitySearchInput
            table={table}
            columnId="name"
            placeholder="Search vendors..."
            className="h-8 w-full sm:max-w-sm"
          />
          <CategoryFilter
            table={table}
            categories={categories}
            className="h-8 flex-1 sm:w-[200px] sm:flex-none"
          />
        </div>
      )}
      mobileRow={(v) => (
        <>
          <Avatar size="sm">
            <AvatarFallback className="text-[10px]">
              {nameInitials(v.name)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium truncate">
                {v.name}
              </p>
              <Badge
                variant="secondary"
                className="shrink-0 text-xs px-1.5 py-0"
              >
                {v.category}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground truncate">
              {v.contacts.length > 0
                ? `${v.contacts.length} ${v.contacts.length === 1 ? "person" : "people"}`
                : "No contact people"}
            </p>
            {tradeDocStatuses?.[v.id] && (
              <div className="mt-1"><TradeDocStatusBadge status={tradeDocStatuses[v.id]} /></div>
            )}
            {developerModeEnabled && (
              <p className="mt-1 text-xs text-muted-foreground">
                {vendorSourceLabel(v)} · {vendorSyncLabel(v)}
              </p>
            )}
          </div>
          {(onEdit || onDelete || onView || onTradeDocs) && (
            <VendorMenu
              vendor={v}
              onEdit={onEdit}
              onDelete={onDelete}
              onView={onView}
              onTradeDocs={onTradeDocs}
              mobile
            />
          )}
        </>
      )}
      mobileEmpty={
        <RecordsEmpty
          title="No vendors yet"
          hint="Add your first vendor to manage subcontractors, suppliers, and bills."
        />
      }
      desktopEmpty="No vendors found"
      itemLabel="vendors"
      paginationId="vendors"
    />
  )
}
