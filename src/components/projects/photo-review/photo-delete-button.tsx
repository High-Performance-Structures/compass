"use client"

import * as React from "react"
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
import { Button, buttonVariants } from "@/components/ui/button"

/** Delete for the selected photos, behind a confirmation that names the count. */
export function PhotoDeleteButton({
  selectedCount,
  disabled,
  onConfirm,
}: {
  readonly selectedCount: number
  readonly disabled: boolean
  readonly onConfirm: () => void
}): React.ReactElement {
  const photos = `${selectedCount} photo${selectedCount === 1 ? "" : "s"}`
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="ghost" className="text-destructive" disabled={disabled || selectedCount === 0}>
          <IconTrash className="size-4" />
          Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {photos}?</AlertDialogTitle>
          <AlertDialogDescription>
            {selectedCount === 1 ? "It is" : "They are"} removed from this project&apos;s photos, along with any
            hidden duplicate copies, and the files go to the Google Drive trash. Photos shown in a client update
            or social post are kept. Activity keeps a record of the delete.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep photos</AlertDialogCancel>
          <AlertDialogAction className={buttonVariants({ variant: "destructive" })} onClick={onConfirm}>
            Delete {photos}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
