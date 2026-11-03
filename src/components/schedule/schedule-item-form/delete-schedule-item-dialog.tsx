"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { deleteScheduleTasks } from "@/app/actions/schedule-tasks"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import type { ScheduleTaskData } from "@/lib/schedule/types"

/** Confirms and deletes the item being edited. */
export function DeleteScheduleItemDialog({
  open: confirmDeleteOpen,
  onOpenChange: setConfirmDeleteOpen,
  editingTask,
  onDeletedItem,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly editingTask: ScheduleTaskData | null
  /** Closes the item dialog and reports the deleted item. */
  readonly onDeletedItem: (taskId: string) => void
}) {
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)

  // Same action, confirmation and dependency cleanup as the List view delete.
  async function confirmDelete(): Promise<void> {
    if (!editingTask) return
    setDeleting(true)
    const result = await deleteScheduleTasks(editingTask.projectId, [editingTask.id])
    setDeleting(false)
    if (!result.success) {
      toast.error(result.error)
      return
    }
    setConfirmDeleteOpen(false)
    onDeletedItem(editingTask.id)
    toast.success("Schedule item deleted.")
    router.refresh()
  }

  return (
    <AlertDialog
      open={confirmDeleteOpen}
      onOpenChange={(next) => {
        if (!deleting) setConfirmDeleteOpen(next)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this schedule item?</AlertDialogTitle>
          <AlertDialogDescription>
            This also removes dependencies connected to the deleted item. This
            action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Keep item</AlertDialogCancel>
          <AlertDialogAction disabled={deleting} onClick={confirmDelete}>
            {deleting ? "Deleting..." : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
