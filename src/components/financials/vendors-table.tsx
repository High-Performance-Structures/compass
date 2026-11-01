"use client"

import * as React from "react"
import { IconDotsVertical } from "@tabler/icons-react"
import type { ColumnDef } from "@tanstack/react-table"

import { getVendorDirectoryPage, type VendorDirectoryPage } from "@/app/actions/contact-directory"
import type { VendorDirectoryRow } from "@/lib/domain/contacts/directory-page"
import type { RecordPageQuery } from "@/lib/record-page"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import { RecordSearchInput, RecordTable, recordSelectionColumn } from "@/components/record-table"
import { useServerRecordTable } from "@/components/use-server-record-table"

type VendorRowActions = {
  readonly onView?: (vendor: VendorDirectoryRow) => void
  readonly onEdit?: (vendor: VendorDirectoryRow) => void
  readonly onDelete?: (id: string) => void
  /** Opens the vendor's trade docs (W-9, certificates, agreement). */
  readonly onTradeDocs?: (vendor: VendorDirectoryRow) => void
  /** Opens the merge dialog with this vendor chosen and a search for the other. */
  readonly onMergeWith?: (vendor: VendorDirectoryRow) => void
}

type VendorsTableProps = VendorRowActions & {
  readonly categories: readonly string[]
  readonly initialPage: VendorDirectoryPage | null
  /** Bump to re-read the current page after a change. */
  readonly reloadToken: number
  readonly onSelectionChange?: (vendors: readonly VendorDirectoryRow[]) => void
  /** Bump to clear the selection (after a merge or project association). */
  readonly clearSelectionToken?: number
}

const ALL_CATEGORIES = "all"
const vendorRowId = (vendor: VendorDirectoryRow): string => vendor.id

function vendorSourceLabel(vendor: VendorDirectoryRow): string {
  if (vendor.sourceSystem.includes("sage")) return "Sage"
  if (vendor.sourceSystem === "buildertrend") return "BT only"
  return "Compass"
}

function Blank(): React.ReactElement {
  return <span className="text-muted-foreground/40">—</span>
}

function VendorMenu({ vendor, actions }: { readonly vendor: VendorDirectoryRow; readonly actions: VendorRowActions }): React.ReactElement {
  const { onView, onTradeDocs, onEdit, onMergeWith, onDelete } = actions
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="size-8 p-0">
          <span className="sr-only">Actions for {vendor.name}</span>
          <IconDotsVertical className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {onView && <DropdownMenuItem onClick={() => onView(vendor)}>View people</DropdownMenuItem>}
        {onTradeDocs && <DropdownMenuItem onClick={() => onTradeDocs(vendor)}>Trade docs</DropdownMenuItem>}
        {onEdit && <DropdownMenuItem onClick={() => onEdit(vendor)}>Edit</DropdownMenuItem>}
        {onMergeWith && <DropdownMenuItem onClick={() => onMergeWith(vendor)}>Merge with…</DropdownMenuItem>}
        {onDelete && (onEdit || onMergeWith) && <DropdownMenuSeparator />}
        {onDelete && (
          <DropdownMenuItem className="text-destructive" onClick={() => onDelete(vendor.id)}>
            Delete
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function vendorColumns(
  actions: VendorRowActions,
  tradeDocStatuses: VendorDirectoryPage["tradeDocStatuses"],
  options: { readonly selectable: boolean; readonly developerMode: boolean },
): ColumnDef<VendorDirectoryRow>[] {
  const open = actions.onView ?? actions.onEdit
  const hasActions = Boolean(actions.onView || actions.onEdit || actions.onDelete || actions.onTradeDocs || actions.onMergeWith)
  const columns: (ColumnDef<VendorDirectoryRow> | null)[] = [
    options.selectable ? recordSelectionColumn((vendor: VendorDirectoryRow) => vendor.name) : null,
    {
      id: "name",
      accessorFn: (vendor) => vendor.name,
      header: "Name",
      cell: ({ row }) => open ? (
        <button type="button" className="text-left font-medium hover:underline" onClick={() => open(row.original)}>
          {row.original.name}
        </button>
      ) : <span className="font-medium">{row.original.name}</span>,
    },
    {
      id: "category",
      accessorFn: (vendor) => vendor.category,
      header: "Category",
      cell: ({ row }) => <Badge variant="secondary">{row.original.category}</Badge>,
    },
    {
      id: "people",
      accessorFn: (vendor) => vendor.peopleCount,
      header: "People",
      cell: ({ row }) => row.original.peopleCount === 0 ? <Blank /> : (
        <div className="flex flex-col">
          <span>{row.original.primaryPersonName}</span>
          <span className="text-xs text-muted-foreground">
            {row.original.peopleCount} {row.original.peopleCount === 1 ? "person" : "people"}
          </span>
        </div>
      ),
    },
    tradeDocStatuses ? {
      id: "tradeDocs",
      header: "Trade docs",
      enableSorting: false,
      cell: ({ row }) => {
        const status = tradeDocStatuses[row.original.id]
        if (!status) return <Blank />
        const label = <TradeDocStatusBadge status={status} />
        if (!actions.onTradeDocs) return label
        const openDocs = actions.onTradeDocs
        return (
          <button
            type="button"
            className="rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => openDocs(row.original)}
          >
            {label}
          </button>
        )
      },
    } : null,
    {
      id: "email",
      accessorFn: (vendor) => vendor.primaryEmail || vendor.email,
      header: "Contact email",
      cell: ({ row }) => {
        const email = row.original.primaryEmail || row.original.email
        return email ? <a href={`mailto:${email}`} className="text-sm hover:underline">{email}</a> : <Blank />
      },
    },
    {
      id: "phone",
      accessorFn: (vendor) => vendor.phone,
      header: "Company phone",
      cell: ({ row }) => row.original.phone
        ? <a href={`tel:${row.original.phone}`} className="text-sm tabular-nums hover:underline">{row.original.phone}</a>
        : <Blank />,
    },
    options.developerMode ? {
      id: "source",
      header: "Source",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5">
          <Badge variant={row.original.syncStatus === "needs_sage_review" ? "outline" : "secondary"}>
            {vendorSourceLabel(row.original)}
          </Badge>
          {row.original.syncStatus === "needs_sage_review" && <Badge variant="outline" className="text-warning">Review</Badge>}
        </div>
      ),
    } : null,
    hasActions ? {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      enableSorting: false,
      size: 48,
      cell: ({ row }) => <VendorMenu vendor={row.original} actions={actions} />,
    } : null,
  ]
  return columns.filter((column): column is ColumnDef<VendorDirectoryRow> => column !== null)
}

/** Vendors, searched, sorted and paged on the server (one page in the browser). */
export function VendorsTable({
  categories,
  initialPage,
  reloadToken,
  onSelectionChange,
  clearSelectionToken = 0,
  onView,
  onEdit,
  onDelete,
  onTradeDocs,
  onMergeWith,
}: VendorsTableProps): React.ReactElement {
  const { developerModeEnabled } = useDeveloperMode()
  const [category, setCategory] = React.useState(ALL_CATEGORIES)
  const [tradeDocStatuses, setTradeDocStatuses] = React.useState(initialPage?.tradeDocStatuses ?? null)
  const selectable = onSelectionChange !== undefined
  const columns = React.useMemo(
    () => vendorColumns({ onView, onEdit, onDelete, onTradeDocs, onMergeWith }, tradeDocStatuses, { selectable, developerMode: developerModeEnabled }),
    [onView, onEdit, onDelete, onTradeDocs, onMergeWith, tradeDocStatuses, selectable, developerModeEnabled],
  )
  const load = React.useCallback(
    (query: RecordPageQuery) => getVendorDirectoryPage(query, category === ALL_CATEGORIES ? null : category),
    [category],
  )
  const list = useServerRecordTable({
    columns,
    getRowId: vendorRowId,
    load,
    filterKey: category,
    reloadToken,
    initialPage,
    enableSelection: selectable,
  })
  const { page, selectedRows, clearSelection } = list
  React.useEffect(() => {
    if (page) setTradeDocStatuses(page.tradeDocStatuses)
  }, [page])
  React.useEffect(() => { onSelectionChange?.(selectedRows) }, [selectedRows, onSelectionChange])
  React.useEffect(() => { if (clearSelectionToken > 0) clearSelection() }, [clearSelectionToken, clearSelection])

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <RecordSearchInput
          value={list.search}
          onChange={list.setSearch}
          label="Search vendors"
          placeholder="Search company, person, email or phone…"
          className="sm:max-w-md"
        />
        <SearchableCombobox
          value={category}
          onValueChange={(value) => setCategory(value || ALL_CATEGORIES)}
          ariaLabel="Filter vendors by category"
          placeholder="All Categories"
          searchPlaceholder="Search categories..."
          className="h-8 sm:w-[200px]"
          options={[
            { value: ALL_CATEGORIES, label: "All Categories" },
            ...categories.map((option) => ({ value: option, label: option })),
          ]}
        />
      </div>
      <RecordTable
        table={list.table}
        itemLabel="vendors"
        emptyMessage={list.search ? "No vendors match this search." : "No vendors yet."}
        state={list.state}
        rowIdPrefix="vendor"
      />
    </div>
  )
}
