"use client"

import * as React from "react"
import { toast } from "sonner"

import { getInternalDirectoryContacts, type InternalDirectoryContact } from "@/app/actions/vendors"
import { InternalContactsTable } from "@/components/contacts/internal-contacts-table"

/** The Internal tab: active people, or archived ones on request. */
export function InternalContactsPanel({
  contacts,
  canEdit,
  canArchive,
  onChanged,
  onSageEdit,
  onSageLink,
}: {
  readonly contacts: readonly InternalDirectoryContact[]
  readonly canEdit: boolean
  readonly canArchive: boolean
  /** Re-reads the active list and counts. */
  readonly onChanged: () => void
  readonly onSageEdit?: (contact: InternalDirectoryContact) => void
  readonly onSageLink?: (contact: InternalDirectoryContact) => void
}): React.ReactElement {
  const [showArchived, setShowArchived] = React.useState(false)
  const [archived, setArchived] = React.useState<readonly InternalDirectoryContact[]>([])

  const loadArchived = React.useCallback(async () => {
    try {
      setArchived(await getInternalDirectoryContacts({ archived: true }))
    } catch {
      toast.error("Could not load archived internal contacts")
    }
  }, [])

  return (
    <InternalContactsTable
      contacts={showArchived ? archived : contacts}
      showArchived={showArchived}
      canEdit={canEdit}
      canArchive={canArchive}
      onShowArchivedChange={(next) => {
        setShowArchived(next)
        if (next) void loadArchived()
      }}
      onChanged={() => {
        onChanged()
        if (showArchived) void loadArchived()
      }}
      onSageEdit={showArchived ? undefined : onSageEdit}
      onSageLink={showArchived ? undefined : onSageLink}
    />
  )
}
