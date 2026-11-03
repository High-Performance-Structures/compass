"use client"

import * as React from "react"
import { IconDotsVertical } from "@tabler/icons-react"
import type { ColumnDef } from "@tanstack/react-table"

import { getCustomerDirectoryPage } from "@/app/actions/contact-directory"
import type { CustomerDirectoryRow } from "@/lib/domain/contacts/directory-page"
import type { RecordPage } from "@/lib/record-page"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { SourceTag } from "@/components/shared/source-tag"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useDeveloperMode } from "@/components/developer-mode-provider"
import { RecordSearchInput, RecordTable, recordSelectionColumn } from "@/components/record-table"
import { useServerRecordTable } from "@/components/use-server-record-table"

type CustomerRowActions = {
  readonly onEdit?: (customer: CustomerDirectoryRow) => void
  readonly onDelete?: (id: string) => void
  readonly onViewPeople?: (customer: CustomerDirectoryRow) => void
  /** Opens the merge dialog with this client chosen and a search for the other. */
  readonly onMergeWith?: (customer: CustomerDirectoryRow) => void
}

type CustomersTableProps = CustomerRowActions & {
  readonly initialPage: RecordPage<CustomerDirectoryRow> | null
  readonly reloadToken: number
  readonly onSelectionChange?: (customers: readonly CustomerDirectoryRow[]) => void
  readonly clearSelectionToken?: number
}

const customerRowId = (customer: CustomerDirectoryRow): string => customer.id

function Blank(): React.ReactElement {
  return <span className="text-muted-foreground/40">—</span>
}

function CustomerMenu({ customer, actions }: { readonly customer: CustomerDirectoryRow; readonly actions: CustomerRowActions }): React.ReactElement {
  const { onViewPeople, onEdit, onMergeWith, onDelete } = actions
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="size-8 p-0">
          <span className="sr-only">Actions for {customer.name}</span>
          <IconDotsVertical className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {onViewPeople && <DropdownMenuItem onClick={() => onViewPeople(customer)}>People at this client</DropdownMenuItem>}
        {onEdit && <DropdownMenuItem onClick={() => onEdit(customer)}>Edit</DropdownMenuItem>}
        {onMergeWith && <DropdownMenuItem onClick={() => onMergeWith(customer)}>Merge with…</DropdownMenuItem>}
        {onDelete && (onEdit || onMergeWith) && <DropdownMenuSeparator />}
        {onDelete && (
          <DropdownMenuItem className="text-destructive" onClick={() => onDelete(customer.id)}>
            Delete
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function CustomerSource({ customer }: { readonly customer: CustomerDirectoryRow }): React.ReactElement {
  const sageLinked = Boolean(customer.sageClientId)
  const sageCandidate = !sageLinked && Boolean(customer.sageClientNumber)
  const buildertrend = Boolean(customer.buildertrendContactId)
  return (
    <div className="flex flex-wrap gap-1">
      {sageLinked ? <Badge variant="outline">Sage{customer.sageClientNumber ? ` #${customer.sageClientNumber}` : ""}</Badge> : null}
      {sageCandidate ? <Badge variant="outline">Sage candidate #{customer.sageClientNumber}</Badge> : null}
      {buildertrend ? <SourceTag source="buildertrend" /> : null}
      {!sageLinked && !sageCandidate && !buildertrend ? <Badge variant="outline">Compass</Badge> : null}
    </div>
  )
}

function customerColumns(
  actions: CustomerRowActions,
  options: { readonly selectable: boolean; readonly developerMode: boolean },
): ColumnDef<CustomerDirectoryRow>[] {
  const open = actions.onViewPeople ?? actions.onEdit
  const hasActions = Boolean(actions.onEdit || actions.onDelete || actions.onViewPeople || actions.onMergeWith)
  const columns: (ColumnDef<CustomerDirectoryRow> | null)[] = [
    options.selectable ? recordSelectionColumn((customer: CustomerDirectoryRow) => customer.name) : null,
    {
      id: "name",
      accessorFn: (customer) => customer.name,
      header: "Name",
      cell: ({ row }) => (
        <div className="min-w-0">
          {open ? (
            <button type="button" className="block text-left font-medium hover:underline" onClick={() => open(row.original)}>
              {row.original.name}
            </button>
          ) : <span className="block font-medium">{row.original.name}</span>}
          {row.original.company ? <span className="block text-xs text-muted-foreground">{row.original.company}</span> : null}
        </div>
      ),
    },
    {
      id: "email",
      accessorFn: (customer) => customer.primaryEmail || customer.email,
      header: "Email",
      cell: ({ row }) => {
        const email = row.original.primaryEmail || row.original.email
        return email ? <a href={`mailto:${email}`} className="text-sm hover:underline">{email}</a> : <Blank />
      },
    },
    {
      id: "phone",
      accessorFn: (customer) => customer.phone,
      header: "Phone",
      cell: ({ row }) => row.original.phone
        ? <a href={`tel:${row.original.phone}`} className="text-sm tabular-nums hover:underline">{row.original.phone}</a>
        : <Blank />,
    },
    {
      id: "people",
      accessorFn: (customer) => customer.peopleCount,
      header: "People",
      cell: ({ row }) => row.original.peopleCount === 0 ? <Blank /> : (
        <span className="text-sm tabular-nums">{row.original.peopleCount}</span>
      ),
    },
    {
      id: "relationshipType",
      accessorFn: (customer) => customer.relationshipType,
      header: "Status",
      cell: ({ row }) => (
        <Badge variant={row.original.relationshipType === "lead" ? "secondary" : "outline"}>
          {row.original.relationshipType === "lead" ? "Lead" : "Client"}
        </Badge>
      ),
    },
    options.developerMode ? {
      id: "source",
      header: "Source",
      enableSorting: false,
      cell: ({ row }) => <CustomerSource customer={row.original} />,
    } : null,
    {
      id: "createdAt",
      accessorFn: (customer) => customer.createdAt,
      header: "Added",
      cell: ({ row }) => (
        <span className="text-xs tabular-nums text-muted-foreground">
          {new Date(row.original.createdAt).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
        </span>
      ),
    },
    hasActions ? {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      enableSorting: false,
      size: 48,
      cell: ({ row }) => <CustomerMenu customer={row.original} actions={actions} />,
    } : null,
  ]
  return columns.filter((column): column is ColumnDef<CustomerDirectoryRow> => column !== null)
}

/** Clients and leads, searched, sorted and paged on the server. */
export function CustomersTable({
  initialPage,
  reloadToken,
  onSelectionChange,
  clearSelectionToken = 0,
  onEdit,
  onDelete,
  onViewPeople,
  onMergeWith,
}: CustomersTableProps): React.ReactElement {
  const { developerModeEnabled } = useDeveloperMode()
  const selectable = onSelectionChange !== undefined
  const columns = React.useMemo(
    () => customerColumns({ onEdit, onDelete, onViewPeople, onMergeWith }, { selectable, developerMode: developerModeEnabled }),
    [onEdit, onDelete, onViewPeople, onMergeWith, selectable, developerModeEnabled],
  )
  const list = useServerRecordTable({
    columns,
    getRowId: customerRowId,
    load: getCustomerDirectoryPage,
    reloadToken,
    initialPage,
    enableSelection: selectable,
  })
  const { selectedRows, clearSelection } = list
  React.useEffect(() => { onSelectionChange?.(selectedRows) }, [selectedRows, onSelectionChange])
  React.useEffect(() => { if (clearSelectionToken > 0) clearSelection() }, [clearSelectionToken, clearSelection])

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <RecordSearchInput
        value={list.search}
        onChange={list.setSearch}
        label="Search clients and leads"
        placeholder="Search name, company, person, email or phone…"
        className="sm:max-w-md"
      />
      <RecordTable
        table={list.table}
        itemLabel="clients and leads"
        emptyMessage={list.search ? "No clients or leads match this search." : "No client or lead contacts yet."}
        state={list.state}
        rowIdPrefix="customer"
      />
    </div>
  )
}
