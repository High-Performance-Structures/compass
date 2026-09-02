"use client"

import { useMemo, useState } from "react"
import {
  IconAlertTriangle,
  IconCheck,
  IconMail,
  IconRefresh,
  IconSend,
  IconTrash,
  IconX,
} from "@tabler/icons-react"

import {
  approveGreetingCardRequest,
  cancelGreetingCardRequest,
  deleteGreetingCardRequest,
  getGreetingCardRequests,
  rejectGreetingCardRequest,
  releaseGreetingCardRequest,
  type GreetingCardRecipientType,
  type GreetingCardRequest,
  type GreetingCardRequestStatus,
} from "@/app/actions/greeting-cards"
import { GreetingCardRequestDialog } from "@/components/cards/greeting-card-request-dialog"
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

export function GreetingCardWorkspace({
  initialRequests,
  canApprove,
}: {
  readonly initialRequests: readonly GreetingCardRequest[]
  readonly canApprove: boolean
}): React.ReactElement {
  const [requests, setRequests] =
    useState<readonly GreetingCardRequest[]>(initialRequests)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [resultMessage, setResultMessage] = useState<string | null>(null)
  const [rejectTarget, setRejectTarget] = useState<GreetingCardRequest | null>(null)
  const [rejectNote, setRejectNote] = useState("")

  const pendingCount = useMemo(
    () => requests.filter((request) => request.status === "pending_approval").length,
    [requests],
  )

  async function refresh(): Promise<void> {
    setRefreshing(true)
    const result = await getGreetingCardRequests()
    setRefreshing(false)
    if (!result.success) {
      setResultMessage(result.error)
      return
    }
    setRequests(result.data)
  }

  async function approve(request: GreetingCardRequest): Promise<void> {
    setBusyId(request.id)
    setResultMessage(null)
    const result = await approveGreetingCardRequest(request.id)
    setBusyId(null)
    if (!result.success) {
      setResultMessage(result.error)
      return
    }
    await refresh()
  }

  async function reject(): Promise<void> {
    if (!rejectTarget) return
    setBusyId(rejectTarget.id)
    setResultMessage(null)
    const result = await rejectGreetingCardRequest(rejectTarget.id, rejectNote)
    setBusyId(null)
    if (!result.success) {
      setResultMessage(result.error)
      return
    }
    setRejectTarget(null)
    setRejectNote("")
    await refresh()
  }

  async function release(request: GreetingCardRequest): Promise<void> {
    setBusyId(request.id)
    setResultMessage(null)
    const result = await releaseGreetingCardRequest(request.id)
    setBusyId(null)
    if (!result.success) {
      setResultMessage(result.error)
      await refresh()
      return
    }
    await refresh()
  }

  async function cancel(request: GreetingCardRequest): Promise<void> {
    setBusyId(request.id)
    setResultMessage(null)
    const result = await cancelGreetingCardRequest(request.id)
    setBusyId(null)
    if (!result.success) {
      setResultMessage(result.error)
      await refresh()
      return
    }
    await refresh()
  }

  async function remove(request: GreetingCardRequest): Promise<void> {
    setBusyId(request.id)
    setResultMessage(null)
    const result = await deleteGreetingCardRequest(request.id)
    setBusyId(null)
    if (!result.success) {
      setResultMessage(result.error)
      return
    }
    setRequests((current) => current.filter((item) => item.id !== request.id))
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">
              {canApprove ? "Card approval queue" : "Your card requests"}
            </h2>
            {canApprove && pendingCount > 0 ? (
              <Badge variant="secondary">{pendingCount} awaiting approval</Badge>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {canApprove
              ? "Approve the content and recipient first, then release the mailing, email, or optional gift separately."
              : "Every employee can prepare cards here. Executive Admin must approve and release each delivery."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="icon"
            variant="outline"
            onClick={() => void refresh()}
            disabled={refreshing}
            aria-label="Refresh card requests"
          >
            <IconRefresh className={refreshing ? "size-4 animate-spin" : "size-4"} />
          </Button>
          <GreetingCardRequestDialog
            onCreated={(request) =>
              setRequests((current) => [request, ...current])
            }
          />
        </div>
      </div>

      {resultMessage ? (
        <p className="border-y py-3 text-sm text-destructive" role="status">
          {resultMessage}
        </p>
      ) : null}

      <div className="divide-y border-y">
        {requests.map((request) => (
          <CardRequestRow
            key={request.id}
            request={request}
            canApprove={canApprove}
            busy={busyId === request.id}
            onApprove={() => void approve(request)}
            onReject={() => {
              setRejectNote("")
              setRejectTarget(request)
            }}
            onRelease={() => void release(request)}
            onCancel={() => void cancel(request)}
            onDelete={() => void remove(request)}
          />
        ))}
        {requests.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <IconMail className="mx-auto size-7 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">No greeting-card requests yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Prepare a card for a client, subcontractor, vendor, employee, or
              other business relationship.
            </p>
          </div>
        ) : null}
      </div>

      <Dialog
        open={rejectTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRejectTarget(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject this card request?</DialogTitle>
            <DialogDescription>
              The requester will see your note and can remove the rejected
              request before preparing a corrected one.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="card-rejection-note">Reason</Label>
            <Textarea
              id="card-rejection-note"
              value={rejectNote}
              onChange={(event) => setRejectNote(event.target.value)}
              maxLength={500}
              className="min-h-24"
              placeholder="Explain what should be corrected."
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRejectTarget(null)}>
              Keep pending
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void reject()}
              disabled={rejectNote.trim().length === 0 || busyId !== null}
            >
              Reject request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function CardRequestRow({
  request,
  canApprove,
  busy,
  onApprove,
  onReject,
  onRelease,
  onCancel,
  onDelete,
}: {
  readonly request: GreetingCardRequest
  readonly canApprove: boolean
  readonly busy: boolean
  readonly onApprove: () => void
  readonly onReject: () => void
  readonly onRelease: () => void
  readonly onCancel: () => void
  readonly onDelete: () => void
}): React.ReactElement {
  const recipientName = `${request.recipient.firstName} ${request.recipient.lastName}`.trim()
  const canDelete =
    (request.requestedByCurrentUser || canApprove) &&
    ["pending_approval", "rejected"].includes(request.status)

  return (
    <article className="px-4 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{recipientName}</p>
            <Badge variant={statusBadgeVariant(request.status)}>
              {statusLabel(request.status, request.deliveryMethod)}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {recipientTypeLabel(request.recipientType)}
            </span>
            <span className="text-xs text-muted-foreground">
              {request.deliveryMethod === "digital_email" ? "E-card" : "Mailed card"}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {request.cardName}
            {request.occasion ? ` · ${request.occasion}` : ""}
            {request.cardPriceCents === null
              ? ""
              : ` · $${(request.cardPriceCents / 100).toFixed(2)} plus postage and tax`}
            {request.gift
              ? ` · $${(request.gift.amountCents / 100).toFixed(2)} digital gift`
              : ""}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Requested by {request.requestedByName} · {formatDate(request.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          {canApprove && request.status === "pending_approval" ? (
            <Button type="button" size="sm" onClick={onApprove} disabled={busy}>
              <IconCheck className="size-4" />
              {busy ? "Approving…" : "Approve"}
            </Button>
          ) : null}
          {canApprove && ["pending_approval", "approved"].includes(request.status) ? (
            <Button type="button" size="sm" variant="outline" onClick={onReject} disabled={busy}>
              <IconX className="size-4" /> Reject
            </Button>
          ) : null}
          {canApprove && request.status === "approved" ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" size="sm" disabled={busy}>
                  <IconSend className="size-4" />
                  {request.deliveryMethod === "digital_email"
                    ? "Send e-card"
                    : "Release for mailing"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {request.deliveryMethod === "digital_email"
                      ? "Send this approved e-card?"
                      : "Release this approved card?"}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {request.deliveryMethod === "digital_email"
                      ? `Compass will email the private HPS e-card to ${request.recipient.email}.${
                          request.gift
                            ? ` This also purchases a $${(request.gift.amountCents / 100).toFixed(2)} Giftbit reward.`
                            : " No gift will be purchased."
                        }`
                      : `This creates a billable Handwrytten order for ${recipientName}. Handwrytten will write, stamp, and mail the physical card.`}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Review again</AlertDialogCancel>
                  <AlertDialogAction onClick={onRelease}>
                    Confirm and release
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
          {canApprove &&
          (request.status === "submitted" ||
            (request.deliveryMethod === "digital_email" &&
              request.status === "needs_attention")) ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" size="sm" variant="outline" disabled={busy}>
                  {request.deliveryMethod === "digital_email"
                    ? "Cancel e-card"
                    : "Cancel before production"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {request.deliveryMethod === "digital_email"
                      ? "Cancel the e-card?"
                      : "Cancel the mailed card?"}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {request.deliveryMethod === "digital_email"
                      ? request.status === "needs_attention"
                        ? "Compass could not confirm delivery. Cancelling will disable the private card link and attempt to reclaim an included Giftbit reward before it is redeemed."
                        : "The private card link will stop working. An included Giftbit reward can be cancelled only before the recipient redeems it; the email itself cannot be recalled."
                      : "Handwrytten can cancel only before production begins. The provider may reject this request if writing has started."}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep order</AlertDialogCancel>
                  <AlertDialogAction onClick={onCancel}>Request cancellation</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
          {canDelete ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" size="icon" variant="ghost" disabled={busy} aria-label="Remove card request">
                  <IconTrash className="size-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove this unreleased request?</AlertDialogTitle>
                  <AlertDialogDescription>
                    It will disappear from the active queue but retain a
                    recoverable audit record. Nothing has been sent or purchased.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep request</AlertDialogCancel>
                  <AlertDialogAction onClick={onDelete}>Remove request</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
        </div>
      </div>

      <details className="mt-3 border-t pt-3">
        <summary className="cursor-pointer text-sm font-medium">Review card details</summary>
        <div className="mt-3 grid gap-4 text-sm lg:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Message</p>
            <p className="mt-2 whitespace-pre-wrap leading-6">{request.message}</p>
            <p className="mt-3 whitespace-pre-wrap text-muted-foreground">{request.wishes}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {request.deliveryMethod === "digital_email" ? "Email delivery" : "Mailing address"}
            </p>
            {request.deliveryMethod === "digital_email" ? (
              <div className="mt-2 leading-6">
                <p>{request.recipient.email}</p>
                {request.gift ? (
                  <p className="text-muted-foreground">
                    Giftbit US catalog · ${(request.gift.amountCents / 100).toFixed(2)}
                    {request.gift.status ? ` · ${request.gift.status}` : ""}
                  </p>
                ) : (
                  <p className="text-muted-foreground">E-card only · no gift</p>
                )}
              </div>
            ) : (
              <address className="mt-2 not-italic leading-6">
                {recipientName}<br />
                {request.recipient.businessName ? <>{request.recipient.businessName}<br /></> : null}
                {request.recipient.address1}<br />
                {request.recipient.address2 ? <>{request.recipient.address2}<br /></> : null}
                {request.recipient.city}, {request.recipient.state} {request.recipient.postalCode}
              </address>
            )}
          </div>
        </div>
      </details>

      {request.approvalNote ? (
        <p className="mt-3 border-l-2 border-destructive pl-3 text-sm text-destructive">
          Review note: {request.approvalNote}
        </p>
      ) : null}
      {request.providerError ? (
        <p className="mt-3 flex items-start gap-2 text-sm text-destructive">
          <IconAlertTriangle className="mt-0.5 size-4 shrink-0" />
          {request.providerError}
        </p>
      ) : null}
    </article>
  )
}

function statusLabel(
  status: GreetingCardRequestStatus,
  deliveryMethod: GreetingCardRequest["deliveryMethod"],
): string {
  switch (status) {
    case "pending_approval": return "Awaiting approval"
    case "approved": return "Approved"
    case "submitting": return deliveryMethod === "digital_email" ? "Sending" : "Releasing"
    case "submitted": return deliveryMethod === "digital_email" ? "Sent" : "Ordered"
    case "cancelling": return "Cancelling"
    case "cancelled": return "Cancelled"
    case "rejected": return "Rejected"
    case "needs_attention": return "Needs attention"
  }
}

function statusBadgeVariant(
  status: GreetingCardRequestStatus,
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "approved" || status === "submitted") return "default"
  if (status === "rejected" || status === "needs_attention") return "destructive"
  if (status === "cancelled") return "outline"
  return "secondary"
}

function recipientTypeLabel(type: GreetingCardRecipientType): string {
  switch (type) {
    case "client": return "Client"
    case "subcontractor": return "Subcontractor"
    case "supplier": return "Vendor / supplier"
    case "employee": return "Employee"
    case "other": return "Other"
  }
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(date)
}
