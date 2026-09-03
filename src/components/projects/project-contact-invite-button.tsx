"use client"

import * as React from "react"
import { IconMailForward } from "@tabler/icons-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { sendProjectAccessInvitation } from "@/app/actions/project-access-invitations"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { projectAccessWelcomeTemplate } from "@/lib/email/project-access-welcome"
import type { ProjectContactCompassAccountStatus } from "@/lib/project-contact-access-status"

type InvitableContactType = "owner" | "subcontractor" | "supplier" | "internal"

function accessLabel(contactType: InvitableContactType): string {
  if (contactType === "owner") return "Owner / Client"
  if (contactType === "supplier") return "Supplier"
  if (contactType === "subcontractor") return "Subcontractor"
  return "Internal Staff"
}

export function ProjectContactInviteButton({
  projectId,
  projectLabel,
  contactId,
  contactName,
  contactEmail,
  contactType,
  compassAccountStatus,
}: {
  readonly projectId: string
  readonly projectLabel: string
  readonly contactId: string
  readonly contactName: string
  readonly contactEmail: string
  readonly contactType: InvitableContactType
  readonly compassAccountStatus: ProjectContactCompassAccountStatus
}): React.ReactElement {
  const router = useRouter()
  const template = projectAccessWelcomeTemplate({
    recipientName: contactName,
    projectLabel,
  })
  const [open, setOpen] = React.useState(false)
  const [subject, setSubject] = React.useState(template.subject)
  const [message, setMessage] = React.useState(template.message)
  const [sending, setSending] = React.useState(false)
  const grantsExistingAccount = compassAccountStatus === "active"

  const handleOpenChange = (nextOpen: boolean): void => {
    setOpen(nextOpen)
    if (nextOpen) {
      const nextTemplate = projectAccessWelcomeTemplate({
        recipientName: contactName,
        projectLabel,
      })
      setSubject(nextTemplate.subject)
      setMessage(nextTemplate.message)
    }
  }

  const handleSend = async (): Promise<void> => {
    setSending(true)
    try {
      const result = await sendProjectAccessInvitation({
        projectId,
        contactId,
        subject,
        message,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }

      if (result.warning) toast.warning(result.warning)
      else if (result.accessStatus === "access_granted") {
        toast.success("Project access granted and welcome email sent")
      } else {
        toast.success("Compass invitation and welcome email sent")
      }
      setOpen(false)
      router.refresh()
    } catch {
      toast.error("Unable to send the Compass invitation")
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7"
        onClick={() => setOpen(true)}
      >
        <IconMailForward className="size-3.5" />
        {grantsExistingAccount ? "Grant project access" : "Invite to Compass"}
      </Button>

      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent className="flex w-full flex-col overflow-y-auto sm:max-w-xl">
          <SheetHeader className="border-b pb-4 text-left">
            <SheetTitle>
              {grantsExistingAccount ? "Grant project access" : "Invite to Compass"}
            </SheetTitle>
            <SheetDescription>
              {grantsExistingAccount
                ? "Assign this existing Compass account to this project and send an editable welcome email."
                : "Send project-specific access and an editable welcome email."}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-5 py-5">
            <div className="grid gap-x-5 gap-y-3 border-b pb-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  Recipient
                </p>
                <p className="mt-1 text-sm font-medium">{contactName}</p>
                <p className="text-xs text-muted-foreground">{contactEmail}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  Access
                </p>
                <p className="mt-1 text-sm font-medium">
                  {accessLabel(contactType)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {projectLabel} only
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor={`invite-subject-${contactId}`}>
                Email subject
              </Label>
              <Input
                id={`invite-subject-${contactId}`}
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                disabled={sending}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor={`invite-message-${contactId}`}>
                Welcome message
              </Label>
              <Textarea
                id={`invite-message-${contactId}`}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                disabled={sending}
                className="min-h-[390px] resize-y leading-relaxed"
              />
            </div>

            <p className="border-t pt-4 text-xs text-muted-foreground">
              {grantsExistingAccount
                ? "This Compass account is already active. Access to this project is granted immediately; no account invitation is sent."
                : "New users receive a secure WorkOS account invitation. No other project access is added."}
            </p>
          </div>

          <SheetFooter className="border-t pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={sending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSend}
              disabled={sending || !subject.trim() || !message.trim()}
            >
              {sending
                ? "Sending..."
                : grantsExistingAccount
                  ? "Send Welcome and Grant Access"
                  : "Send Welcome and Access"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  )
}
