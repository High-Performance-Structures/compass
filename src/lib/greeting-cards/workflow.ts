export type GreetingCardCatalogItem = {
  readonly id: number
  readonly name: string
  readonly description: string
  readonly coverUrl: string | null
  readonly categoryName: string
  readonly price: number | null
  readonly characters: number | null
}

export type GreetingCardRecipientType =
  | "client"
  | "subcontractor"
  | "supplier"
  | "employee"
  | "other"

export type GreetingCardRequestStatus =
  | "pending_approval"
  | "approved"
  | "submitting"
  | "submitted"
  | "cancelling"
  | "cancelled"
  | "rejected"
  | "needs_attention"

export type GreetingCardRecipient = {
  readonly firstName: string
  readonly lastName: string
  readonly businessName: string
  readonly address1: string
  readonly address2: string
  readonly city: string
  readonly state: string
  readonly postalCode: string
}

export type GreetingCardRequest = {
  readonly id: string
  readonly status: GreetingCardRequestStatus
  readonly providerOrderId: string | null
  readonly providerCardId: string
  readonly cardName: string
  readonly cardPriceCents: number | null
  readonly recipientType: GreetingCardRecipientType
  readonly occasion: string | null
  readonly message: string
  readonly wishes: string
  readonly recipient: GreetingCardRecipient
  readonly requestedByName: string
  readonly requestedByCurrentUser: boolean
  readonly approvalNote: string | null
  readonly providerError: string | null
  readonly approvedAt: string | null
  readonly rejectedAt: string | null
  readonly releasedAt: string | null
  readonly submittedAt: string | null
  readonly cancelledAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export type SubmitGreetingCardRequestInput = {
  readonly cardId: number
  readonly recipientType: GreetingCardRecipientType
  readonly occasion?: string
  readonly message: string
  readonly wishes: string
  readonly recipient: {
    readonly firstName: string
    readonly lastName: string
    readonly businessName?: string
    readonly address1: string
    readonly address2?: string
    readonly city: string
    readonly state: string
    readonly postalCode: string
  }
}

export type ValidatedGreetingCardRequest = {
  readonly cardId: number
  readonly recipientType: GreetingCardRecipientType
  readonly occasion: string
  readonly message: string
  readonly wishes: string
  readonly recipient: GreetingCardRecipient
}

type ValidationResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: string }

const MAX_MESSAGE_LENGTH = 1_200
const MAX_WISHES_LENGTH = 240
const MAX_SHORT_FIELD_LENGTH = 100
const MAX_ADDRESS_LENGTH = 160
const RECIPIENT_TYPES: readonly GreetingCardRecipientType[] = [
  "client",
  "subcontractor",
  "supplier",
  "employee",
  "other",
]

export function validateGreetingCardRequest(
  input: SubmitGreetingCardRequestInput,
): ValidationResult<ValidatedGreetingCardRequest> {
  const occasion = cleanText(input.occasion ?? "", MAX_SHORT_FIELD_LENGTH) ?? ""
  const message = cleanText(input.message, MAX_MESSAGE_LENGTH)
  const wishes = cleanText(input.wishes, MAX_WISHES_LENGTH)
  const firstName = cleanText(input.recipient.firstName, MAX_SHORT_FIELD_LENGTH)
  const lastName = cleanText(input.recipient.lastName, MAX_SHORT_FIELD_LENGTH)
  const businessName =
    cleanText(input.recipient.businessName ?? "", MAX_SHORT_FIELD_LENGTH) ?? ""
  const address1 = cleanText(input.recipient.address1, MAX_ADDRESS_LENGTH)
  const address2 =
    cleanText(input.recipient.address2 ?? "", MAX_ADDRESS_LENGTH) ?? ""
  const city = cleanText(input.recipient.city, MAX_SHORT_FIELD_LENGTH)
  const state = cleanText(input.recipient.state, 2)?.toUpperCase() ?? null
  const postalCode = cleanText(input.recipient.postalCode, 10)

  if (!Number.isInteger(input.cardId) || input.cardId <= 0) {
    return { success: false, error: "Choose a Handwrytten card." }
  }
  if (!RECIPIENT_TYPES.includes(input.recipientType)) {
    return { success: false, error: "Choose a recipient type." }
  }
  if (!message || message.length < 3) {
    return { success: false, error: "Write a card message of at least 3 characters." }
  }
  if (!wishes) return { success: false, error: "Add a closing for the card." }
  if (!firstName || !lastName) {
    return { success: false, error: "Add the recipient's first and last name." }
  }
  if (!address1 || !city || !state || !postalCode) {
    return { success: false, error: "Complete the recipient's mailing address." }
  }
  if (!/^[A-Z]{2}$/.test(state)) {
    return { success: false, error: "Use a two-letter US state abbreviation." }
  }
  if (!/^\d{5}(?:-\d{4})?$/.test(postalCode)) {
    return { success: false, error: "Use a valid US ZIP code." }
  }

  return {
    success: true,
    data: {
      cardId: input.cardId,
      recipientType: input.recipientType,
      occasion,
      message,
      wishes,
      recipient: {
        firstName,
        lastName,
        businessName,
        address1,
        address2,
        city,
        state,
        postalCode,
      },
    },
  }
}

export function buildNewGreetingCardRequest(input: {
  readonly id: string
  readonly validated: ValidatedGreetingCardRequest
  readonly cardName: string
  readonly cardPriceCents: number | null
  readonly requestedByName: string
  readonly now: string
}): GreetingCardRequest {
  return {
    id: input.id,
    status: "pending_approval",
    providerOrderId: null,
    providerCardId: String(input.validated.cardId),
    cardName: input.cardName,
    cardPriceCents: input.cardPriceCents,
    recipientType: input.validated.recipientType,
    occasion: input.validated.occasion || null,
    message: input.validated.message,
    wishes: input.validated.wishes,
    recipient: input.validated.recipient,
    requestedByName: input.requestedByName,
    requestedByCurrentUser: true,
    approvalNote: null,
    providerError: null,
    approvedAt: null,
    rejectedAt: null,
    releasedAt: null,
    submittedAt: null,
    cancelledAt: null,
    createdAt: input.now,
    updatedAt: input.now,
  }
}

export function normalizeGreetingCardRecipientType(
  value: string,
): GreetingCardRecipientType {
  return RECIPIENT_TYPES.find((type) => type === value) ?? "other"
}

export function normalizeGreetingCardRequestStatus(
  value: string,
): GreetingCardRequestStatus {
  switch (value) {
    case "pending_approval":
    case "approved":
    case "submitting":
    case "submitted":
    case "cancelling":
    case "cancelled":
    case "rejected":
    case "needs_attention":
      return value
    default:
      return "needs_attention"
  }
}

function cleanText(value: string, maxLength: number): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : null
}
