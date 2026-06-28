"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { IconTrash } from "@tabler/icons-react"

import { deleteRfqRequest } from "@/app/actions/project-operations"
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
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [status, setStatus] = React.useState<DeleteStatus>({ kind: "idle" })

  async function deleteRfq(): Promise<void> {
    setStatus({ kind: "deleting" })
    const result = await deleteRfqRequest(projectId, rfqId)

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
          <AlertDialogTitle>Delete this RFQ?</AlertDialogTitle>
          <AlertDialogDescription>
            This will remove {rfqNumber ?? "this RFQ"} from Compass. The RFQ
            title is "{title}". Any follow-up tasks created from this RFQ will
            remain. This cannot be undone.
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
              void deleteRfq()
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {status.kind === "deleting" ? "Deleting..." : "Delete RFQ"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
