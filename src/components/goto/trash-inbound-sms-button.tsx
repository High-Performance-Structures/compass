"use client"

import { IconTrash } from "@tabler/icons-react"

import { trashInboundSms } from "@/app/actions/inbound-sms-review"
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

export function TrashInboundSmsButton({
  eventId,
  senderPhone,
}: {
  readonly eventId: string
  readonly senderPhone: string
}): React.ReactElement {
  return (
    <AlertDialog>
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
        <AlertDialogFooter>
          <AlertDialogCancel>Keep conversation</AlertDialogCancel>
          <form action={trashInboundSms}>
            <input type="hidden" name="eventId" value={eventId} />
            <AlertDialogAction asChild>
              <Button type="submit" variant="destructive">
                Delete from GoTo
              </Button>
            </AlertDialogAction>
          </form>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
