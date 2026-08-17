"use client"

import { useState, useTransition } from "react"

import { deleteStaffMessageRecord } from "@/app/actions/staff-message-desk"
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

export type StaffMessageArchiveDialogProps = Readonly<{
  readonly recordId: string
}>

export function StaffMessageArchiveDialog({
  recordId,
}: StaffMessageArchiveDialogProps): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleConfirm(event: React.MouseEvent<HTMLButtonElement>): void {
    event.preventDefault()
    setError(null)
    const formData = new FormData()
    formData.set("recordId", recordId)
    formData.set("note", "Administrator archived this record from the active desk.")
    startTransition(() => {
      void deleteStaffMessageRecord(formData).then((result) => {
        if (result.success) {
          setOpen(false)
          return
        }
        setError(result.error)
      })
    })
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isPending) {
          setOpen(nextOpen)
          if (nextOpen) setError(null)
        }
      }}
    >
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline">
          Archive record
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Archive this staff message?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the record from the active desk. A linked GoTo text will
            return to the review queue so it can be relinked later.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Keep record</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} disabled={isPending}>
            {isPending ? "Archiving…" : "Archive record"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
