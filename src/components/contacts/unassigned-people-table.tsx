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

import { archiveUnassignedPersonAction, editUnassignedPerson } from "@/app/actions/unassigned-people"
import { ConnectUnassignedDialog } from "@/components/contacts/connect-unassigned-dialog"
import { PersonEditDialog, type PersonEditField } from "@/components/contacts/person-edit-dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { DataTablePagination, DEFAULT_TABLE_PAGE_SIZE } from "@/components/data-table-pagination"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { TanstackSortableHeader } from "@/components/ui/sortable-header"
import type { ConnectCompanyKind } from "@/lib/domain/contacts/connect-unassigned-person"
import type { UnassignedPerson } from "@/lib/domain/contacts/unassigned-people"
import { projectNumberAndName } from "@/lib/project-display-name"
import { toast } from "sonner"

type EditKey = "name" | "email" | "phone" | "companyName"
const EDIT_FIELDS: readonly PersonEditField<EditKey>[] = [
  { key: "name", label: "Name", required: true },
  { key: "email", label: "Email", type: "email" },
  { key: "phone", label: "Phone", type: "tel" },
  { key: "companyName", label: "Imported company" },
]

/**
 * People added from imported messages who are not connected to a vendor or
 * customer yet. Staff connect each person to the company they work for with
 * "Connect to company…", or open the project's contacts. Until a person
 * accepts a Compass invitation, staff with project-contact edit access can
 * edit their contact information here or archive them.
 */
export function UnassignedPeopleTable({
  people,
  connectKinds,
  canEdit,
  onConnected,
  onChanged,
}: {
  readonly people: readonly UnassignedPerson[]
  /** The company kinds this user may connect people to; none hides the action. */
  readonly connectKinds: readonly ConnectCompanyKind[]
  readonly canEdit: boolean
  readonly onConnected: (identity: string, complete: boolean) => void
  /** Re-read the list after an edit or archive. */
  readonly onChanged: () => void
}): React.ReactElement {
  const [connecting, setConnecting] = React.useState<UnassignedPerson | null>(null)
  const [editing, setEditing] = React.useState<UnassignedPerson | null>(null)
  const [archiving, setArchiving] = React.useState<UnassignedPerson | null>(null)
  const [archiveBusy, setArchiveBusy] = React.useState(false)
  const showActions = connectKinds.length > 0 || canEdit

  const archive = async () => {
    if (!archiving) return
    setArchiveBusy(true)
    try {
      const result = await archiveUnassignedPersonAction(archiving.identity)
      if (!result.success) toast.error(result.error)
      else {
        toast.success(`${result.data.name} archived`)
        setArchiving(null)
        onChanged()
      }
    } finally {
      setArchiveBusy(false)
    }
  }
  const [pagination, setPagination] = React.useState({ pageIndex: 0, pageSize: DEFAULT_TABLE_PAGE_SIZE })
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [search, setSearch] = React.useState("")

  const columns = React.useMemo<ColumnDef<UnassignedPerson>[]>(
    () => [
      { id: "name", header: "Name", accessorFn: (person) => person.name },
      { id: "email", header: "Email", accessorFn: (person) => person.email ?? "", sortUndefined: "last" },
      { id: "company", header: "Imported company", accessorFn: (person) => person.companyName ?? "", sortUndefined: "last" },
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
              {showActions ? <th className="px-3 py-2 text-right font-medium"><span className="sr-only">Actions</span></th> : null}
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
                  <td className="px-3 py-2 text-muted-foreground">{person.companyName ?? ""}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col gap-0.5">
                      {person.projects.map((project) => (
                        <Link key={project.contactId} href={`/dashboard/projects/${encodeURIComponent(project.projectId)}/contacts`} className="hover:underline">
                          {projectNumberAndName({ projectNumber: project.projectNumber, name: project.projectName }, " - ")}
                        </Link>
                      ))}
                    </div>
                  </td>
                  {showActions ? (
                    <td className="px-3 py-2 text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        {canEdit ? (
                          <Button type="button" variant="outline" size="sm" onClick={() => setEditing(person)}>
                            Edit
                          </Button>
                        ) : null}
                        {connectKinds.length > 0 ? (
                          <Button type="button" variant="outline" size="sm" onClick={() => setConnecting(person)}>
                            Connect to company…
                          </Button>
                        ) : null}
                        {canEdit ? (
                          <Button type="button" variant="ghost" size="sm" onClick={() => setArchiving(person)}>
                            Archive
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  ) : null}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <DataTablePagination table={table} itemLabel="unassigned people" id="unassigned-people-items-per-page" />
      {editing ? (
        <PersonEditDialog
          key={editing.identity}
          title={`Edit ${editing.name}`}
          description="Changes apply on every project this person appears on. Nobody is invited or emailed."
          fields={EDIT_FIELDS}
          initial={{ name: editing.name, email: editing.email ?? "", phone: editing.phone ?? "", companyName: editing.companyName ?? "" }}
          open
          onOpenChange={(open) => { if (!open) setEditing(null) }}
          onSave={(values) => editUnassignedPerson({ identity: editing.identity, ...values })}
          onSaved={onChanged}
        />
      ) : null}
      <AlertDialog open={archiving !== null} onOpenChange={(open) => { if (!open) setArchiving(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {archiving?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              They are taken off the contacts of {archiving?.projects.length === 1 ? "1 project" : `${archiving?.projects.length ?? 0} projects`}.
              The record is kept, so imported messages still show who sent them, and the change is recorded in Activity.
              To bring them back, add them to the project again from its contacts.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={archiveBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={archiveBusy} onClick={(event) => { event.preventDefault(); void archive() }}>
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ConnectUnassignedDialog
        person={connecting}
        kinds={connectKinds}
        onOpenChange={(open) => { if (!open) setConnecting(null) }}
        onConnected={onConnected}
      />
    </div>
  )
}
