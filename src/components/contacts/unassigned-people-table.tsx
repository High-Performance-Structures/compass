"use client"

import * as React from "react"
import Link from "next/link"
import type { ColumnDef } from "@tanstack/react-table"

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
import { Button } from "@/components/ui/button"
import { RecordSearchInput, RecordTable, useRecordTable } from "@/components/record-table"
import type { ConnectCompanyKind } from "@/lib/domain/contacts/connect-unassigned-person"
import type { UnassignedPerson } from "@/lib/domain/contacts/unassigned-people"
import { SIGN_IN_EMAIL_LOCK } from "@/lib/contact-sign-in-email"
import { projectNumberAndName } from "@/lib/project-display-name"
import { toast } from "sonner"

type EditKey = "name" | "email" | "phone" | "companyName"
function editFields(person: UnassignedPerson): readonly PersonEditField<EditKey>[] {
  return [
    { key: "name", label: "Name", required: true },
    // Someone who accepted an invitation signs in with this email, so only they change it.
    { key: "email", label: "Email", type: "email", lockedReason: person.hasAccount ? SIGN_IN_EMAIL_LOCK : null },
    { key: "phone", label: "Phone", type: "tel" },
    { key: "companyName", label: "Imported company" },
  ]
}

type UnassignedPersonActions = {
  readonly canEdit: boolean
  readonly canConnect: boolean
  readonly onEdit: (person: UnassignedPerson) => void
  readonly onConnect: (person: UnassignedPerson) => void
  readonly onArchive: (person: UnassignedPerson) => void
}

function projectLabel(project: UnassignedPerson["projects"][number]): string {
  return projectNumberAndName({ projectNumber: project.projectNumber, name: project.projectName }, " - ")
}

/** The unassigned people sheet's columns ("contacts.unassigned" in the list sheet registry). */
export function unassignedPeopleColumns(actions: UnassignedPersonActions): ColumnDef<UnassignedPerson>[] {
  const { canEdit, canConnect, onEdit, onConnect, onArchive } = actions
  const open = canEdit ? onEdit : canConnect ? onConnect : null
  const columns: (ColumnDef<UnassignedPerson> | null)[] = [
    {
      id: "name",
      header: "Name",
      accessorFn: (person) => person.name,
      cell: ({ row }) =>
        open ? (
          <button type="button" className="text-left font-medium hover:underline" onClick={() => open(row.original)}>
            {row.original.name}
          </button>
        ) : (
          <span className="font-medium">{row.original.name}</span>
        ),
    },
    {
      id: "email",
      header: "Email",
      accessorFn: (person) => person.email ?? "",
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {row.original.email ? <a href={`mailto:${row.original.email}`} className="hover:underline">{row.original.email}</a> : "No email"}
        </span>
      ),
    },
    {
      id: "company",
      header: "Imported company",
      accessorFn: (person) => person.companyName ?? "",
      cell: ({ row }) => <span className="text-muted-foreground">{row.original.companyName ?? ""}</span>,
    },
    {
      id: "projects",
      header: "Projects",
      accessorFn: (person) => person.projects.map((project) => project.projectName).join(", "),
      cell: ({ row }) => (
        <div className="flex flex-col gap-0.5">
          {row.original.projects.map((project) => (
            <Link key={project.contactId} href={`/dashboard/projects/${encodeURIComponent(project.projectId)}/contacts`} className="hover:underline">
              {projectLabel(project)}
            </Link>
          ))}
        </div>
      ),
    },
    canEdit || canConnect
      ? {
          id: "actions",
          header: () => <span className="sr-only">Actions</span>,
          enableSorting: false,
          cell: ({ row }) => (
            <div className="flex flex-wrap justify-end gap-2">
              {canEdit ? (
                <Button type="button" variant="outline" size="sm" onClick={() => onEdit(row.original)}>
                  Edit
                </Button>
              ) : null}
              {canConnect ? (
                <Button type="button" variant="outline" size="sm" onClick={() => onConnect(row.original)}>
                  Connect to company…
                </Button>
              ) : null}
              {canEdit && !row.original.hasAccount ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => onArchive(row.original)}>
                  Archive
                </Button>
              ) : null}
            </div>
          ),
        }
      : null,
  ]
  return columns.filter((column): column is ColumnDef<UnassignedPerson> => column !== null)
}

function matchesSearch(person: UnassignedPerson, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return [person.name, person.email, person.phone, person.companyName, ...person.projects.map(projectLabel)]
    .some((value) => (value ?? "").toLowerCase().includes(needle))
}

const personRowId = (person: UnassignedPerson): string => person.identity

/**
 * People added from imported messages who are not connected to a vendor or
 * customer yet. Staff connect each person to the company they work for with
 * "Connect to company…", or open the project's contacts. Staff with
 * project-contact edit access edit their contact information here (except
 * the sign-in email of someone who accepted a Compass invitation) or archive
 * people who have not accepted one.
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

  const archive = async (): Promise<void> => {
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
  const [search, setSearch] = React.useState("")
  const canConnect = connectKinds.length > 0
  const columns = React.useMemo(
    () => unassignedPeopleColumns({ canEdit, canConnect, onEdit: setEditing, onConnect: setConnecting, onArchive: setArchiving }),
    [canEdit, canConnect],
  )
  const visible = React.useMemo(() => people.filter((person) => matchesSearch(person, search)), [people, search])
  const table = useRecordTable({
    data: visible,
    columns,
    getRowId: personRowId,
    resetKey: search,
    sheetId: "contacts.unassigned",
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
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <RecordSearchInput
        value={search}
        onChange={setSearch}
        label="Search unassigned people"
        placeholder="Search unassigned people"
        className="sm:max-w-sm"
      />
      <RecordTable
        table={table}
        itemLabel="unassigned people"
        emptyMessage="No unassigned people match this search."
        rowIdPrefix="unassigned-person"
        onRowOpen={canEdit ? setEditing : canConnect ? setConnecting : undefined}
      />
      {editing ? (
        <PersonEditDialog
          key={editing.identity}
          title={`Edit ${editing.name}`}
          description="Changes apply on every project this person appears on. Nobody is invited or emailed."
          fields={editFields(editing)}
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
