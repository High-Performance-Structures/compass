"use client"

import type * as React from "react"

import { deleteRfqRequest } from "@/app/actions/project-operations"
import { ConfirmDeleteButton } from "@/components/shared/confirm-delete-button"

export function ProjectRfqDeleteButton({
  projectId,
  rfqId,
  rfqNumber,
  title,
}: {
  readonly projectId: string
  readonly rfqId: string
  readonly rfqNumber: string | null
  readonly title: string
}): React.ReactElement {
  return (
    <ConfirmDeleteButton
      title="Delete this RFQ?"
      description={
        <>
          This will remove {rfqNumber ?? "this RFQ"} from Compass. The RFQ
          title is "{title}". Any follow-up tasks created from this RFQ will
          remain. This cannot be undone.
        </>
      }
      confirmLabel="Delete RFQ"
      onDelete={() => deleteRfqRequest(projectId, rfqId)}
    />
  )
}
