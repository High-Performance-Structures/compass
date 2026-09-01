"use server"

import { and, desc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import {
  cherishCardFulfillments,
  cherishPulseResponses,
} from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import {
  createHandwryttenClient,
  type HandwryttenAddress,
} from "@/lib/handwrytten/client"
import { getHandwryttenConfig } from "@/lib/handwrytten/config"
import { requireOrg } from "@/lib/org-scope"
import { canUseExecutiveAdmin } from "@/lib/permissions"

export type CherishCardCatalogItem = {
  readonly id: number
  readonly name: string
  readonly description: string
  readonly coverUrl: string | null
  readonly categoryName: string
  readonly price: number | null
  readonly characters: number | null
}

export type CherishCardStatus =
  | "submitting"
  | "submitted"
  | "cancelling"
  | "cancelled"
  | "failed"
  | "needs_attention"

export type CherishCardFulfillment = {
  readonly id: string
  readonly responseId: string
  readonly provider: "handwrytten"
  readonly deliveryMethod: "physical_mail"
  readonly providerOrderId: string | null
  readonly status: CherishCardStatus
  readonly providerCardId: string
  readonly cardName: string
  readonly recipientName: string
  readonly providerError: string | null
  readonly submittedAt: string | null
  readonly cancelledAt: string | null
  readonly createdAt: string
}

export type SendCherishCardInput = {
  readonly responseId: string
  readonly cardId: number
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

type ActionResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: string }

type FulfillmentRow = {
  readonly id: string
  readonly responseId: string
  readonly provider: string
  readonly deliveryMethod: string
  readonly providerOrderId: string | null
  readonly status: string
  readonly providerCardId: string
  readonly cardName: string
  readonly recipientFirstName: string
  readonly recipientLastName: string
  readonly providerError: string | null
  readonly submittedAt: string | null
  readonly cancelledAt: string | null
  readonly createdAt: string
}

const MAX_MESSAGE_LENGTH = 1_200
const MAX_WISHES_LENGTH = 240
const MAX_SHORT_FIELD_LENGTH = 100
const MAX_ADDRESS_LENGTH = 160

export async function getCherishCardCatalog(): Promise<
  ActionResult<readonly CherishCardCatalogItem[]>
> {
  try {
    const user = await requireAuth()
    if (!canUseExecutiveAdmin(user)) return executiveAccessError()

    const { env } = await getCloudflareContext()
    const config = getHandwryttenConfig(env)
    if (!config.success) return configurationError(config.missingKeys)

    const result = await createHandwryttenClient({
      apiKey: config.data.apiKey,
    }).listCards()
    if (!result.success) return { success: false, error: result.error }

    return {
      success: true,
      data: [...result.data].sort((left, right) =>
        `${left.categoryName} ${left.name}`.localeCompare(
          `${right.categoryName} ${right.name}`,
        ),
      ),
    }
  } catch (error) {
    return actionError(error, "Unable to load the Handwrytten card catalog.")
  }
}

export async function getCherishCardFulfillments(): Promise<
  ActionResult<readonly CherishCardFulfillment[]>
> {
  try {
    const user = await requireAuth()
    if (!canUseExecutiveAdmin(user)) return executiveAccessError()
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    if (!env?.DB) return storageError()

    const rows = await getDb(env.DB)
      .select(fulfillmentSelection())
      .from(cherishCardFulfillments)
      .where(eq(cherishCardFulfillments.organizationId, organizationId))
      .orderBy(desc(cherishCardFulfillments.createdAt))
      .limit(100)

    return { success: true, data: rows.map(rowToFulfillment) }
  } catch (error) {
    return actionError(error, "Unable to load CHERISH card fulfillment.")
  }
}

export async function sendCherishCard(
  input: SendCherishCardInput,
): Promise<ActionResult<CherishCardFulfillment>> {
  try {
    const user = await requireAuth()
    if (!canUseExecutiveAdmin(user)) return executiveAccessError()
    if (isDemoUser(user.id)) return { success: false, error: "DEMO_READ_ONLY" }

    const validated = validateSendInput(input)
    if (!validated.success) return validated

    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    if (!env?.DB) return storageError()

    const config = getHandwryttenConfig(env)
    if (!config.success) return configurationError(config.missingKeys)

    const db = getDb(env.DB)
    const recognitionRows = await db
      .select({ id: cherishPulseResponses.id })
      .from(cherishPulseResponses)
      .where(
        and(
          eq(cherishPulseResponses.id, validated.data.responseId),
          eq(cherishPulseResponses.organizationId, organizationId),
          eq(cherishPulseResponses.visibility, "team"),
          eq(cherishPulseResponses.reviewStatus, "approved"),
        ),
      )
      .limit(1)
    if (!recognitionRows[0]) {
      return {
        success: false,
        error: "Approve this team recognition before mailing a card.",
      }
    }

    const handwrytten = createHandwryttenClient({ apiKey: config.data.apiKey })
    const catalogResult = await handwrytten.listCards()
    if (!catalogResult.success) {
      return { success: false, error: catalogResult.error }
    }
    const selectedCard = catalogResult.data.find(
      (card) => card.id === validated.data.cardId,
    )
    if (!selectedCard) {
      return { success: false, error: "Choose an available Handwrytten card." }
    }
    if (
      selectedCard.characters !== null &&
      selectedCard.characters > 0 &&
      validated.data.message.length > selectedCard.characters
    ) {
      return {
        success: false,
        error: `This card allows ${selectedCard.characters} message characters.`,
      }
    }

    const existingRows = await db
      .select({ id: cherishCardFulfillments.id, status: cherishCardFulfillments.status })
      .from(cherishCardFulfillments)
      .where(
        and(
          eq(cherishCardFulfillments.organizationId, organizationId),
          eq(cherishCardFulfillments.responseId, validated.data.responseId),
        ),
      )
      .limit(1)
    const existing = existingRows[0]
    const fulfillmentId = existing?.id ?? crypto.randomUUID()
    const now = new Date().toISOString()
    const values = fulfillmentValues({
      input: validated.data,
      fulfillmentId,
      organizationId,
      userId: user.id,
      cardName: selectedCard.name,
      now,
    })

    if (existing) {
      if (existing.status !== "failed") {
        return {
          success: false,
          error: existingFulfillmentMessage(existing.status),
        }
      }

      const claimed = await db
        .update(cherishCardFulfillments)
        .set({
          ...values,
          providerOrderId: null,
          status: "submitting",
          providerError: null,
          submittedAt: null,
          cancelledAt: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(cherishCardFulfillments.id, existing.id),
            eq(cherishCardFulfillments.organizationId, organizationId),
            eq(cherishCardFulfillments.status, "failed"),
          ),
        )
        .returning({ id: cherishCardFulfillments.id })
      if (!claimed[0]) {
        return { success: false, error: "Another card request is already running." }
      }
    } else {
      await db.insert(cherishCardFulfillments).values(values).run()
    }

    const orderResult = await handwrytten.submitOrder({
      cardId: selectedCard.id,
      message: validated.data.message,
      wishes: validated.data.wishes,
      fontLabel: config.data.fontLabel,
      sender: config.data.sender,
      recipient: recipientAddress(validated.data),
      clientMetadata: fulfillmentId,
    })

    if (!orderResult.success) {
      const status =
        orderResult.retrySafety === "safe" ? "failed" : "needs_attention"
      await db
        .update(cherishCardFulfillments)
        .set({
          status,
          providerError: truncate(orderResult.error, 500),
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(cherishCardFulfillments.id, fulfillmentId),
            eq(cherishCardFulfillments.organizationId, organizationId),
          ),
        )
        .run()

      return {
        success: false,
        error:
          status === "failed"
            ? `${orderResult.error} No order was accepted; you can correct the details and retry.`
            : `${orderResult.error} The outcome is uncertain. Check Handwrytten before trying again so two cards are not mailed.`,
      }
    }

    const submittedAt = new Date().toISOString()
    await db
      .update(cherishCardFulfillments)
      .set({
        providerOrderId: String(orderResult.data.orderId),
        status: "submitted",
        providerError: null,
        submittedAt,
        updatedAt: submittedAt,
      })
      .where(
        and(
          eq(cherishCardFulfillments.id, fulfillmentId),
          eq(cherishCardFulfillments.organizationId, organizationId),
        ),
      )
      .run()

    revalidatePath("/dashboard/executive-admin/cherish")
    return {
      success: true,
      data: {
        id: fulfillmentId,
        responseId: validated.data.responseId,
        provider: "handwrytten",
        deliveryMethod: "physical_mail",
        providerOrderId: String(orderResult.data.orderId),
        status: "submitted",
        providerCardId: String(selectedCard.id),
        cardName: selectedCard.name,
        recipientName: recipientName(validated.data.recipient),
        providerError: null,
        submittedAt,
        cancelledAt: null,
        createdAt: now,
      },
    }
  } catch (error) {
    return actionError(error, "Unable to submit the CHERISH card order.")
  }
}

export async function cancelCherishCard(
  fulfillmentId: string,
): Promise<ActionResult<CherishCardFulfillment>> {
  try {
    const user = await requireAuth()
    if (!canUseExecutiveAdmin(user)) return executiveAccessError()
    if (isDemoUser(user.id)) return { success: false, error: "DEMO_READ_ONLY" }

    const id = cleanText(fulfillmentId, 100)
    if (!id) return { success: false, error: "Choose a card order to cancel." }

    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    if (!env?.DB) return storageError()
    const config = getHandwryttenConfig(env)
    if (!config.success) return configurationError(config.missingKeys)

    const db = getDb(env.DB)
    const rows = await db
      .select(fulfillmentSelection())
      .from(cherishCardFulfillments)
      .where(
        and(
          eq(cherishCardFulfillments.id, id),
          eq(cherishCardFulfillments.organizationId, organizationId),
        ),
      )
      .limit(1)
    const row = rows[0]
    if (!row || row.status !== "submitted" || !row.providerOrderId) {
      return {
        success: false,
        error: "Only a submitted card that has not been processed can be cancelled.",
      }
    }

    const providerOrderId = Number(row.providerOrderId)
    if (!Number.isInteger(providerOrderId) || providerOrderId <= 0) {
      return { success: false, error: "The Handwrytten order ID is invalid." }
    }

    const claimed = await db
      .update(cherishCardFulfillments)
      .set({ status: "cancelling", updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(cherishCardFulfillments.id, id),
          eq(cherishCardFulfillments.organizationId, organizationId),
          eq(cherishCardFulfillments.status, "submitted"),
        ),
      )
      .returning({ id: cherishCardFulfillments.id })
    if (!claimed[0]) {
      return { success: false, error: "Another card update is already running." }
    }

    const result = await createHandwryttenClient({
      apiKey: config.data.apiKey,
    }).cancelOrder(providerOrderId)
    if (!result.success) {
      const status =
        result.retrySafety === "safe" ? "submitted" : "needs_attention"
      await db
        .update(cherishCardFulfillments)
        .set({
          status,
          providerError: truncate(result.error, 500),
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(cherishCardFulfillments.id, id),
            eq(cherishCardFulfillments.organizationId, organizationId),
          ),
        )
        .run()
      return {
        success: false,
        error:
          status === "submitted"
            ? `${result.error} It may already be in production or the mail.`
            : `${result.error} Check Handwrytten for the final cancellation state.`,
      }
    }

    const cancelledAt = new Date().toISOString()
    await db
      .update(cherishCardFulfillments)
      .set({
        status: "cancelled",
        providerError: null,
        cancelledAt,
        updatedAt: cancelledAt,
      })
      .where(
        and(
          eq(cherishCardFulfillments.id, id),
          eq(cherishCardFulfillments.organizationId, organizationId),
        ),
      )
      .run()

    revalidatePath("/dashboard/executive-admin/cherish")
    return {
      success: true,
      data: rowToFulfillment({
        ...row,
        status: "cancelled",
        providerError: null,
        cancelledAt,
      }),
    }
  } catch (error) {
    return actionError(error, "Unable to cancel the CHERISH card order.")
  }
}

function validateSendInput(
  input: SendCherishCardInput,
): ActionResult<{
  readonly responseId: string
  readonly cardId: number
  readonly message: string
  readonly wishes: string
  readonly recipient: {
    readonly firstName: string
    readonly lastName: string
    readonly businessName: string
    readonly address1: string
    readonly address2: string
    readonly city: string
    readonly state: string
    readonly postalCode: string
  }
}> {
  const responseId = cleanText(input.responseId, 100)
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

  if (!responseId) return { success: false, error: "Choose a CHERISH recognition." }
  if (!Number.isInteger(input.cardId) || input.cardId <= 0) {
    return { success: false, error: "Choose a Handwrytten card." }
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
      responseId,
      cardId: input.cardId,
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

function cleanText(value: string, maxLength: number): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : null
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength)
}

function recipientName(recipient: {
  readonly firstName: string
  readonly lastName: string
}): string {
  return `${recipient.firstName} ${recipient.lastName}`.trim()
}

function recipientAddress(input: {
  readonly recipient: {
    readonly firstName: string
    readonly lastName: string
    readonly businessName: string
    readonly address1: string
    readonly address2: string
    readonly city: string
    readonly state: string
    readonly postalCode: string
  }
}): HandwryttenAddress {
  return {
    ...input.recipient,
    country: "United States",
  }
}

function fulfillmentValues(input: {
  readonly input: {
    readonly responseId: string
    readonly cardId: number
    readonly message: string
    readonly wishes: string
    readonly recipient: {
      readonly firstName: string
      readonly lastName: string
      readonly businessName: string
      readonly address1: string
      readonly address2: string
      readonly city: string
      readonly state: string
      readonly postalCode: string
    }
  }
  readonly fulfillmentId: string
  readonly organizationId: string
  readonly userId: string
  readonly cardName: string
  readonly now: string
}): typeof cherishCardFulfillments.$inferInsert {
  return {
    id: input.fulfillmentId,
    organizationId: input.organizationId,
    responseId: input.input.responseId,
    createdBy: input.userId,
    provider: "handwrytten",
    deliveryMethod: "physical_mail",
    providerOrderId: null,
    status: "submitting",
    providerCardId: String(input.input.cardId),
    cardName: input.cardName,
    message: input.input.message,
    wishes: input.input.wishes,
    recipientFirstName: input.input.recipient.firstName,
    recipientLastName: input.input.recipient.lastName,
    recipientBusinessName: input.input.recipient.businessName || null,
    recipientAddress1: input.input.recipient.address1,
    recipientAddress2: input.input.recipient.address2 || null,
    recipientCity: input.input.recipient.city,
    recipientState: input.input.recipient.state,
    recipientPostalCode: input.input.recipient.postalCode,
    recipientCountry: "United States",
    providerError: null,
    submittedAt: null,
    cancelledAt: null,
    createdAt: input.now,
    updatedAt: input.now,
  }
}

function fulfillmentSelection(): {
  readonly id: typeof cherishCardFulfillments.id
  readonly responseId: typeof cherishCardFulfillments.responseId
  readonly provider: typeof cherishCardFulfillments.provider
  readonly deliveryMethod: typeof cherishCardFulfillments.deliveryMethod
  readonly providerOrderId: typeof cherishCardFulfillments.providerOrderId
  readonly status: typeof cherishCardFulfillments.status
  readonly providerCardId: typeof cherishCardFulfillments.providerCardId
  readonly cardName: typeof cherishCardFulfillments.cardName
  readonly recipientFirstName: typeof cherishCardFulfillments.recipientFirstName
  readonly recipientLastName: typeof cherishCardFulfillments.recipientLastName
  readonly providerError: typeof cherishCardFulfillments.providerError
  readonly submittedAt: typeof cherishCardFulfillments.submittedAt
  readonly cancelledAt: typeof cherishCardFulfillments.cancelledAt
  readonly createdAt: typeof cherishCardFulfillments.createdAt
} {
  return {
    id: cherishCardFulfillments.id,
    responseId: cherishCardFulfillments.responseId,
    provider: cherishCardFulfillments.provider,
    deliveryMethod: cherishCardFulfillments.deliveryMethod,
    providerOrderId: cherishCardFulfillments.providerOrderId,
    status: cherishCardFulfillments.status,
    providerCardId: cherishCardFulfillments.providerCardId,
    cardName: cherishCardFulfillments.cardName,
    recipientFirstName: cherishCardFulfillments.recipientFirstName,
    recipientLastName: cherishCardFulfillments.recipientLastName,
    providerError: cherishCardFulfillments.providerError,
    submittedAt: cherishCardFulfillments.submittedAt,
    cancelledAt: cherishCardFulfillments.cancelledAt,
    createdAt: cherishCardFulfillments.createdAt,
  }
}

function rowToFulfillment(row: FulfillmentRow): CherishCardFulfillment {
  return {
    id: row.id,
    responseId: row.responseId,
    provider: "handwrytten",
    deliveryMethod: "physical_mail",
    providerOrderId: row.providerOrderId,
    status: normalizeStatus(row.status),
    providerCardId: row.providerCardId,
    cardName: row.cardName,
    recipientName: `${row.recipientFirstName} ${row.recipientLastName}`.trim(),
    providerError: row.providerError,
    submittedAt: row.submittedAt,
    cancelledAt: row.cancelledAt,
    createdAt: row.createdAt,
  }
}

function normalizeStatus(value: string): CherishCardStatus {
  switch (value) {
    case "submitting":
    case "submitted":
    case "cancelling":
    case "cancelled":
    case "failed":
    case "needs_attention":
      return value
    default:
      return "needs_attention"
  }
}

function existingFulfillmentMessage(status: string): string {
  if (status === "submitted") return "A physical card was already ordered for this recognition."
  if (status === "cancelled") return "The physical card for this recognition was cancelled."
  if (status === "needs_attention") {
    return "This card order needs reconciliation in Handwrytten before another attempt."
  }
  return "A physical card request is already being processed for this recognition."
}

function executiveAccessError<T>(): ActionResult<T> {
  return {
    success: false,
    error: "Executive Admin access is required to manage CHERISH cards.",
  }
}

function storageError<T>(): ActionResult<T> {
  return { success: false, error: "Compass storage is not available right now." }
}

function configurationError<T>(missingKeys: readonly string[]): ActionResult<T> {
  return {
    success: false,
    error: `Handwrytten is not configured. Missing: ${missingKeys.join(", ")}.`,
  }
}

function actionError<T>(error: unknown, fallback: string): ActionResult<T> {
  return {
    success: false,
    error: error instanceof Error ? error.message : fallback,
  }
}
