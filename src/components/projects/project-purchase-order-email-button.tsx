"use client"

import * as React from "react"
import { IconCheck, IconMail, IconSend } from "@tabler/icons-react"

import { sendPurchaseOrderEmail } from "@/app/actions/project-operations"
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

export function ProjectPurchaseOrderEmailButton({
  projectId,
  purchaseOrderId,
  poNumber,
  projectLabel,
  supplierName,
  supplierEmail,
}: {
  readonly projectId: string
  readonly purchaseOrderId: string
  readonly poNumber: string | null
  readonly projectLabel: string
  readonly supplierName: string | null
  readonly supplierEmail: string | null
}): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [to, setTo] = React.useState(supplierEmail ?? "")
  const [cc, setCc] = React.useState("")
  const [subject, setSubject] = React.useState(
    defaultSubject({ poNumber, projectLabel })
  )
  const [message, setMessage] = React.useState(
    defaultMessage({ supplierName, projectLabel, poNumber })
  )
  const [status, setStatus] = React.useState<EmailStatus>({ kind: "idle" })

  async function submitEmail(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setStatus({ kind: "sending" })
    const result = await sendPurchaseOrderEmail(projectId, purchaseOrderId, {
      to,
      cc,
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="print:hidden">
          <IconMail className="size-4" />
          Email supplier
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={submitEmail} className="space-y-5">
          <DialogHeader>
            <DialogTitle>Email purchase order</DialogTitle>
            <DialogDescription>
              Send a supplier-ready copy of this P.O. through Compass. You can
              edit the recipients and message before sending.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`po-email-to-${purchaseOrderId}`}>To</Label>
              <Input
                id={`po-email-to-${purchaseOrderId}`}
                type="email"
                value={to}
                onChange={(event) => setTo(event.target.value)}
                placeholder="supplier@example.com"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`po-email-cc-${purchaseOrderId}`}>Cc</Label>
              <Input
                id={`po-email-cc-${purchaseOrderId}`}
                value={cc}
                onChange={(event) => setCc(event.target.value)}
                placeholder="optional"
              />
            </div>
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
            <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
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
              disabled={status.kind === "sending" || status.kind === "sent"}
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
                  : "Send through Compass"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
