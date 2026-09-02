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

export type GreetingCardDeliveryMethod = "physical_mail" | "digital_email"
export type GreetingCardProvider = "handwrytten" | "compass"

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
  readonly email: string
  readonly address1: string
  readonly address2: string
  readonly city: string
  readonly state: string
  readonly postalCode: string
}

export type GreetingCardGift = {
  readonly provider: "giftbit"
  readonly amountCents: number
  readonly region: "USA"
  readonly campaignUuid: string | null
  readonly status: string | null
}

export type GreetingCardRequest = {
  readonly id: string
  readonly provider: GreetingCardProvider
  readonly deliveryMethod: GreetingCardDeliveryMethod
  readonly status: GreetingCardRequestStatus
  readonly providerOrderId: string | null
  readonly providerCardId: string
  readonly cardName: string
  readonly cardPriceCents: number | null
  readonly gift: GreetingCardGift | null
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

type RecipientInput = {
  readonly firstName: string
  readonly lastName: string
  readonly businessName?: string
  readonly email?: string
  readonly address1?: string
  readonly address2?: string
  readonly city?: string
  readonly state?: string
  readonly postalCode?: string
}

type GreetingCardRequestInputBase = {
  readonly recipientType: GreetingCardRecipientType
  readonly occasion?: string
  readonly message: string
  readonly wishes: string
  readonly recipient: RecipientInput
}

export type SubmitGreetingCardRequestInput = GreetingCardRequestInputBase &
  (
    | {
        readonly deliveryMethod: "physical_mail"
        readonly cardId: number
      }
    | {
        readonly deliveryMethod: "digital_email"
        readonly templateId: string
        readonly giftAmountCents: number | null
      }
  )

type ValidatedGreetingCardRequestBase = {
  readonly recipientType: GreetingCardRecipientType
  readonly occasion: string
  readonly message: string
  readonly wishes: string
  readonly recipient: GreetingCardRecipient
}

export type ValidatedGreetingCardRequest = ValidatedGreetingCardRequestBase &
  (
    | {
        readonly deliveryMethod: "physical_mail"
        readonly cardId: number
      }
    | {
        readonly deliveryMethod: "digital_email"
        readonly templateId: string
        readonly giftAmountCents: number | null
      }
  )

type ValidationResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: string }

const MAX_MESSAGE_LENGTH = 1_200
const MAX_WISHES_LENGTH = 240
const MAX_SHORT_FIELD_LENGTH = 100
const MAX_ADDRESS_LENGTH = 160
const MIN_GIFT_AMOUNT_CENTS = 500
const MAX_GIFT_AMOUNT_CENTS = 50_000
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
  const email = cleanText(input.recipient.email ?? "", 254) ?? ""
  const address1 = cleanText(input.recipient.address1 ?? "", MAX_ADDRESS_LENGTH) ?? ""
  const address2 = cleanText(input.recipient.address2 ?? "", MAX_ADDRESS_LENGTH) ?? ""
  const city = cleanText(input.recipient.city ?? "", MAX_SHORT_FIELD_LENGTH) ?? ""
  const state =
    cleanText(input.recipient.state ?? "", 2)?.toUpperCase() ?? ""
  const postalCode = cleanText(input.recipient.postalCode ?? "", 10) ?? ""

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

  const recipient = {
    firstName,
    lastName,
    businessName,
    email,
    address1,
    address2,
    city,
    state,
    postalCode,
  }
  const common = {
    recipientType: input.recipientType,
    occasion,
    message,
    wishes,
    recipient,
  }

  if (input.deliveryMethod === "physical_mail") {
    if (!Number.isInteger(input.cardId) || input.cardId <= 0) {
      return { success: false, error: "Choose a Handwrytten card." }
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
      data: { ...common, deliveryMethod: "physical_mail", cardId: input.cardId },
    }
  }

  const templateId = cleanText(input.templateId, MAX_SHORT_FIELD_LENGTH)
  if (!templateId) return { success: false, error: "Choose an e-card design." }
  if (!isEmail(email)) {
    return { success: false, error: "Add a valid recipient email address." }
  }
  if (
    input.giftAmountCents !== null &&
    (!Number.isInteger(input.giftAmountCents) ||
      input.giftAmountCents < MIN_GIFT_AMOUNT_CENTS ||
      input.giftAmountCents > MAX_GIFT_AMOUNT_CENTS)
  ) {
    return {
      success: false,
      error: "Gift amounts must be between $5 and $500.",
    }
  }

  return {
    success: true,
    data: {
      ...common,
      deliveryMethod: "digital_email",
      templateId,
      giftAmountCents: input.giftAmountCents,
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
  const isPhysical = input.validated.deliveryMethod === "physical_mail"
  return {
    id: input.id,
    provider: isPhysical ? "handwrytten" : "compass",
    deliveryMethod: input.validated.deliveryMethod,
    status: "pending_approval",
    providerOrderId: null,
    providerCardId: isPhysical
      ? String(input.validated.cardId)
      : input.validated.templateId,
    cardName: input.cardName,
    cardPriceCents: input.cardPriceCents,
    gift:
      !isPhysical && input.validated.giftAmountCents !== null
        ? {
            provider: "giftbit",
            amountCents: input.validated.giftAmountCents,
            region: "USA",
            campaignUuid: null,
            status: null,
          }
        : null,
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

export function normalizeGreetingCardDeliveryMethod(
  value: string,
): GreetingCardDeliveryMethod {
  return value === "digital_email" ? "digital_email" : "physical_mail"
}

export function normalizeGreetingCardProvider(
  value: string,
): GreetingCardProvider {
  return value === "compass" ? "compass" : "handwrytten"
}

function cleanText(value: string, maxLength: number): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : null
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}
