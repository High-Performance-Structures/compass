"use client"

import { useEffect, useState } from "react"
import { IconMailPlus } from "@tabler/icons-react"

import {
  getGreetingCardCatalog,
  submitGreetingCardRequest,
  type GreetingCardCatalogItem,
  type GreetingCardRecipientType,
  type GreetingCardRequest,
} from "@/app/actions/greeting-cards"
import {
  getGreetingCardRecipientOptions,
  type GreetingCardRecipientOption,
} from "@/app/actions/greeting-card-recipients"
import { Button } from "@/components/ui/button"
import { SearchableCombobox } from "@/components/searchable-combobox"
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

const RECIPIENT_TYPE_OPTIONS: ReadonlyArray<{
  readonly value: GreetingCardRecipientType
  readonly label: string
}> = [
  { value: "client", label: "Client" },
  { value: "subcontractor", label: "Subcontractor" },
  { value: "supplier", label: "Vendor / supplier" },
  { value: "employee", label: "Employee" },
  { value: "other", label: "Other" },
]

export function GreetingCardRequestDialog({
  onCreated,
}: {
  readonly onCreated: (request: GreetingCardRequest) => void
}): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [catalog, setCatalog] = useState<readonly GreetingCardCatalogItem[]>([])
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [recipientOptions, setRecipientOptions] = useState<
    readonly GreetingCardRecipientOption[]
  >([])
  const [recipientOptionsLoading, setRecipientOptionsLoading] = useState(false)
  const [selectedRecipientId, setSelectedRecipientId] = useState("")
  const [recipientOptionsError, setRecipientOptionsError] = useState<
    string | null
  >(null)
  const [cardId, setCardId] = useState<number | null>(null)
  const [recipientType, setRecipientType] =
    useState<GreetingCardRecipientType>("client")
  const [occasion, setOccasion] = useState("")
  const [message, setMessage] = useState("")
  const [wishes, setWishes] = useState(
    "With appreciation,\nHigh Performance Structures",
  )
  const [recipient, setRecipient] = useState<RecipientForm>(EMPTY_RECIPIENT)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || catalog.length > 0) return
    let mounted = true
    setCatalogLoading(true)
    setError(null)
    void getGreetingCardCatalog().then((result) => {
      if (!mounted) return
      if (result.success) {
        setCatalog(result.data)
        setCardId(result.data[0]?.id ?? null)
      } else {
        setError(result.error)
      }
      setCatalogLoading(false)
    })
    return () => {
      mounted = false
    }
  }, [catalog.length, open])

  useEffect(() => {
    if (!open || recipientOptions.length > 0) return
    let mounted = true
    setRecipientOptionsLoading(true)
    setRecipientOptionsError(null)
    void getGreetingCardRecipientOptions().then((result) => {
      if (!mounted) return
      if (result.success) {
        setRecipientOptions(result.data)
      } else {
        setRecipientOptionsError(result.error)
      }
      setRecipientOptionsLoading(false)
    })
    return () => {
      mounted = false
    }
  }, [open, recipientOptions.length])

  const selectedCard = catalog.find((card) => card.id === cardId) ?? null
  const selectedRecipient =
    recipientOptions.find((option) => option.id === selectedRecipientId) ?? null

  function updateRecipient(field: keyof RecipientForm, value: string): void {
    setSelectedRecipientId("")
    setRecipient((current) => ({ ...current, [field]: value }))
  }

  function chooseRecipient(optionId: string): void {
    setSelectedRecipientId(optionId)
    const option = recipientOptions.find((candidate) => candidate.id === optionId)
    if (!option) return
    setRecipientType(option.recipientType)
    setRecipient(option.recipient)
  }

  function resetForm(): void {
    setRecipientType("client")
    setOccasion("")
    setMessage("")
    setWishes("With appreciation,\nHigh Performance Structures")
    setRecipient(EMPTY_RECIPIENT)
    setSelectedRecipientId("")
    setError(null)
  }

  async function submit(): Promise<void> {
    if (cardId === null) return
    setSubmitting(true)
    setError(null)
    const result = await submitGreetingCardRequest({
      cardId,
      recipientType,
      occasion,
      message,
      wishes,
      recipient,
    })
    setSubmitting(false)
    if (!result.success) {
      setError(result.error)
      return
    }
    onCreated(result.data)
    resetForm()
    setOpen(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
    >
      <DialogTrigger asChild>
        <Button type="button">
          <IconMailPlus className="size-4" />
          New card request
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Prepare a greeting card</DialogTitle>
          <DialogDescription>
            Add the final card and mailing details. Submitting creates an
            approval request; it does not place a Handwrytten order.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="card-recipient-type">Recipient type</Label>
              <Select
                value={recipientType}
                onValueChange={(value) =>
                  setRecipientType(recipientTypeFromValue(value))
                }
              >
                <SelectTrigger id="card-recipient-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RECIPIENT_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <CardInput
              id="card-occasion"
              label="Occasion (optional)"
              value={occasion}
              onChange={setOccasion}
              autoComplete="off"
              maxLength={100}
              placeholder="Thank you, milestone, birthday…"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="greeting-card-design">Card design</Label>
            <Select
              value={cardId === null ? undefined : String(cardId)}
              onValueChange={(value) => {
                const card = catalog.find((item) => String(item.id) === value)
                setCardId(card?.id ?? null)
              }}
              disabled={catalogLoading || catalog.length === 0}
            >
              <SelectTrigger id="greeting-card-design" className="w-full">
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
              <div className="flex gap-3 border-y py-3">
                {selectedCard.coverUrl ? (
                  <div
                    className="h-24 w-32 shrink-0 rounded-lg border bg-muted bg-contain bg-center bg-no-repeat"
                    style={{ backgroundImage: `url(${selectedCard.coverUrl})` }}
                    role="img"
                    aria-label={`${selectedCard.name} card cover`}
                  />
                ) : null}
                <p className="text-xs leading-5 text-muted-foreground">
                  {selectedCard.description || "Handwritten card"}
                  {selectedCard.characters === null
                    ? ""
                    : ` · Up to ${selectedCard.characters} message characters`}
                  {selectedCard.price === null
                    ? ""
                    : ` · $${selectedCard.price.toFixed(2)} plus postage and tax`}
                </p>
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="greeting-card-message">Message</Label>
            <Textarea
              id="greeting-card-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={selectedCard?.characters ?? 1_200}
              className="min-h-28"
            />
            <p className="text-right text-xs text-muted-foreground">
              {message.length}/{selectedCard?.characters ?? 1_200}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="greeting-card-closing">Closing</Label>
            <Textarea
              id="greeting-card-closing"
              value={wishes}
              onChange={(event) => setWishes(event.target.value)}
              maxLength={240}
              className="min-h-20"
            />
          </div>

          <fieldset className="space-y-3 border-t pt-4">
            <legend className="text-sm font-semibold">Recipient and mailing address</legend>
            <p className="text-xs text-muted-foreground">
              Verify the address carefully. Handwrytten validates US addresses
              again when Executive Admin releases the order.
            </p>
            <div className="space-y-2">
              <Label htmlFor="card-saved-recipient">Saved recipient (optional)</Label>
              <SearchableCombobox
                id="card-saved-recipient"
                ariaLabel="Choose a saved greeting-card recipient"
                value={selectedRecipientId}
                onValueChange={chooseRecipient}
                options={recipientOptions.map(recipientComboboxOption)}
                placeholder={
                  recipientOptionsLoading
                    ? "Loading saved recipients…"
                    : recipientOptions.length === 0
                      ? "No saved recipients found"
                      : "Search clients, trade partners, or employees"
                }
                searchPlaceholder="Search names or companies…"
                emptyMessage="No matching saved recipient. Enter the details below."
                groupHeading="Compass contacts"
                disabled={recipientOptionsLoading}
              />
              <p className="text-xs text-muted-foreground">
                Choosing a saved contact fills the fields below. You can still
                edit any detail or enter a recipient manually.
              </p>
              {selectedRecipient?.addressStatus === "partial" ? (
                <p className="text-xs text-muted-foreground" role="status">
                  Compass found an address, but it is incomplete or could not be
                  fully separated. Please finish the mailing fields.
                </p>
              ) : null}
              {selectedRecipient?.addressStatus === "missing" ? (
                <p className="text-xs text-muted-foreground" role="status">
                  This contact does not have a saved mailing address yet.
                </p>
              ) : null}
              {selectedRecipient?.sourceType === "vendor" ? (
                <p className="text-xs text-muted-foreground" role="status">
                  This is a company record. Add the individual recipient&apos;s
                  first and last name below.
                </p>
              ) : null}
              {recipientOptionsError ? (
                <p className="text-xs text-destructive" role="status">
                  {recipientOptionsError} Enter the recipient manually for now.
                </p>
              ) : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <CardInput id="card-first-name" label="First name" value={recipient.firstName} onChange={(value) => updateRecipient("firstName", value)} autoComplete="given-name" />
              <CardInput id="card-last-name" label="Last name" value={recipient.lastName} onChange={(value) => updateRecipient("lastName", value)} autoComplete="family-name" />
            </div>
            <CardInput id="card-business" label="Business name (optional)" value={recipient.businessName} onChange={(value) => updateRecipient("businessName", value)} autoComplete="organization" />
            <CardInput id="card-address-1" label="Street address" value={recipient.address1} onChange={(value) => updateRecipient("address1", value)} autoComplete="address-line1" />
            <CardInput id="card-address-2" label="Unit or suite (optional)" value={recipient.address2} onChange={(value) => updateRecipient("address2", value)} autoComplete="address-line2" />
            <div className="grid gap-3 sm:grid-cols-[1fr_6rem_8rem]">
              <CardInput id="card-city" label="City" value={recipient.city} onChange={(value) => updateRecipient("city", value)} autoComplete="address-level2" />
              <CardInput id="card-state" label="State" value={recipient.state} onChange={(value) => updateRecipient("state", value.toUpperCase())} autoComplete="address-level1" maxLength={2} />
              <CardInput id="card-zip" label="ZIP code" value={recipient.postalCode} onChange={(value) => updateRecipient("postalCode", value)} autoComplete="postal-code" maxLength={10} />
            </div>
          </fieldset>
        </div>

        {error ? <p className="text-sm text-destructive" role="status">{error}</p> : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
            Close
          </Button>
          <Button
            type="button"
            onClick={() => void submit()}
            disabled={
              submitting ||
              cardId === null ||
              message.trim().length < 3 ||
              wishes.trim().length === 0
            }
          >
            <IconMailPlus className="size-4" />
            {submitting ? "Submitting…" : "Submit for approval"}
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
  placeholder,
}: {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly autoComplete: string
  readonly maxLength?: number
  readonly placeholder?: string
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
        placeholder={placeholder}
      />
    </div>
  )
}

function recipientTypeFromValue(value: string): GreetingCardRecipientType {
  return RECIPIENT_TYPE_OPTIONS.find((option) => option.value === value)?.value ?? "other"
}

function recipientComboboxOption(option: GreetingCardRecipientOption): {
  readonly value: string
  readonly label: string
  readonly description: string
  readonly keywords: string
} {
  const sourceLabel = recipientSourceLabel(option)
  const addressLabel =
    option.addressStatus === "complete"
      ? "mailing address saved"
      : option.addressStatus === "partial"
        ? "address needs review"
        : "no mailing address"
  const companyLabel =
    option.companyName && option.companyName !== option.displayName
      ? ` · ${option.companyName}`
      : ""
  return {
    value: option.id,
    label: option.displayName,
    description: `${sourceLabel}${companyLabel} · ${addressLabel}`,
    keywords: `${option.companyName ?? ""} ${sourceLabel}`,
  }
}

function recipientSourceLabel(option: GreetingCardRecipientOption): string {
  switch (option.sourceType) {
    case "customer":
      return "Client"
    case "vendor":
      return option.recipientType === "subcontractor"
        ? "Subcontractor company"
        : "Vendor company"
    case "vendor_contact":
      return option.recipientType === "subcontractor"
        ? "Subcontractor contact"
        : "Vendor contact"
    case "team":
      return "Employee"
  }
}
