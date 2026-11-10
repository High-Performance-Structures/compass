"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { IconTrash } from "@tabler/icons-react"

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

/**
 * The standard "Delete" button for one record on a project page: an outline
 * Delete button that opens a confirmation, runs `onDelete` (a server action),
 * shows its error in the dialog if it fails, and refreshes the page if it
 * succeeds. Used by the P.O., RFQ, RFI and selection delete buttons; each one
 * only supplies its wording and the action to call.
 */
export function ConfirmDeleteButton({
  title,
  description,
  confirmLabel,
  onDelete,
}: {
  /** Dialog heading, such as "Delete this RFI?". */
  readonly title: string
  /** What is removed and what is kept; should end with "This cannot be undone." */
  readonly description: React.ReactNode
  /** The red button, such as "Delete RFI". */
  readonly confirmLabel: string
  readonly onDelete: () => Promise<{ success: true } | { success: false; error: string }>
}): React.ReactElement {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [status, setStatus] = React.useState<DeleteStatus>({ kind: "idle" })

  async function confirmDelete(): Promise<void> {
    setStatus({ kind: "deleting" })
    const result = await onDelete()

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
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
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
              // Keep the dialog open until the delete finishes (or fails).
              event.preventDefault()
              void confirmDelete()
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {status.kind === "deleting" ? "Deleting..." : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
