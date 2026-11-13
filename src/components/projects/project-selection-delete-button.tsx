"use client"

import type * as React from "react"

import { deleteProjectSelection } from "@/app/actions/project-selections"
import { ConfirmDeleteButton } from "@/components/shared/confirm-delete-button"
import { selectionLock } from "@/lib/domain/selections/locks"
import type { ProjectSelectionItem } from "@/lib/domain/selections/types"

/** Approved, ordered and installed selections are part of the record, so they get no Delete button. */
function canDeleteSelection(selection: ProjectSelectionItem): boolean {
  return !selection.ownerApproved && selection.status !== "approved" && selectionLock(selection.status, false) === null
}

export function ProjectSelectionDeleteButton({
  projectId,
  selection,
}: {
  readonly projectId: string
  readonly selection: ProjectSelectionItem
}): React.ReactElement | null {
  if (!canDeleteSelection(selection)) return null

  return (
    <ConfirmDeleteButton
      title="Delete this selection?"
      description={
        <>
          This will remove "{selection.name}" from the finish selections for{" "}
          {selection.roomName}. Approved selections cannot be deleted from
          this control. This cannot be undone.
        </>
      }
      confirmLabel="Delete selection"
      onDelete={() => deleteProjectSelection(projectId, selection.id)}
    />
  )
}
