"use client"

import * as React from "react"
import Link from "next/link"
import {
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table"

import { DataTablePagination, DEFAULT_TABLE_PAGE_SIZE } from "@/components/data-table-pagination"
import { Input } from "@/components/ui/input"
import { TanstackSortableHeader } from "@/components/ui/sortable-header"
import type { UnassignedPerson } from "@/lib/domain/contacts/unassigned-people"
import { projectNumberAndName } from "@/lib/project-display-name"

/**
 * People added from imported messages who are not connected to a vendor or
 * customer yet. Staff open the project's contacts to connect each person to
 * the company they work for.
 */
export function UnassignedPeopleTable({ people }: { readonly people: readonly UnassignedPerson[] }): React.ReactElement {
  const [pagination, setPagination] = React.useState({ pageIndex: 0, pageSize: DEFAULT_TABLE_PAGE_SIZE })
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [search, setSearch] = React.useState("")

  const columns = React.useMemo<ColumnDef<UnassignedPerson>[]>(
    () => [
      { id: "name", header: "Name", accessorFn: (person) => person.name },
      { id: "email", header: "Email", accessorFn: (person) => person.email ?? "", sortUndefined: "last" },
      { id: "projects", header: "Projects", accessorFn: (person) => person.projects.map((project) => project.projectName).join(", ") },
    ],
    []
  )

  const table = useReactTable({
    data: [...people],
    columns,
    getRowId: (person) => person.identity,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    globalFilterFn: "includesString",
    autoResetPageIndex: false,
    onPaginationChange: setPagination,
    onSortingChange: setSorting,
    onGlobalFilterChange: setSearch,
    state: { pagination, sorting, globalFilter: search },
  })

  if (people.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center">
        <p className="text-muted-foreground">Everyone is connected to a company</p>
        <p className="mt-1 text-sm text-muted-foreground/70">
          People added from imported messages appear here until they are connected to a vendor or customer.
        </p>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <Input
        value={search}
        onChange={(event) => {
          setSearch(event.target.value)
          setPagination((current) => ({ ...current, pageIndex: 0 }))
        }}
        placeholder="Search unassigned people"
        aria-label="Search unassigned people"
        className="h-9 max-w-sm"
      />
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
              const person = row.original
              return (
                <tr key={person.identity} className="border-b last:border-b-0">
                  <td className="px-3 py-2 font-medium">{person.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {person.email ? <a href={`mailto:${person.email}`} className="hover:underline">{person.email}</a> : "No email"}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col gap-0.5">
                      {person.projects.map((project) => (
                        <Link key={project.contactId} href={`/dashboard/projects/${encodeURIComponent(project.projectId)}/contacts`} className="hover:underline">
                          {projectNumberAndName({ projectNumber: project.projectNumber, name: project.projectName }, " - ")}
                        </Link>
                      ))}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <DataTablePagination table={table} itemLabel="unassigned people" id="unassigned-people-items-per-page" />
    </div>
  )
}
