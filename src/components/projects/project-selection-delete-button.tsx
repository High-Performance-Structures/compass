"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { IconTrash } from "@tabler/icons-react"

import {
  deleteProjectSelection,
  type ProjectSelectionItem,
} from "@/app/actions/project-selections"
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

function canDeleteSelection(selection: ProjectSelectionItem): boolean {
  return !selection.ownerApproved && selection.status !== "approved"
}

export function ProjectSelectionDeleteButton({
  projectId,
  selection,
}: {
  readonly projectId: string
  readonly selection: ProjectSelectionItem
}): React.ReactElement | null {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [status, setStatus] = React.useState<DeleteStatus>({ kind: "idle" })

  if (!canDeleteSelection(selection)) return null

  async function deleteSelection(): Promise<void> {
    setStatus({ kind: "deleting" })
    const result = await deleteProjectSelection(projectId, selection.id)

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
          <AlertDialogTitle>Delete this selection?</AlertDialogTitle>
          <AlertDialogDescription>
            This will remove "{selection.name}" from the finish selections for{" "}
            {selection.roomName}. Approved selections cannot be deleted from
            this control. This cannot be undone.
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
              void deleteSelection()
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {status.kind === "deleting" ? "Deleting..." : "Delete selection"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

