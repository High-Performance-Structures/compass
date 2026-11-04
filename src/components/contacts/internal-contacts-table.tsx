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
import { toast } from "sonner"
import { setInternalDirectoryPersonArchived, updateInternalDirectoryPerson } from "@/app/actions/internal-people"
import type { InternalDirectoryContact } from "@/app/actions/vendors"
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DataTablePagination,
  DEFAULT_TABLE_PAGE_SIZE,
} from "@/components/data-table-pagination"
import { useDeveloperMode } from "@/components/developer-mode-provider"

type EditKey = "name" | "jobTitle" | "email" | "phone" | "cellPhone"
const SAGE_FIELD_LOCK = "Linked to Sage. Change it with Propose Sage edit."

function editFields(contact: InternalDirectoryContact): readonly PersonEditField<EditKey>[] {
  // A Sage-linked employee's email and phones are Sage's; name and title are Compass-only.
  const sageLock = contact.sageEmployeeId || contact.sageEmployeeNumber ? SAGE_FIELD_LOCK : null
  return [
    { key: "name", label: "Name", required: true },
    { key: "jobTitle", label: "Job title" },
    { key: "email", label: "Email", type: "email", lockedReason: sageLock },
    { key: "phone", label: "Phone", type: "tel", lockedReason: sageLock },
    { key: "cellPhone", label: "Mobile", type: "tel", lockedReason: sageLock },
  ]
}

/**
 * Staff directory. Until a person accepts a Compass invitation, staff with
 * edit access edit their contact information here (archived people too, such
 * as those imported from Buildertrend); after that the person owns it.
 */
export function InternalContactsTable({
  contacts,
  showArchived = false,
  canEdit = false,
  canArchive = false,
  onShowArchivedChange,
  onChanged,
  onSageEdit,
  onSageLink,
}: {
  readonly contacts: readonly InternalDirectoryContact[]
  readonly showArchived?: boolean
  readonly canEdit?: boolean
  readonly canArchive?: boolean
  readonly onShowArchivedChange?: (showArchived: boolean) => void
  readonly onChanged?: () => void
  readonly onSageEdit?: (contact: InternalDirectoryContact) => void
  readonly onSageLink?: (contact: InternalDirectoryContact) => void
}): React.ReactElement {
  const { developerModeEnabled } = useDeveloperMode()
  const [editing, setEditing] = React.useState<InternalDirectoryContact | null>(null)
  const [archiving, setArchiving] = React.useState<InternalDirectoryContact | null>(null)
  const [busy, setBusy] = React.useState(false)
  const hasActions = Boolean(onSageEdit || onSageLink || canEdit || canArchive)

  const setArchived = async (contact: InternalDirectoryContact, archived: boolean) => {
    setBusy(true)
    try {
      const result = await setInternalDirectoryPersonArchived(contact.id, archived)
      if (!result.success) toast.error(result.error)
      else {
        toast.success(`${result.data.name} ${archived ? "archived" : "restored"}`)
        setArchiving(null)
        onChanged?.()
      }
    } finally {
      setBusy(false)
    }
  }
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
      ...(hasActions ? [{ id: "actions", header: "Actions", enableSorting: false }] : []),
    ],
    [developerModeEnabled, hasActions]
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

  const archivedToggle = onShowArchivedChange ? (
    <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => onShowArchivedChange(!showArchived)}>
      {showArchived ? "Show active people" : "Show archived people"}
    </Button>
  ) : null

  if (contacts.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        {archivedToggle}
        <div className="rounded-md border border-dashed p-8 text-center">
          <p className="text-muted-foreground">{showArchived ? "No archived internal contacts" : "No internal contacts yet"}</p>
          {showArchived ? null : (
            <p className="mt-1 text-sm text-muted-foreground/70">
              Import or assign employees to projects.
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {archivedToggle}
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
                  {hasActions ? (
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                      {canEdit && !contact.accountHolder ? (
                        <Button type="button" size="sm" variant="outline" onClick={() => setEditing(contact)}>
                          Edit
                        </Button>
                      ) : null}
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
                      {canArchive && contact.active && !contact.linkedToUser && !contact.sageEmployeeId && !contact.sageEmployeeNumber ? (
                        <Button type="button" size="sm" variant="ghost" onClick={() => setArchiving(contact)}>
                          Archive
                        </Button>
                      ) : null}
                      {canArchive && !contact.active ? (
                        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void setArchived(contact, false)}>
                          Restore
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
      <DataTablePagination
        table={table}
        itemLabel="internal contacts"
        id="internal-contacts-items-per-page"
      />
      {editing ? (
        <PersonEditDialog
          key={editing.id}
          title={`Edit ${editing.name}`}
          description="Saved in Compass only. Nobody is invited or emailed."
          fields={editFields(editing)}
          initial={{
            name: editing.name,
            jobTitle: editing.jobTitle ?? "",
            email: editing.email ?? "",
            phone: editing.phone ?? "",
            cellPhone: editing.cellPhone ?? "",
          }}
          open
          onOpenChange={(open) => { if (!open) setEditing(null) }}
          onSave={(values) => updateInternalDirectoryPerson({ personId: editing.id, ...values })}
          onSaved={() => onChanged?.()}
        />
      ) : null}
      <AlertDialog open={archiving !== null} onOpenChange={(open) => { if (!open) setArchiving(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {archiving?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              They leave the internal directory and people pickers. Project contacts and imported messages keep their name.
              You can restore them from Show archived people.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault()
                if (archiving) void setArchived(archiving, true)
              }}
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
