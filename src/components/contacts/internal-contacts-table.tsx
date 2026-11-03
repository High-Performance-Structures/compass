"use client"

import * as React from "react"
import {
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table"
import { TanstackSortableHeader } from "@/components/ui/sortable-header"
import type { InternalDirectoryContact } from "@/app/actions/vendors"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DataTablePagination,
  DEFAULT_TABLE_PAGE_SIZE,
} from "@/components/data-table-pagination"
import { useDeveloperMode } from "@/components/developer-mode-provider"

export function InternalContactsTable({
  contacts,
  onSageEdit,
  onSageLink,
}: {
  readonly contacts: readonly InternalDirectoryContact[]
  readonly onSageEdit?: (contact: InternalDirectoryContact) => void
  readonly onSageLink?: (contact: InternalDirectoryContact) => void
}): React.ReactElement {
  const { developerModeEnabled } = useDeveloperMode()
  const [pagination, setPagination] = React.useState({
    pageIndex: 0,
    pageSize: DEFAULT_TABLE_PAGE_SIZE,
  })
  const [sorting, setSorting] = React.useState<SortingState>([])

  const columns = React.useMemo<ColumnDef<InternalDirectoryContact>[]>(
    () => [
      { id: "name", header: "Name", accessorFn: (contact) => contact.name },
      { id: "company", header: "Company", accessorFn: (contact) => contact.company ?? "Internal" },
      { id: "role", header: "Role", accessorFn: (contact) => contact.role ?? "Internal" },
      { id: "email", header: "Email", accessorFn: (contact) => contact.email ?? "", sortUndefined: "last" },
      { id: "phone", header: "Phone", accessorFn: (contact) => contact.phone ?? contact.cellPhone ?? "" },
      { id: "access", header: "Compass access", accessorFn: (contact) => contact.accessStatus },
      ...(developerModeEnabled ? [{ id: "source", header: "Source", accessorFn: (contact: InternalDirectoryContact) => contact.sourceLabel }] : []),
      ...(onSageEdit || onSageLink ? [{ id: "actions", header: "Actions", enableSorting: false }] : []),
    ],
    [developerModeEnabled, onSageEdit, onSageLink]
  )

  const table = useReactTable({
    data: [...contacts],
    columns,
    getRowId: (contact) => contact.id,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    autoResetPageIndex: false,
    onPaginationChange: setPagination,
    onSortingChange: setSorting,
    state: { pagination, sorting },
  })

  if (contacts.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center">
        <p className="text-muted-foreground">No internal contacts yet</p>
        <p className="mt-1 text-sm text-muted-foreground/70">
          Import or assign employees to projects.
        </p>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="min-h-0 flex-1 overflow-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/80 text-xs text-muted-foreground backdrop-blur">
            <tr className="border-b">
              {table.getHeaderGroups()[0]?.headers.map((header) => (
                <th key={header.id} className="px-3 py-2 text-left font-medium" aria-sort={header.column.getIsSorted() === "asc" ? "ascending" : header.column.getIsSorted() === "desc" ? "descending" : undefined}>
                  <TanstackSortableHeader header={header} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => {
              const contact = row.original
              return (
                <tr key={contact.id} className="border-b last:border-b-0">
                  <td className="px-3 py-2 font-medium">{contact.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {contact.company ?? "Internal"}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant="secondary">{contact.role ?? "Internal"}</Badge>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    <div className="flex flex-col gap-0.5">
                      {contact.email ? (
                        <a href={`mailto:${contact.email}`} className="hover:underline">
                          {contact.email}
                        </a>
                      ) : (
                        <span>No email</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    <div className="flex flex-col gap-0.5 whitespace-nowrap">
                      {contact.phone ? (
                        <a href={`tel:${contact.phone}`} className="hover:underline">
                          {contact.phone}
                        </a>
                      ) : null}
                      {contact.cellPhone ? (
                        <a href={`tel:${contact.cellPhone}`} className="hover:underline">
                          Mobile: {contact.cellPhone}
                        </a>
                      ) : null}
                      {!contact.phone && !contact.cellPhone ? <span>—</span> : null}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant="outline">
                      {contact.accessStatus === "active"
                        ? "Active"
                        : contact.accessStatus === "invited"
                          ? "Invitation pending"
                          : "No account"}
                    </Badge>
                  </td>
                  {developerModeEnabled && (
                    <td className="px-3 py-2">
                      <Badge variant="outline">{contact.sourceLabel}</Badge>
                    </td>
                  )}
                  {onSageEdit || onSageLink ? (
                    <td className="px-3 py-2">
                      {contact.sageEmployeeId && onSageEdit ? (
                        <Button type="button" size="sm" variant="outline" onClick={() => onSageEdit(contact)}>
                          Propose Sage edit
                        </Button>
                      ) : null}
                      {!contact.sageEmployeeId && onSageLink ? (
                        <Button type="button" size="sm" variant="outline" onClick={() => onSageLink(contact)}>
                          Verify Sage link
                        </Button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <DataTablePagination
        table={table}
        itemLabel="internal contacts"
        id="internal-contacts-items-per-page"
      />
    </div>
  )
}
