"use client"

import * as React from "react"
import { IconMail, IconSend } from "@tabler/icons-react"
import { useRouter } from "next/navigation"

import { sendProjectRfqEmail, type RfqEmailDeliveryItem } from "@/app/actions/project-rfq-email"
import type { ProjectRfqItem } from "@/app/actions/project-operations"
import { EmailRecipientPicker } from "@/components/email/email-recipient-picker"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { EmailRecipientOption } from "@/lib/email/recipient-options"

function defaultMessage(rfq: ProjectRfqItem, projectLabel: string): string {
  return [
    `Please review the RFQ scope and linked plans and specifications for ${projectLabel}.`,
    rfq.dueDate ? `Please reply with your quote by ${rfq.dueDate}.` : "Please reply with your quote.",
  ].join("\n")
}

function defaultTo(rfq: ProjectRfqItem): readonly string[] {
  return rfq.recipientEmail ? [rfq.recipientEmail] : []
}

export function ProjectRfqEmailButton({
  projectId, projectLabel, rfq, recipientOptions,
}: {
  readonly projectId: string
  readonly projectLabel: string
  readonly rfq: ProjectRfqItem
  readonly recipientOptions: readonly EmailRecipientOption[]
}): React.ReactElement {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [to, setTo] = React.useState<readonly string[]>(defaultTo(rfq))
  const [cc, setCc] = React.useState<readonly string[]>([])
  const [subject, setSubject] = React.useState(`${rfq.sourceRecordNumber ?? "RFQ"} - ${rfq.title} - ${projectLabel}`)
  const [message, setMessage] = React.useState(defaultMessage(rfq, projectLabel))
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const [bidder, ...others] = to
    if (!bidder || others.length > 0) {
      setError("Send an RFQ to one bidder at a time. Put anyone else in Cc.")
      return
    }
    setPending(true)
    setError(null)
    const result = await sendProjectRfqEmail(projectId, rfq.id, {
      expectedUpdatedAt: rfq.updatedAt,
      to: bidder,
      cc,
      subject,
      message,
    })
    setPending(false)
    if (!result.success) {
      setError(result.error)
      return
    }
    setOpen(false)
    router.refresh()
  }

  const canSend = rfq.templateReview === null && ["draft", "sent"].includes(rfq.status)
  return (
    <Dialog open={open} onOpenChange={(next) => {
      setOpen(next)
      if (next) {
        setTo(defaultTo(rfq))
        setCc([])
        setSubject(`${rfq.sourceRecordNumber ?? "RFQ"} - ${rfq.title} - ${projectLabel}`)
        setMessage(defaultMessage(rfq, projectLabel))
        setError(null)
      }
    }}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" disabled={!canSend}>
          <IconMail className="size-4" /> Send email
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Email {rfq.sourceRecordNumber ?? "RFQ"}</DialogTitle>
            <DialogDescription>
              The full RFQ scope and project Drive viewer links are included in the email.
              This bidder does not need a Compass account.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <EmailRecipientPicker
              id={`rfq-to-${rfq.id}`}
              label="To"
              options={recipientOptions}
              value={to}
              excludedEmails={cc}
              onChange={setTo}
              placeholder="Choose the bidder or enter an email..."
              required
            />
            <EmailRecipientPicker
              id={`rfq-cc-${rfq.id}`}
              label="Cc"
              options={recipientOptions}
              value={cc}
              excludedEmails={to}
              onChange={setCc}
              placeholder="Choose an optional contact..."
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`rfq-subject-${rfq.id}`}>Subject</Label>
            <Input id={`rfq-subject-${rfq.id}`} value={subject} onChange={(event) => setSubject(event.currentTarget.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`rfq-message-${rfq.id}`}>Message</Label>
            <Textarea id={`rfq-message-${rfq.id}`} value={message} onChange={(event) => setMessage(event.currentTarget.value)} className="min-h-24" required />
          </div>
          <div className="border-t pt-3">
            <p className="text-sm font-medium">Included in the email</p>
            <p className="mt-1 text-xs text-muted-foreground">{rfq.title} · {rfq.scopeItems.length} scope lines · {rfq.documentLinks.length} plans/specs links</p>
            <ul className="mt-2 space-y-1 text-sm">
              {rfq.documentLinks.map((link) => <li key={`${link.lineNumber}-${link.url}`}>{link.label}</li>)}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              Compass grants each recipient viewer access to these project Drive files before sending.
              Google may ask a recipient without a Google account to verify their email.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              The bidder&apos;s reply comes back to this RFQ in Compass and to you.
            </p>
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending || to.length === 0}>
              <IconSend className="size-4" /> {pending ? "Sending..." : "Send RFQ email"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function ProjectRfqEmailHistory({
  deliveries,
}: {
  readonly deliveries: readonly RfqEmailDeliveryItem[]
}): React.ReactElement | null {
  if (deliveries.length === 0) return null
  return (
    <section className="mt-3 border-t pt-3">
      <h3 className="text-xs font-semibold uppercase text-muted-foreground">Email delivery history</h3>
      <div className="mt-2 space-y-2">
        {deliveries.map((delivery) => (
          <div key={delivery.id} className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-sm">
            <span>{delivery.recipientEmail}{delivery.ccEmails.length > 0 ? ` · Cc ${delivery.ccEmails.join(", ")}` : ""}</span>
            <span className="text-xs text-muted-foreground">
              {delivery.status === "sent" ? "Sent" : delivery.status === "failed" ? "Failed" : "Preparing"}
              {" · "}{new Date(delivery.sentAt ?? delivery.requestedAt).toLocaleString("en-US")}
              {" · "}{delivery.requestedByName}{" · "}{delivery.documentCount} viewer links
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
