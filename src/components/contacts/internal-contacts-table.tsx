"use client"

import * as React from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { toast } from "sonner"
import {
  getInternalDirectoryPersonJobCount,
  setInternalDirectoryPersonArchived,
  updateInternalDirectoryPerson,
} from "@/app/actions/internal-people"
import { archivedPersonJobsNotice } from "@/lib/archived-person"
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
import { RecordSearchInput, RecordTable, useRecordTable } from "@/components/record-table"
import { useDeveloperMode } from "@/components/developer-mode-provider"
import { ViewAsButton } from "@/components/view-as/view-as-launcher"
import { SIGN_IN_EMAIL_LOCK } from "@/lib/contact-sign-in-email"

type EditKey = "name" | "jobTitle" | "email" | "phone" | "cellPhone"
const SAGE_FIELD_LOCK = "Linked to Sage. Change it with Propose Sage edit."

function editFields(contact: InternalDirectoryContact): readonly PersonEditField<EditKey>[] {
  // A Sage-linked employee's email and phones are Sage's; name and title are Compass-only.
  const sageLock = contact.sageEmployeeId || contact.sageEmployeeNumber ? SAGE_FIELD_LOCK : null
  // Someone who accepted their invitation signs in with this email, so only they change it.
  const emailLock = sageLock ?? (contact.accountHolder ? SIGN_IN_EMAIL_LOCK : null)
  return [
    { key: "name", label: "Name", required: true },
    { key: "jobTitle", label: "Job title" },
    { key: "email", label: "Email", type: "email", lockedReason: emailLock },
    { key: "phone", label: "Phone", type: "tel", lockedReason: sageLock },
    { key: "cellPhone", label: "Mobile", type: "tel", lockedReason: sageLock },
  ]
}

function accessLabel(status: InternalDirectoryContact["accessStatus"]): string {
  if (status === "active") return "Active"
  if (status === "invited") return "Invitation pending"
  return "No account"
}

type InternalContactActions = {
  readonly canEdit: boolean
  readonly canArchive: boolean
  readonly busy: boolean
  readonly onEdit: (contact: InternalDirectoryContact) => void
  readonly onArchive: (contact: InternalDirectoryContact) => void
  readonly onRestore: (contact: InternalDirectoryContact) => void
  readonly onSageEdit?: (contact: InternalDirectoryContact) => void
  readonly onSageLink?: (contact: InternalDirectoryContact) => void
}

function InternalContactButtons({
  contact,
  actions,
}: {
  readonly contact: InternalDirectoryContact
  readonly actions: InternalContactActions
}): React.ReactElement {
  const { canEdit, canArchive, busy, onEdit, onArchive, onRestore, onSageEdit, onSageLink } = actions
  return (
    <div className="flex flex-wrap gap-2">
      {canEdit ? (
        <Button type="button" size="sm" variant="outline" onClick={() => onEdit(contact)}>
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
        <Button type="button" size="sm" variant="ghost" onClick={() => onArchive(contact)}>
          Archive
        </Button>
      ) : null}
      <ViewAsButton userId={contact.active ? contact.userId : null} />
      {canArchive && !contact.active ? (
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => onRestore(contact)}>
          Restore
        </Button>
      ) : null}
    </div>
  )
}

/** The staff directory sheet's columns ("contacts.internal" in the list sheet registry). */
export function internalContactColumns(
  actions: InternalContactActions,
  options: { readonly developerMode: boolean; readonly hasActions: boolean },
): ColumnDef<InternalDirectoryContact>[] {
  const columns: (ColumnDef<InternalDirectoryContact> | null)[] = [
    {
      id: "name",
      header: "Name",
      accessorFn: (contact) => contact.name,
      cell: ({ row }) =>
        actions.canEdit ? (
          <button type="button" className="text-left font-medium hover:underline" onClick={() => actions.onEdit(row.original)}>
            {row.original.name}
          </button>
        ) : (
          <span className="font-medium">{row.original.name}</span>
        ),
    },
    {
      id: "company",
      header: "Company",
      accessorFn: (contact) => contact.company ?? "Internal",
      cell: ({ row }) => <span className="text-muted-foreground">{row.original.company ?? "Internal"}</span>,
    },
    {
      id: "role",
      header: "Role",
      accessorFn: (contact) => contact.role ?? "Internal",
      cell: ({ row }) => <Badge variant="secondary">{row.original.role ?? "Internal"}</Badge>,
    },
    {
      id: "email",
      header: "Email",
      accessorFn: (contact) => contact.email ?? "",
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {row.original.email ? (
            <a href={`mailto:${row.original.email}`} className="hover:underline">
              {row.original.email}
            </a>
          ) : (
            "No email"
          )}
        </span>
      ),
    },
    {
      id: "phone",
      header: "Phone",
      accessorFn: (contact) => contact.phone ?? contact.cellPhone ?? "",
      cell: ({ row }) => {
        const contact = row.original
        return (
          <div className="flex flex-col gap-0.5 whitespace-nowrap text-muted-foreground">
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
        )
      },
    },
    {
      id: "access",
      header: "Compass access",
      accessorFn: (contact) => accessLabel(contact.accessStatus),
      cell: ({ row }) => <Badge variant="outline">{accessLabel(row.original.accessStatus)}</Badge>,
    },
    options.developerMode
      ? {
          id: "source",
          header: "Source",
          accessorFn: (contact) => contact.sourceLabel,
          cell: ({ row }) => <Badge variant="outline">{row.original.sourceLabel}</Badge>,
        }
      : null,
    options.hasActions
      ? {
          id: "actions",
          header: "Actions",
          enableSorting: false,
          cell: ({ row }) => <InternalContactButtons contact={row.original} actions={actions} />,
        }
      : null,
  ]
  return columns.filter((column): column is ColumnDef<InternalDirectoryContact> => column !== null)
}

function matchesSearch(contact: InternalDirectoryContact, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return [
    contact.name,
    contact.company ?? "Internal",
    contact.role ?? "Internal",
    contact.jobTitle,
    contact.email,
    contact.phone,
    contact.cellPhone,
    accessLabel(contact.accessStatus),
  ].some((value) => (value ?? "").toLowerCase().includes(needle))
}

const contactRowId = (contact: InternalDirectoryContact): string => contact.id

/**
 * Staff directory. Staff with edit access edit people's contact information
 * here (archived people too, such as those imported from Buildertrend). Once
 * a person accepts a Compass invitation, their sign-in email is theirs; every
 * other field stays editable.
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
  const [archivingJobCount, setArchivingJobCount] = React.useState<number | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [search, setSearch] = React.useState("")

  // The confirmation says how many jobs the person comes off.
  const archivingId = archiving?.id ?? null
  React.useEffect(() => {
    setArchivingJobCount(null)
    if (!archivingId) return
    let current = true
    void getInternalDirectoryPersonJobCount(archivingId).then((result) => {
      if (current && result.success) setArchivingJobCount(result.data.jobCount)
    })
    return () => {
      current = false
    }
  }, [archivingId])
  const hasActions = Boolean(onSageEdit || onSageLink || canEdit || canArchive)

  const setArchived = React.useCallback(async (contact: InternalDirectoryContact, archived: boolean): Promise<void> => {
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
  }, [onChanged])

  const columns = React.useMemo(
    () =>
      internalContactColumns(
        {
          canEdit,
          canArchive,
          busy,
          onEdit: setEditing,
          onArchive: setArchiving,
          onRestore: (contact) => void setArchived(contact, false),
          onSageEdit,
          onSageLink,
        },
        { developerMode: developerModeEnabled, hasActions },
      ),
    [canEdit, canArchive, busy, setArchived, onSageEdit, onSageLink, developerModeEnabled, hasActions],
  )
  const visible = React.useMemo(() => contacts.filter((contact) => matchesSearch(contact, search)), [contacts, search])
  const table = useRecordTable({
    data: visible,
    columns,
    getRowId: contactRowId,
    resetKey: `${showArchived ? "archived" : "active"}|${search}`,
    sheetId: "contacts.internal",
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
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <RecordSearchInput
          value={search}
          onChange={setSearch}
          label="Search internal contacts"
          placeholder="Search name, company, role, email or phone…"
          className="sm:max-w-sm"
        />
        {archivedToggle}
      </div>
      <RecordTable
        table={table}
        itemLabel="internal contacts"
        emptyMessage="No internal contacts match this search."
        rowIdPrefix="internal-contact"
        onRowOpen={canEdit ? setEditing : undefined}
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
              They leave the internal directory and people pickers. {archivedPersonJobsNotice(archivingJobCount)} Imported
              messages and Activity keep their name. You can restore them from Show archived people; restoring does not put
              them back on jobs.
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
