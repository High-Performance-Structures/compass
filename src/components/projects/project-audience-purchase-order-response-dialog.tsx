"use client"

import * as React from "react"
import { IconClipboardCheck, IconQuestionMark } from "@tabler/icons-react"
import { useRouter } from "next/navigation"

import { respondToSubVendorPurchaseOrder } from "@/app/actions/project-audience-sub-vendor"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { ProjectAudienceMessageRecipient } from "@/lib/project-audience-direct-message"
import type { PortalPurchaseOrderAcknowledgement } from "@/lib/purchase-orders/portal-response"
import { portalPurchaseOrderCanReceiveResponse } from "@/lib/purchase-orders/portal-response"

type ResponseKind = "acknowledge" | "question"

function acknowledgementLabel(
  acknowledgement: PortalPurchaseOrderAcknowledgement
): string {
  const date = new Date(acknowledgement.submittedAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
  return `Acknowledged by ${acknowledgement.responderName} on ${date}`
}

export function ProjectAudiencePurchaseOrderResponseDialog({
  projectId,
  purchaseOrderId,
  purchaseOrderLabel,
  status,
  acknowledgement,
  recipients,
  viewerIsInternal,
}: {
  readonly projectId: string
  readonly purchaseOrderId: string
  readonly purchaseOrderLabel: string
  readonly status: string
  readonly acknowledgement: PortalPurchaseOrderAcknowledgement | null
  readonly recipients: readonly ProjectAudienceMessageRecipient[]
  readonly viewerIsInternal: boolean
}): React.ReactElement {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [pending, startTransition] = React.useTransition()
  const [kind, setKind] = React.useState<ResponseKind>(
    acknowledgement ? "question" : "acknowledge"
  )
  const [note, setNote] = React.useState("")
  const [question, setQuestion] = React.useState("")
  const [recipientUserId, setRecipientUserId] = React.useState(
    recipients[0]?.userId ?? ""
  )
  const [error, setError] = React.useState<string | null>(null)
  const acceptsResponse = portalPurchaseOrderCanReceiveResponse(status)

  function changeKind(value: string): void {
    if (value === "acknowledge" || value === "question") setKind(value)
  }

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    setError(null)
    if (viewerIsInternal) {
      setError(
        "Preview mode shows the vendor response flow, but only the assigned sub/vendor can submit it."
      )
      return
    }
    if (kind === "question" && !recipientUserId) {
      setError("Choose an internal project team member.")
      return
    }
    startTransition(async () => {
      const result =
        kind === "acknowledge"
          ? await respondToSubVendorPurchaseOrder(projectId, purchaseOrderId, {
              decision: "acknowledge",
              note,
            })
          : await respondToSubVendorPurchaseOrder(projectId, purchaseOrderId, {
              decision: "question",
              question,
              recipientUserId,
            })
      if (!result.success) {
        setError(result.error)
        return
      }
      setOpen(false)
      setNote("")
      setQuestion("")
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" disabled={!acceptsResponse}>
          {acknowledgement ? (
            <IconQuestionMark className="size-4" />
          ) : (
            <IconClipboardCheck className="size-4" />
          )}
          {acknowledgement ? "Ask a question" : "Review & respond"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Respond to {purchaseOrderLabel}</DialogTitle>
            <DialogDescription>
              Confirm that the purchase order was received or route a question
              to the internal project team before it is processed.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-5 grid gap-4">
            {acknowledgement && (
              <p className="border bg-muted/40 p-3 text-sm">
                {acknowledgementLabel(acknowledgement)}
                {acknowledgement.note ? ` · ${acknowledgement.note}` : ""}
              </p>
            )}
            {viewerIsInternal && (
              <p className="border bg-muted/40 p-3 text-sm text-muted-foreground">
                Preview mode: this is the response flow available to the assigned
                sub/vendor. Submitting is blocked for internal accounts.
              </p>
            )}
            <label className="grid gap-1.5 text-sm font-medium">
              Response
              <Select value={kind} onValueChange={changeKind}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {!acknowledgement && (
                    <SelectItem value="acknowledge">Acknowledge receipt</SelectItem>
                  )}
                  <SelectItem value="question">Ask a question</SelectItem>
                </SelectContent>
              </Select>
            </label>
            {kind === "acknowledge" ? (
              <label className="grid gap-1.5 text-sm font-medium">
                Note (optional)
                <Textarea
                  value={note}
                  onChange={(event) => setNote(event.currentTarget.value)}
                  maxLength={2_000}
                  placeholder="Example: Received and under review."
                />
              </label>
            ) : (
              <>
                <label className="grid gap-1.5 text-sm font-medium">
                  Send to
                  <Select
                    value={recipientUserId}
                    onValueChange={setRecipientUserId}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Choose a project team member" />
                    </SelectTrigger>
                    <SelectContent>
                      {recipients.map((recipient) => (
                        <SelectItem
                          key={recipient.userId}
                          value={recipient.userId}
                        >
                          {recipient.displayName}
                          {recipient.role ? ` · ${recipient.role}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className="grid gap-1.5 text-sm font-medium">
                  Question
                  <Textarea
                    value={question}
                    onChange={(event) => setQuestion(event.currentTarget.value)}
                    maxLength={10_000}
                    className="min-h-32"
                    placeholder="What does the project team need to clarify?"
                    required
                  />
                </label>
              </>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter className="mt-5">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                pending ||
                (kind === "question" && recipients.length === 0)
              }
            >
              {pending
                ? "Submitting..."
                : kind === "acknowledge"
                  ? "Acknowledge received"
                  : "Send question"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
