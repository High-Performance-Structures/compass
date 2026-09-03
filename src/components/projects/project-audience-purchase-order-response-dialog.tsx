"use client"

import * as React from "react"
import { IconClipboardCheck, IconProgressCheck } from "@tabler/icons-react"
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
import {
  PORTAL_PURCHASE_ORDER_VENDOR_STATUSES,
  portalPurchaseOrderCanReceiveResponse,
  type PortalPurchaseOrderAcknowledgement,
  type PortalPurchaseOrderStatusUpdate,
  type PortalPurchaseOrderVendorStatus,
} from "@/lib/purchase-orders/portal-response"

type ResponseKind = "acknowledge" | "status" | "question"

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
  latestStatus,
  recipients,
  viewerIsInternal,
}: {
  readonly projectId: string
  readonly purchaseOrderId: string
  readonly purchaseOrderLabel: string
  readonly status: string
  readonly acknowledgement: PortalPurchaseOrderAcknowledgement | null
  readonly latestStatus: PortalPurchaseOrderStatusUpdate | null
  readonly recipients: readonly ProjectAudienceMessageRecipient[]
  readonly viewerIsInternal: boolean
}): React.ReactElement {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [pending, startTransition] = React.useTransition()
  const [kind, setKind] = React.useState<ResponseKind>(
    acknowledgement ? "status" : "acknowledge"
  )
  const [vendorStatus, setVendorStatus] =
    React.useState<PortalPurchaseOrderVendorStatus>(
      latestStatus?.status ?? "processing"
    )
  const [note, setNote] = React.useState("")
  const [question, setQuestion] = React.useState("")
  const [recipientUserId, setRecipientUserId] = React.useState(
    recipients[0]?.userId ?? ""
  )
  const [error, setError] = React.useState<string | null>(null)
  const acceptsResponse = portalPurchaseOrderCanReceiveResponse(status)

  function changeOpen(nextOpen: boolean): void {
    setOpen(nextOpen)
    if (nextOpen) {
      setVendorStatus(latestStatus?.status ?? "processing")
      setError(null)
    }
  }

  function changeKind(value: string): void {
    if (value === "acknowledge" || value === "status" || value === "question") {
      setKind(value)
    }
  }

  function changeVendorStatus(value: string): void {
    const status = PORTAL_PURCHASE_ORDER_VENDOR_STATUSES.find(
      (option) => option.value === value
    )
    if (status) setVendorStatus(status.value)
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
    startTransition(async () => {
      const result = await respondToSubVendorPurchaseOrder(
        projectId,
        purchaseOrderId,
        kind === "acknowledge"
          ? { decision: "acknowledge", note }
          : kind === "status"
            ? { decision: "status", status: vendorStatus, note }
            : {
                decision: "question",
                question,
                recipientUserId: recipientUserId || null,
              }
      )
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
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" disabled={!acceptsResponse}>
          {acknowledgement ? (
            <IconProgressCheck className="size-4" />
          ) : (
            <IconClipboardCheck className="size-4" />
          )}
          {acknowledgement ? "Update status" : "Review & respond"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Respond to {purchaseOrderLabel}</DialogTitle>
            <DialogDescription>
              Confirm receipt, share fulfillment progress, or route a question
              to the internal project team.
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
                  <SelectItem value="status">Update fulfillment status</SelectItem>
                  <SelectItem value="question">Ask a question</SelectItem>
                </SelectContent>
              </Select>
            </label>
            {kind === "question" ? (
              <>
                {recipients.length > 0 ? (
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
                ) : (
                  <div className="grid gap-1.5 text-sm">
                    <span className="font-medium">Send to</span>
                    <p className="border bg-muted/40 p-3">
                      Project team
                      <span className="mt-1 block text-muted-foreground">
                        Compass will route this question to the internal team.
                      </span>
                    </p>
                  </div>
                )}
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
            ) : (
              <>
                {kind === "status" && (
                  <label className="grid gap-1.5 text-sm font-medium">
                    Fulfillment status
                    <Select
                      value={vendorStatus}
                      onValueChange={changeVendorStatus}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PORTAL_PURCHASE_ORDER_VENDOR_STATUSES.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="font-normal text-muted-foreground">
                      {
                        PORTAL_PURCHASE_ORDER_VENDOR_STATUSES.find(
                          (option) => option.value === vendorStatus
                        )?.description
                      }
                    </span>
                  </label>
                )}
                <label className="grid gap-1.5 text-sm font-medium">
                  Note (optional)
                  <Textarea
                    value={note}
                    onChange={(event) => setNote(event.currentTarget.value)}
                    maxLength={2_000}
                    placeholder={
                      kind === "acknowledge"
                        ? "Example: Received and under review."
                        : "Add delivery timing, completed scope, or what is blocking progress."
                    }
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
            <Button type="submit" disabled={pending}>
              {pending
                ? "Submitting..."
                : kind === "acknowledge"
                  ? "Acknowledge received"
                  : kind === "status"
                    ? "Send status update"
                    : "Send question"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
