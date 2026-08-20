"use client"

import * as React from "react"
import { IconMail, IconLoader2 } from "@tabler/icons-react"
import { toast } from "sonner"

import { createProjectRfiEmailDraft } from "@/app/actions/project-rfis"
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
import type { EmailRecipientOption } from "@/lib/email/recipient-options"

export function ProjectRfiCommunicationActions({
  projectId,
  rfiId,
  rfiNumber,
  recipientOptions,
}: {
  readonly projectId: string
  readonly rfiId: string
  readonly rfiNumber: string
  readonly recipientOptions: readonly EmailRecipientOption[]
}): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [to, setTo] = React.useState<readonly string[]>([])
  const [cc, setCc] = React.useState<readonly string[]>([])
  const [starting, setStarting] = React.useState(false)

  function openEmailDialog(): void {
    setTo(
      recipientOptions
        .filter((option) => option.recommended)
        .map((option) => option.email)
    )
    setCc([])
    setOpen(true)
  }

  async function openDefaultEmailApp(): Promise<void> {
    if (to.length === 0) {
      toast.error("Choose or enter at least one recipient.")
      return
    }

    setStarting(true)
    const result = await createProjectRfiEmailDraft(projectId, rfiId, {
      to,
      cc,
    })
    setStarting(false)
    if (!result.success) {
      toast.error(result.error)
      return
    }

    setOpen(false)
    toast.info(
      "Keep Compass in CC or use Reply All so responses stay with this RFI."
    )
    window.location.href = result.href
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
              Opens your default email app. Compass is automatically copied so
              replies can return to this RFI. Use the response area on the RFI
              for Compass messages and @mentions.
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

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={starting || to.length === 0}
              onClick={() => void openDefaultEmailApp()}
            >
              {starting ? (
                <IconLoader2 className="size-4 animate-spin" />
              ) : (
                <IconMail className="size-4" />
              )}
              Open email app
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
