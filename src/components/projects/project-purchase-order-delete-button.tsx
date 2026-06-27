"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { IconTrash } from "@tabler/icons-react"

import { deletePurchaseOrderRequest } from "@/app/actions/project-operations"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"

type DeleteStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "deleting" }
  | { readonly kind: "error"; readonly message: string }

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
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [status, setStatus] = React.useState<DeleteStatus>({ kind: "idle" })

  async function deletePurchaseOrder(): Promise<void> {
    setStatus({ kind: "deleting" })
    const result = await deletePurchaseOrderRequest(projectId, purchaseOrderId)

    if (!result.success) {
      setStatus({ kind: "error", message: result.error })
      return
    }

    setStatus({ kind: "idle" })
    setOpen(false)
    router.refresh()
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (nextOpen) setStatus({ kind: "idle" })
      }}
    >
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <IconTrash className="size-4" />
          Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this P.O.?</AlertDialogTitle>
          <AlertDialogDescription>
            This will remove {poNumber ?? "this purchase order"} and its line
            items from Compass. The title is "{title}". Any follow-up tasks
            created from this P.O. will remain. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {status.kind === "error" && (
          <p className="border-l-2 border-l-destructive px-3 py-2 text-sm text-destructive">
            {status.message}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={status.kind === "deleting"}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={status.kind === "deleting"}
            onClick={(event) => {
              event.preventDefault()
              void deletePurchaseOrder()
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {status.kind === "deleting" ? "Deleting..." : "Delete P.O."}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

