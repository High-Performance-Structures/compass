"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { IconTrash } from "@tabler/icons-react"
import { toast } from "sonner"

import { dismissInboundSms, trashInboundSmsEvent } from "@/app/actions/inbound-sms-review"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"

export function TrashInboundSmsButton({
  eventId,
  senderPhone,
}: {
  readonly eventId: string
  readonly senderPhone: string
}): React.ReactElement {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [permissionMissing, setPermissionMissing] = React.useState(false)
  const [pending, startTransition] = React.useTransition()

  function trash(): void {
    setError(null)
    startTransition(async () => {
      const result = await trashInboundSmsEvent(eventId)
      if (result.success) {
        setOpen(false)
        toast.success("Conversation deleted from GoTo and removed from Compass.")
        router.refresh()
        return
      }
      setError(result.error)
      setPermissionMissing(result.gotoPermissionMissing)
    })
  }

  function dismissInstead(): void {
    startTransition(async () => {
      try {
        const formData = new FormData()
        formData.set("eventId", eventId)
        await dismissInboundSms(formData)
        setOpen(false)
        toast.success("Text dismissed from Compass. It's still in GoTo.")
        router.refresh()
      } catch (dismissError) {
        setError(dismissError instanceof Error ? dismissError.message : "Unable to dismiss the text.")
      }
    })
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return
        setOpen(next)
        if (!next) {
          setError(null)
          setPermissionMissing(false)
        }
      }}
    >
      <AlertDialogTrigger asChild>
        <Button type="button" variant="destructive">
          <IconTrash className="size-4" />
          Trash spam
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this GoTo conversation?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes the complete GoTo conversation with {senderPhone}
            and removes its pending messages from this desk. GoTo cannot restore it,
            and new texts from this number can still arrive.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <div role="alert" className="border-l-2 border-destructive pl-3 text-sm">
            <p className="text-destructive">{error}</p>
            {permissionMissing ? (
              <p className="mt-1 text-muted-foreground">
                You can dismiss the text from Compass now. It stays in GoTo until
                an admin gives the GoTo connection delete permission.
              </p>
            ) : null}
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Keep conversation</AlertDialogCancel>
          {permissionMissing ? (
            <Button type="button" variant="outline" disabled={pending} onClick={dismissInstead}>
              Dismiss from Compass instead
            </Button>
          ) : (
            <Button type="button" variant="destructive" disabled={pending} onClick={trash}>
              {pending ? "Deleting…" : error ? "Try again" : "Delete from GoTo"}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
