"use client"

import type * as React from "react"

import { deleteProjectRfi } from "@/app/actions/project-rfis"
import { ConfirmDeleteButton } from "@/components/shared/confirm-delete-button"

export function ProjectRfiDeleteButton({
  projectId,
  rfiId,
  rfiNumber,
  subject,
}: {
  readonly projectId: string
  readonly rfiId: string
  readonly rfiNumber: string
  readonly subject: string
}): React.ReactElement {
  return (
    <ConfirmDeleteButton
      title="Delete this RFI?"
      description={
        <>
          This will remove {rfiNumber} and its attachment references from
          Compass. The subject is "{subject}". Any follow-up tasks created
          from this RFI will remain. This cannot be undone.
        </>
      }
      confirmLabel="Delete RFI"
      onDelete={() => deleteProjectRfi(projectId, rfiId)}
    />
  )
}
