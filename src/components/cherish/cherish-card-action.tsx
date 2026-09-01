"use client"

import { useEffect, useState } from "react"
import { IconAlertTriangle, IconMail, IconX } from "@tabler/icons-react"

import {
  cancelCherishCard,
  getCherishCardCatalog,
  sendCherishCard,
  type CherishCardCatalogItem,
  type CherishCardFulfillment,
} from "@/app/actions/cherish-cards"
import type { CherishPulseReviewItem } from "@/app/actions/cherish-pulse"
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
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

type Props = {
  readonly recognition: CherishPulseReviewItem
  readonly fulfillment: CherishCardFulfillment | null
  readonly onFulfillmentChange: (value: CherishCardFulfillment) => void
}

type RecipientForm = {
  readonly firstName: string
  readonly lastName: string
  readonly businessName: string
  readonly address1: string
  readonly address2: string
  readonly city: string
  readonly state: string
  readonly postalCode: string
}

const EMPTY_RECIPIENT: RecipientForm = {
  firstName: "",
  lastName: "",
  businessName: "",
  address1: "",
  address2: "",
  city: "",
  state: "CO",
  postalCode: "",
}

export function CherishCardAction({
  recognition,
  fulfillment,
  onFulfillmentChange,
}: Props): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [catalog, setCatalog] = useState<readonly CherishCardCatalogItem[]>([])
  const [catalogRequested, setCatalogRequested] = useState(false)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [selectedCardId, setSelectedCardId] = useState<number | null>(null)
  const [message, setMessage] = useState(recognition.message)
  const [wishes, setWishes] = useState(
    "With appreciation,\nHigh Performance Structures",
  )
  const [recipient, setRecipient] = useState<RecipientForm>(EMPTY_RECIPIENT)
  const [submitting, setSubmitting] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [resultMessage, setResultMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!open || catalogRequested) return

    let mounted = true
    setCatalogRequested(true)
    setCatalogLoading(true)
    setResultMessage(null)
    void getCherishCardCatalog().then((result) => {
      if (!mounted) return
      if (result.success) {
        setCatalog(result.data)
        setSelectedCardId(result.data[0]?.id ?? null)
      } else {
        setResultMessage(result.error)
      }
      setCatalogLoading(false)
    })

    return () => {
      mounted = false
    }
  }, [catalogRequested, open])

  const selectedCard = catalog.find((card) => card.id === selectedCardId) ?? null

  function updateRecipient(field: keyof RecipientForm, value: string): void {
    setRecipient((current) => ({ ...current, [field]: value }))
  }

  async function submit(): Promise<void> {
    if (selectedCardId === null) return
    setSubmitting(true)
    setResultMessage(null)
    const result = await sendCherishCard({
      responseId: recognition.id,
      cardId: selectedCardId,
      message,
      wishes,
      recipient,
    })
    setSubmitting(false)

    if (!result.success) {
      setResultMessage(result.error)
      return
    }

    onFulfillmentChange(result.data)
    setOpen(false)
  }

  async function cancel(): Promise<void> {
    if (!fulfillment) return
    setCancelling(true)
    setResultMessage(null)
    const result = await cancelCherishCard(fulfillment.id)
    setCancelling(false)
    if (!result.success) {
      setResultMessage(result.error)
      return
    }
    onFulfillmentChange(result.data)
  }

  if (fulfillment && fulfillment.status !== "failed") {
    return (
      <div className="mt-3 border-t pt-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <IconMail className="size-4 text-muted-foreground" />
          <span>
            Physical card · {fulfillment.cardName} · {fulfillment.recipientName}
          </span>
          <Badge variant={fulfillmentBadgeVariant(fulfillment.status)}>
            {fulfillmentStatusLabel(fulfillment.status)}
          </Badge>
        </div>

        {fulfillment.status === "submitted" ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-2"
                disabled={cancelling}
              >
                <IconX className="size-4" />
                {cancelling ? "Cancelling…" : "Cancel before production"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Cancel the physical card?</AlertDialogTitle>
                <AlertDialogDescription>
                  Handwrytten can only cancel an order before production starts.
                  If writing or mailing has begun, the provider will reject the
                  cancellation.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep card</AlertDialogCancel>
                <AlertDialogAction onClick={() => void cancel()}>
                  Request cancellation
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}

        {fulfillment.status === "needs_attention" ? (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-destructive">
            <IconAlertTriangle className="mt-0.5 size-4 shrink-0" />
            Verify this order in Handwrytten before taking another action.
          </p>
        ) : null}
        {resultMessage ? (
          <p className="mt-2 text-xs text-destructive" role="status">
            {resultMessage}
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen && catalog.length === 0) setCatalogRequested(false)
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="mt-3">
          <IconMail className="size-4" />
          {fulfillment?.status === "failed"
            ? "Retry physical card"
            : "Mail a physical card"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Mail a CHERISH card</DialogTitle>
          <DialogDescription>
            Handwrytten will write, address, stamp, and mail a real card. The
            final button creates a billable provider order.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`cherish-card-${recognition.id}`}>Card design</Label>
            <Select
              value={selectedCardId === null ? undefined : String(selectedCardId)}
              onValueChange={(value) => {
                const card = catalog.find((item) => String(item.id) === value)
                setSelectedCardId(card?.id ?? null)
              }}
              disabled={catalogLoading || catalog.length === 0}
            >
              <SelectTrigger
                id={`cherish-card-${recognition.id}`}
                className="w-full"
              >
                <SelectValue
                  placeholder={catalogLoading ? "Loading cards…" : "Choose a card"}
                />
              </SelectTrigger>
              <SelectContent>
                {catalog.map((card) => (
                  <SelectItem key={card.id} value={String(card.id)}>
                    {card.categoryName} · {card.name}
                    {card.price === null ? "" : ` · $${card.price.toFixed(2)}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedCard ? (
              <div className="flex gap-3">
                {selectedCard.coverUrl ? (
                  <div
                    className="h-24 w-32 shrink-0 rounded-lg border bg-muted bg-contain bg-center bg-no-repeat"
                    style={{ backgroundImage: `url(${selectedCard.coverUrl})` }}
                    role="img"
                    aria-label={`${selectedCard.name} card cover`}
                  />
                ) : null}
                <p className="text-xs text-muted-foreground">
                  {selectedCard.description || "Handwritten card"}
                  {selectedCard.characters === null
                    ? ""
                    : ` · Up to ${selectedCard.characters} message characters`}
                  {selectedCard.price === null
                    ? ""
                    : ` · $${selectedCard.price.toFixed(2)} plus postage and applicable tax`}
                </p>
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor={`cherish-card-message-${recognition.id}`}>
              Message
            </Label>
            <Textarea
              id={`cherish-card-message-${recognition.id}`}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={selectedCard?.characters ?? 1_200}
              className="min-h-28"
            />
            <p className="text-right text-xs text-muted-foreground">
              {message.length}/
              {selectedCard?.characters ?? 1_200}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`cherish-card-wishes-${recognition.id}`}>Closing</Label>
            <Textarea
              id={`cherish-card-wishes-${recognition.id}`}
              value={wishes}
              onChange={(event) => setWishes(event.target.value)}
              maxLength={240}
              className="min-h-20"
            />
          </div>

          <fieldset className="space-y-3 border-t pt-4">
            <legend className="text-sm font-semibold">Recipient and mailing address</legend>
            <p className="text-xs text-muted-foreground">
              This address is visible only to Executive Admin fulfillment and
              Handwrytten. US addresses are supported in this first release.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <CardInput
                id={`cherish-first-name-${recognition.id}`}
                label="First name"
                value={recipient.firstName}
                onChange={(value) => updateRecipient("firstName", value)}
                autoComplete="given-name"
              />
              <CardInput
                id={`cherish-last-name-${recognition.id}`}
                label="Last name"
                value={recipient.lastName}
                onChange={(value) => updateRecipient("lastName", value)}
                autoComplete="family-name"
              />
            </div>
            <CardInput
              id={`cherish-business-${recognition.id}`}
              label="Business name (optional)"
              value={recipient.businessName}
              onChange={(value) => updateRecipient("businessName", value)}
              autoComplete="organization"
            />
            <CardInput
              id={`cherish-address-1-${recognition.id}`}
              label="Street address"
              value={recipient.address1}
              onChange={(value) => updateRecipient("address1", value)}
              autoComplete="address-line1"
            />
            <CardInput
              id={`cherish-address-2-${recognition.id}`}
              label="Unit or suite (optional)"
              value={recipient.address2}
              onChange={(value) => updateRecipient("address2", value)}
              autoComplete="address-line2"
            />
            <div className="grid gap-3 sm:grid-cols-[1fr_6rem_8rem]">
              <CardInput
                id={`cherish-city-${recognition.id}`}
                label="City"
                value={recipient.city}
                onChange={(value) => updateRecipient("city", value)}
                autoComplete="address-level2"
              />
              <CardInput
                id={`cherish-state-${recognition.id}`}
                label="State"
                value={recipient.state}
                onChange={(value) => updateRecipient("state", value.toUpperCase())}
                autoComplete="address-level1"
                maxLength={2}
              />
              <CardInput
                id={`cherish-zip-${recognition.id}`}
                label="ZIP code"
                value={recipient.postalCode}
                onChange={(value) => updateRecipient("postalCode", value)}
                autoComplete="postal-code"
                maxLength={10}
              />
            </div>
          </fieldset>
        </div>

        {resultMessage ? (
          <p className="text-sm text-destructive" role="status">
            {resultMessage}
          </p>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={submitting}
          >
            Close
          </Button>
          <Button
            type="button"
            onClick={() => void submit()}
            disabled={
              submitting ||
              selectedCardId === null ||
              message.trim().length < 3 ||
              wishes.trim().length === 0
            }
          >
            <IconMail className="size-4" />
            {submitting ? "Submitting order…" : "Confirm and mail card"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CardInput({
  id,
  label,
  value,
  onChange,
  autoComplete,
  maxLength = 160,
}: {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly autoComplete: string
  readonly maxLength?: number
}): React.ReactElement {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        maxLength={maxLength}
      />
    </div>
  )
}

function fulfillmentStatusLabel(
  status: CherishCardFulfillment["status"],
): string {
  switch (status) {
    case "submitting":
      return "Submitting"
    case "submitted":
      return "Ordered"
    case "cancelling":
      return "Cancelling"
    case "cancelled":
      return "Cancelled"
    case "failed":
      return "Failed"
    case "needs_attention":
      return "Needs attention"
  }
}

function fulfillmentBadgeVariant(
  status: CherishCardFulfillment["status"],
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "submitted") return "default"
  if (status === "needs_attention") return "destructive"
  if (status === "cancelled") return "outline"
  return "secondary"
}
