"use client"

import Link from "next/link"
import { useState, useTransition } from "react"
import { IconBell, IconMail } from "@tabler/icons-react"
import { toast } from "sonner"

import {
  getOwnerDocumentNotificationRecipients,
  sendOwnerDocumentNotification,
  type OwnerNoticeRecipient,
} from "@/app/actions/owner-document-notices"
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
import { Button } from "@/components/ui/button"
import type { OwnerDocumentKind } from "@/lib/billing/owner-document-notices"

export function ownerDocumentEmailHref(projectId: string, kind: OwnerDocumentKind, documentId: string): string {
  const query = new URLSearchParams({ email: kind, documentId })
  return `/dashboard/projects/${encodeURIComponent(projectId)}/messages?${query.toString()}`
}

/** Create email (project email to the owner, PDF attached) and Send notification. */
export function OwnerDocumentNoticeActions({
  projectId,
  kind,
  documentId,
  documentLabel,
  size = "default",
}: {
  readonly projectId: string
  readonly kind: OwnerDocumentKind
  readonly documentId: string
  /** "pay application 1", "deposit request H-430-1900-DEP-1" */
  readonly documentLabel: string
  readonly size?: "default" | "sm"
}): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [recipients, setRecipients] = useState<readonly OwnerNoticeRecipient[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function openConfirmation(): void {
    setOpen(true)
    setRecipients(null)
    setLoadError(null)
    startTransition(async () => {
      const result = await getOwnerDocumentNotificationRecipients(projectId, kind, documentId)
      if (result.success) setRecipients(result.data)
      else setLoadError(result.error)
    })
  }

  function notify(): void {
    startTransition(async () => {
      const result = await sendOwnerDocumentNotification(projectId, kind, documentId)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      const people = result.notified === 1 ? "1 owner user" : `${result.notified} owner users`
      toast.success(`Notified ${people} about ${documentLabel}.`, {
        description: result.emailed > 0 ? `Emailed ${result.emailed} of them.` : "No notification email went out; they'll see it in Compass.",
      })
      setOpen(false)
    })
  }

  const noOne = recipients !== null && recipients.length === 0
  return (
    <>
      <Button variant="outline" size={size} asChild>
        <Link href={ownerDocumentEmailHref(projectId, kind, documentId)} prefetch={false}>
          <IconMail className="size-4" />
          Create email
        </Link>
      </Button>
      <Button variant="outline" size={size} onClick={openConfirmation} disabled={pending}>
        <IconBell className="size-4" />
        Send notification
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Notify the owner about {documentLabel}?</AlertDialogTitle>
            <AlertDialogDescription>
              {loadError
                ?? (recipients === null
                  ? "Finding the owner's Compass users…"
                  : noOne
                    ? "No one on the owner's side has Compass access to this project yet. Use Create email to send it to the owner's email instead."
                    : `${recipients.map((person) => `${person.name} (${person.email})`).join(", ")} will get a Compass notification and an email with a link to it in their portal.`)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending || recipients === null || noOne || loadError !== null}
              onClick={(event) => {
                event.preventDefault()
                notify()
              }}
            >
              Send notification
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
