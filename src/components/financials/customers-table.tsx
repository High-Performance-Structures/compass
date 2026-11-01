"use client"

import * as React from "react"
import { IconDotsVertical } from "@tabler/icons-react"
import type { ColumnDef } from "@tanstack/react-table"

import type { Customer } from "@/db/schema"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { SourceTag } from "@/components/shared/source-tag"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useDeveloperMode } from "@/components/developer-mode-provider"
import { EntitySearchInput, EntityTable } from "@/components/financials/entity-table"
import { DirectorySortSelect } from "@/components/financials/directory-sort-select"
import { RecordsEmpty } from "@/components/financials/record-columns"

interface CustomersTableProps {
  customers: Customer[]
  onEdit?: (customer: Customer) => void
  onDelete?: (id: string) => void
  onViewPeople?: (customer: Customer) => void
  selectedIds?: readonly string[]
  onSelectionChange?: (ids: readonly string[]) => void
}

const EMPTY_SELECTION: readonly string[] = []
const INITIAL_SORTING = [{ id: "name", desc: false }]

function nameInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}

function CustomerMenu({
  customer,
  onEdit,
  onDelete,
  onViewPeople,
  mobile,
}: {
  readonly customer: Customer
  readonly onEdit?: (customer: Customer) => void
  readonly onDelete?: (id: string) => void
  readonly onViewPeople?: (customer: Customer) => void
  readonly mobile: boolean
}) {
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
        {onViewPeople && <DropdownMenuItem onClick={() => onViewPeople(customer)}>People at this client</DropdownMenuItem>}
        {onEdit && <DropdownMenuItem onClick={() => onEdit(customer)}>Edit</DropdownMenuItem>}
        {onEdit && onDelete && <DropdownMenuSeparator />}
        {onDelete && <DropdownMenuItem
          className="text-destructive"
          onClick={() => onDelete(customer.id)}
        >
          Delete
        </DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function CustomersTable({
  customers,
  onEdit,
  onDelete,
  onViewPeople,
  selectedIds = EMPTY_SELECTION,
  onSelectionChange,
}: CustomersTableProps) {
  const { developerModeEnabled } = useDeveloperMode()

  const columns = React.useMemo<ColumnDef<Customer>[]>(() => [
    {
      id: "select",
      header: ({ table }) => <Checkbox
        checked={table.getIsAllPageRowsSelected() ? true : table.getIsSomePageRowsSelected() ? "indeterminate" : false}
        onCheckedChange={(checked) => table.toggleAllPageRowsSelected(checked === true)}
        aria-label="Select all clients on this page"
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
        const c = row.original
        return (
          <div className="flex items-center gap-3">
            <Avatar size="sm">
              <AvatarFallback className="text-[10px]">
                {nameInitials(c.name)}
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
      header: "Phone",
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
        const isSageLinked = Boolean(customer.sageClientId)
        const isSageCandidate = !isSageLinked && Boolean(customer.sageClientNumber)
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
            {isSageCandidate ? (
              <Badge variant="outline">Sage candidate #{customer.sageClientNumber}</Badge>
            ) : null}
            {isBuildertrendLinked ? (
              <SourceTag source="buildertrend" />
            ) : null}
            {!isSageLinked && !isSageCandidate && !isBuildertrendLinked ? (
              <Badge variant="outline">Compass</Badge>
            ) : null}
          </div>
        )
      },
    },
    {
      accessorKey: "createdAt",
      header: "Added",
      cell: ({ row }) => (
        <span className="text-muted-foreground text-xs tabular-nums">
          {new Date(row.original.createdAt).toLocaleDateString("en-US", {
            month: "short",
            year: "numeric",
          })}
        </span>
      ),
    },
    {
      id: "actions",
      cell: ({ row }) => {
        if (!onEdit && !onDelete && !onViewPeople) return null
        return (
          <CustomerMenu
            customer={row.original}
            onEdit={onEdit}
            onDelete={onDelete}
            onViewPeople={onViewPeople}
            mobile={false}
          />
        )
      },
    },
  ], [onEdit, onDelete, onViewPeople])
  const visibleColumns = React.useMemo(() => columns.filter((column) =>
    (developerModeEnabled || column.id !== "source") &&
    (onSelectionChange !== undefined || column.id !== "select") &&
    (onEdit !== undefined || onDelete !== undefined || onViewPeople !== undefined || column.id !== "actions")
  ), [columns, developerModeEnabled, onEdit, onDelete, onViewPeople, onSelectionChange])

  return (
    <EntityTable
      data={customers}
      columns={visibleColumns}
      getRowId={(customer) => customer.id}
      initialSorting={INITIAL_SORTING}
      selection={{ selectedIds, onSelectionChange }}
      layout="fill"
      mobileToolbar={({ table, sorting, sortBy }) => (
        <>
          <EntitySearchInput
            table={table}
            columnId="name"
            placeholder="Search clients and leads..."
            className="w-full"
          />
          <DirectorySortSelect sorting={sorting} sortBy={sortBy} triggerClassName="w-[150px]" />
        </>
      )}
      desktopToolbar={({ table }) => (
        <EntitySearchInput
          table={table}
          columnId="name"
          placeholder="Search customers..."
          className="h-8 w-full sm:max-w-sm shrink-0"
        />
      )}
      mobileRow={(c) => (
        <>
          <Avatar size="sm">
            <AvatarFallback className="text-[10px]">
              {nameInitials(c.name)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">
              {c.name}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {[c.company, c.email, c.phone]
                .filter(Boolean)
                .join(" · ") || "No contact info"}
            </p>
          </div>
          {(onEdit || onDelete || onViewPeople) && (
            <CustomerMenu
              customer={c}
              onEdit={onEdit}
              onDelete={onDelete}
              onViewPeople={onViewPeople}
              mobile
            />
          )}
        </>
      )}
      mobileEmpty={
        <RecordsEmpty
          title="No client or lead contacts yet"
          hint="Add a contact to associate them with projects when ready."
        />
      }
      desktopEmpty="No customers found"
      itemLabel="contacts"
      paginationId="customers"
    />
  )
}
