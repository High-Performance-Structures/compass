"use client"

import * as React from "react"
import { IconMail, IconLoader2, IconSend } from "@tabler/icons-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { sendProjectRfiEmail } from "@/app/actions/project-rfi-email"
import { EmailRecipientPicker } from "@/components/email/email-recipient-picker"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { EmailRecipientOption } from "@/lib/email/recipient-options"
import { defaultRfiEmailSubject } from "@/lib/rfis/email"

export function ProjectRfiCommunicationActions({
  projectId,
  rfiId,
  rfiNumber,
  rfiSubject,
  recipientOptions,
}: {
  readonly projectId: string
  readonly rfiId: string
  readonly rfiNumber: string
  readonly rfiSubject: string
  readonly recipientOptions: readonly EmailRecipientOption[]
}): React.ReactElement {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [to, setTo] = React.useState<readonly string[]>([])
  const [cc, setCc] = React.useState<readonly string[]>([])
  const [subject, setSubject] = React.useState("")
  const [message, setMessage] = React.useState("")
  const [sending, setSending] = React.useState(false)

  function openEmailDialog(): void {
    setTo(
      recipientOptions
        .filter((option) => option.recommended)
        .map((option) => option.email)
    )
    setCc([])
    setSubject(defaultRfiEmailSubject({ rfiNumber, subject: rfiSubject }))
    setMessage("")
    setOpen(true)
  }

  async function sendEmail(): Promise<void> {
    if (to.length === 0) {
      toast.error("Choose or enter at least one recipient.")
      return
    }

    setSending(true)
    const result = await sendProjectRfiEmail(projectId, rfiId, {
      to,
      cc,
      subject,
      message,
    })
    setSending(false)
    if (!result.success) {
      toast.error(result.error)
      return
    }

    setOpen(false)
    toast.success(`${rfiNumber} emailed. Replies will appear on this RFI.`)
    router.refresh()
  }

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={openEmailDialog}>
        <IconMail className="size-4" />
        Email
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Email {rfiNumber}</DialogTitle>
            <DialogDescription>
              Compass sends the RFI and its question. Replies come back to
              this RFI and to you. Use the response area on the RFI for
              Compass messages and @mentions.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <EmailRecipientPicker
              id={`rfi-email-to-${rfiId}`}
              label="To"
              options={recipientOptions}
              value={to}
              excludedEmails={cc}
              onChange={setTo}
              required
            />
            <EmailRecipientPicker
              id={`rfi-email-cc-${rfiId}`}
              label="Cc"
              options={recipientOptions}
              value={cc}
              excludedEmails={to}
              onChange={setCc}
              placeholder="Choose an optional contact..."
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`rfi-email-subject-${rfiId}`}>Subject</Label>
            <Input
              id={`rfi-email-subject-${rfiId}`}
              value={subject}
              maxLength={300}
              onChange={(event) => setSubject(event.currentTarget.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`rfi-email-message-${rfiId}`}>Note (optional)</Label>
            <Textarea
              id={`rfi-email-message-${rfiId}`}
              value={message}
              rows={4}
              maxLength={10_000}
              placeholder="Added above the RFI question."
              onChange={(event) => setMessage(event.currentTarget.value)}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={sending || to.length === 0 || subject.trim().length === 0}
              onClick={() => void sendEmail()}
            >
              {sending ? (
                <IconLoader2 className="size-4 animate-spin" />
              ) : (
                <IconSend className="size-4" />
              )}
              Send email
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
