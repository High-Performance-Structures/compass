"use client"

import type * as React from "react"

import { deletePurchaseOrderRequest } from "@/app/actions/project-purchase-orders"
import { ConfirmDeleteButton } from "@/components/shared/confirm-delete-button"

export function ProjectPurchaseOrderDeleteButton({
  poNumber,
  projectId,
  purchaseOrderId,
  title,
}: {
  readonly poNumber: string | null
  readonly projectId: string
  readonly purchaseOrderId: string
  readonly title: string
}): React.ReactElement {
  return (
    <ConfirmDeleteButton
      title="Delete this P.O.?"
      description={
        <>
          This will remove {poNumber ?? "this purchase order"} and its line
          items from Compass. The title is "{title}". Any follow-up tasks
          created from this P.O. will remain. This cannot be undone.
        </>
      }
      confirmLabel="Delete P.O."
      onDelete={() => deletePurchaseOrderRequest(projectId, purchaseOrderId)}
    />
  )
}
