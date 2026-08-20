"use client"

import * as React from "react"
import { IconCheck, IconMail, IconSend } from "@tabler/icons-react"

import { sendPurchaseOrderEmail } from "@/app/actions/project-operations"
import { EmailRecipientPicker } from "@/components/email/email-recipient-picker"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  isValidRecipientEmail,
  normalizeRecipientEmail,
  type EmailRecipientOption,
} from "@/lib/email/recipient-options"

type EmailStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "sending" }
  | { readonly kind: "sent"; readonly message: string }
  | { readonly kind: "error"; readonly message: string }

function defaultSubject(input: {
  readonly poNumber: string | null
  readonly projectLabel: string
}): string {
  return `Purchase Order ${input.poNumber ?? ""} - ${input.projectLabel}`.trim()
}

function defaultMessage(input: {
  readonly supplierName: string | null
  readonly projectLabel: string
  readonly poNumber: string | null
}): string {
  return [
    `Hello${input.supplierName ? ` ${input.supplierName}` : ""},`,
    "",
    `Please see the purchase order below for ${input.projectLabel}.`,
    input.poNumber ? `P.O.: ${input.poNumber}` : null,
    "",
    "Please reply with confirmation and let us know if anything needs clarification.",
    "",
    "Thank you,",
    "High Performance Structures",
  ]
    .filter((line) => line !== null)
    .join("\n")
}

function defaultSupplierRecipients(email: string | null): readonly string[] {
  if (!email || !isValidRecipientEmail(email)) return []
  return [normalizeRecipientEmail(email)]
}

export function ProjectPurchaseOrderEmailButton({
  projectId,
  purchaseOrderId,
  poNumber,
  projectLabel,
  supplierName,
  supplierEmail,
  recipientOptions,
}: {
  readonly projectId: string
  readonly purchaseOrderId: string
  readonly poNumber: string | null
  readonly projectLabel: string
  readonly supplierName: string | null
  readonly supplierEmail: string | null
  readonly recipientOptions: readonly EmailRecipientOption[]
}): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [to, setTo] = React.useState<readonly string[]>(
    defaultSupplierRecipients(supplierEmail)
  )
  const [cc, setCc] = React.useState<readonly string[]>([])
  const [subject, setSubject] = React.useState(
    defaultSubject({ poNumber, projectLabel })
  )
  const [message, setMessage] = React.useState(
    defaultMessage({ supplierName, projectLabel, poNumber })
  )
  const [status, setStatus] = React.useState<EmailStatus>({ kind: "idle" })

  function handleOpenChange(nextOpen: boolean): void {
    setOpen(nextOpen)
    if (!nextOpen) return

    setTo(defaultSupplierRecipients(supplierEmail))
    setCc([])
    setSubject(defaultSubject({ poNumber, projectLabel }))
    setMessage(defaultMessage({ supplierName, projectLabel, poNumber }))
    setStatus({ kind: "idle" })
  }

  async function submitEmail(
    event: React.FormEvent<HTMLFormElement>
  ): Promise<void> {
    event.preventDefault()
    setStatus({ kind: "sending" })
    const result = await sendPurchaseOrderEmail(projectId, purchaseOrderId, {
      to: to.join(", "),
      cc: cc.join(", "),
      subject,
      message,
    })

    if (result.success) {
      const sentMessage =
        result.status === "pending_provider"
          ? "Email is staged, but the email provider is not configured yet."
          : "Purchase order email sent."
      setStatus({ kind: "sent", message: sentMessage })
      return
    }

    setStatus({ kind: "error", message: result.error })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="print:hidden"
        >
          <IconMail className="size-4" />
          Email supplier
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={submitEmail} className="space-y-5">
          <DialogHeader>
            <DialogTitle>Email purchase order</DialogTitle>
            <DialogDescription>
              Edit the recipients and message before sending.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <EmailRecipientPicker
              id={`po-email-to-${purchaseOrderId}`}
              label="To"
              options={recipientOptions}
              value={to}
              excludedEmails={cc}
              onChange={(emails) => {
                setTo(emails)
                setStatus({ kind: "idle" })
              }}
              placeholder="Choose supplier or enter an email..."
              required
            />
            <EmailRecipientPicker
              id={`po-email-cc-${purchaseOrderId}`}
              label="Cc"
              options={recipientOptions}
              value={cc}
              excludedEmails={to}
              onChange={(emails) => {
                setCc(emails)
                setStatus({ kind: "idle" })
              }}
              placeholder="Choose an optional contact..."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`po-email-subject-${purchaseOrderId}`}>Subject</Label>
            <Input
              id={`po-email-subject-${purchaseOrderId}`}
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`po-email-message-${purchaseOrderId}`}>Message</Label>
            <Textarea
              id={`po-email-message-${purchaseOrderId}`}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              className="min-h-40"
              required
            />
          </div>

          {status.kind === "sent" && (
            <p className="rounded-md border border-brand-hps-primary bg-card px-3 py-2 text-sm text-brand-hps-primary">
              {status.message}
            </p>
          )}
          {status.kind === "error" && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {status.message}
            </p>
          )}

          <DialogFooter>
            <Button
              type="submit"
              disabled={
                to.length === 0 ||
                status.kind === "sending" ||
                status.kind === "sent"
              }
            >
              {status.kind === "sent" ? (
                <IconCheck className="size-4" />
              ) : (
                <IconSend className="size-4" />
              )}
              {status.kind === "sending"
                ? "Sending..."
                : status.kind === "sent"
                  ? "Sent"
                  : "Send email"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
