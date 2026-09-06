"use server"

import { and, desc, eq, inArray, isNull } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { refreshSession } from "@workos-inc/authkit-nextjs"

import { getDb } from "@/db"
import { greetingCardRequests, users } from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { isWorkOSConfigured } from "@/lib/auth-config"
import { getCloudflareContext } from "@/lib/db"
import {
  buildEcardEmail,
  ecardUrl,
  getEcardPublicBaseUrl,
} from "@/lib/greeting-cards/ecard-delivery"
import {
  buildNewGreetingCardRequest,
  normalizeGreetingCardDeliveryMethod,
  normalizeGreetingCardProvider,
  normalizeGreetingCardRecipientType,
  normalizeGreetingCardRequestStatus,
  validateGreetingCardRequest,
  type GreetingCardCatalogItem,
  type GreetingCardRequest,
  type GreetingCardRequestStatus,
  type SubmitGreetingCardRequestInput,
} from "@/lib/greeting-cards/workflow"
import { getEcardTemplate } from "@/lib/greeting-cards/templates"
import { sendCompassEmail } from "@/lib/email/compass-email"
import { createGiftbitClient } from "@/lib/giftbit/client"
import { giftbitClaimExpiryDate } from "@/lib/giftbit/claim-window"
import { getGiftbitConfig } from "@/lib/giftbit/config"
import {
  createHandwryttenClient,
  type HandwryttenAddress,
} from "@/lib/handwrytten/client"
import {
  getHandwryttenApiKey,
  getHandwryttenConfig,
} from "@/lib/handwrytten/config"
import { requireOrg } from "@/lib/org-scope"
import {
  canApproveGreetingCards,
  canPrepareGreetingCards,
} from "@/lib/permissions"

export type {
  GreetingCardCatalogItem,
  GreetingCardDeliveryMethod,
  GreetingCardRecipientType,
  GreetingCardRequest,
  GreetingCardRequestStatus,
  SubmitGreetingCardRequestInput,
} from "@/lib/greeting-cards/workflow"

type ActionResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: string }

const MAX_NOTE_LENGTH = 500

export async function refreshGreetingCardSession(): Promise<ActionResult<null>> {
  if (!isWorkOSConfigured()) return { success: true, data: null }
  try {
    const session = await refreshSession()
    return session.user
      ? { success: true, data: null }
      : expiredSessionResult()
  } catch (error) {
    return isExpiredSessionError(error)
      ? expiredSessionResult()
      : actionError(error, "Compass could not refresh your session. Try again.")
  }
}

export async function getGreetingCardCatalog(): Promise<
  ActionResult<readonly GreetingCardCatalogItem[]>
> {
  try {
    const user = await requireAuth()
    if (!canPrepareGreetingCards(user) && !canApproveGreetingCards(user)) {
      return cardAccessError()
    }

    const { env } = await getCloudflareContext()
    const keyResult = getHandwryttenApiKey(env)
    if (!keyResult.success) return configurationError(keyResult.missingKeys)
    const result = await createHandwryttenClient({
      apiKey: keyResult.apiKey,
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

export async function getGreetingCardRequests(): Promise<
  ActionResult<readonly GreetingCardRequest[]>
> {
  try {
    const user = await requireAuth()
    const canApprove = canApproveGreetingCards(user)
    if (!canPrepareGreetingCards(user) && !canApprove) return cardAccessError()
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    if (!env?.DB) return storageError()

    const visibility = canApprove
      ? and(
          eq(greetingCardRequests.organizationId, organizationId),
          isNull(greetingCardRequests.deletedAt),
        )
      : and(
          eq(greetingCardRequests.organizationId, organizationId),
          eq(greetingCardRequests.requestedBy, user.id),
          isNull(greetingCardRequests.deletedAt),
        )
    const rows = await getDb(env.DB)
      .select({
        id: greetingCardRequests.id,
        requestedBy: greetingCardRequests.requestedBy,
        requestedByName: users.displayName,
        requestedByEmail: users.email,
        provider: greetingCardRequests.provider,
        deliveryMethod: greetingCardRequests.deliveryMethod,
        providerOrderId: greetingCardRequests.providerOrderId,
        status: greetingCardRequests.status,
        providerCardId: greetingCardRequests.providerCardId,
        cardName: greetingCardRequests.cardName,
        cardPriceCents: greetingCardRequests.cardPriceCents,
        recipientType: greetingCardRequests.recipientType,
        occasion: greetingCardRequests.occasion,
        message: greetingCardRequests.message,
        wishes: greetingCardRequests.wishes,
        recipientFirstName: greetingCardRequests.recipientFirstName,
        recipientLastName: greetingCardRequests.recipientLastName,
        recipientBusinessName: greetingCardRequests.recipientBusinessName,
        recipientAddress1: greetingCardRequests.recipientAddress1,
        recipientAddress2: greetingCardRequests.recipientAddress2,
        recipientCity: greetingCardRequests.recipientCity,
        recipientState: greetingCardRequests.recipientState,
        recipientPostalCode: greetingCardRequests.recipientPostalCode,
        recipientEmail: greetingCardRequests.recipientEmail,
        giftProvider: greetingCardRequests.giftProvider,
        giftAmountCents: greetingCardRequests.giftAmountCents,
        giftRegion: greetingCardRequests.giftRegion,
        giftCampaignUuid: greetingCardRequests.giftCampaignUuid,
        giftStatus: greetingCardRequests.giftStatus,
        giftExpiresOn: greetingCardRequests.giftExpiresOn,
        approvalNote: greetingCardRequests.approvalNote,
        providerError: greetingCardRequests.providerError,
        approvedAt: greetingCardRequests.approvedAt,
        rejectedAt: greetingCardRequests.rejectedAt,
        releasedAt: greetingCardRequests.releasedAt,
        submittedAt: greetingCardRequests.submittedAt,
        cancelledAt: greetingCardRequests.cancelledAt,
        createdAt: greetingCardRequests.createdAt,
        updatedAt: greetingCardRequests.updatedAt,
      })
      .from(greetingCardRequests)
      .leftJoin(users, eq(greetingCardRequests.requestedBy, users.id))
      .where(visibility)
      .orderBy(desc(greetingCardRequests.createdAt))
      .limit(200)

    return {
      success: true,
      data: rows.map((row) => ({
        id: row.id,
        provider: normalizeGreetingCardProvider(row.provider),
        deliveryMethod: normalizeGreetingCardDeliveryMethod(row.deliveryMethod),
        status: normalizeGreetingCardRequestStatus(row.status),
        providerOrderId: row.providerOrderId,
        providerCardId: row.providerCardId,
        cardName: row.cardName,
        cardPriceCents: row.cardPriceCents,
        gift:
          row.giftProvider === "giftbit" && row.giftAmountCents !== null
            ? {
                provider: "giftbit",
                amountCents: row.giftAmountCents,
                region: "USA",
                campaignUuid: row.giftCampaignUuid,
                status: row.giftStatus,
                expiresOn: row.giftExpiresOn,
              }
            : null,
        recipientType: normalizeGreetingCardRecipientType(row.recipientType),
        occasion: row.occasion,
        message: row.message,
        wishes: row.wishes,
        recipient: {
          firstName: row.recipientFirstName,
          lastName: row.recipientLastName,
          businessName: row.recipientBusinessName ?? "",
          email: row.recipientEmail ?? "",
          address1: row.recipientAddress1,
          address2: row.recipientAddress2 ?? "",
          city: row.recipientCity,
          state: row.recipientState,
          postalCode: row.recipientPostalCode,
        },
        requestedByName:
          row.requestedByName?.trim() ||
          row.requestedByEmail?.trim() ||
          "Former staff member",
        requestedByCurrentUser: row.requestedBy === user.id,
        approvalNote: row.approvalNote,
        providerError: row.providerError,
        approvedAt: row.approvedAt,
        rejectedAt: row.rejectedAt,
        releasedAt: row.releasedAt,
        submittedAt: row.submittedAt,
        cancelledAt: row.cancelledAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
    }
  } catch (error) {
    return actionError(error, "Unable to load greeting-card requests.")
  }
}

export async function submitGreetingCardRequest(
  input: SubmitGreetingCardRequestInput,
): Promise<ActionResult<GreetingCardRequest>> {
  try {
    const user = await requireAuth()
    if (!canPrepareGreetingCards(user) && !canApproveGreetingCards(user)) {
      return cardAccessError()
    }
    const validated = validateGreetingCardRequest(input)
    if (!validated.success) return validated
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    if (!env?.DB) return storageError()

    let cardName: string
    let cardPriceCents: number | null
    let providerCardId: string
    if (validated.data.deliveryMethod === "physical_mail") {
      const selectedCardId = validated.data.cardId
      const keyResult = getHandwryttenApiKey(env)
      if (!keyResult.success) return configurationError(keyResult.missingKeys)
      const catalogResult = await createHandwryttenClient({
        apiKey: keyResult.apiKey,
      }).listCards()
      if (!catalogResult.success) {
        return { success: false, error: catalogResult.error }
      }
      const card = catalogResult.data.find(
        (item) => item.id === selectedCardId,
      )
      if (!card) {
        return { success: false, error: "Choose an available Handwrytten card." }
      }
      if (
        card.characters !== null &&
        card.characters > 0 &&
        validated.data.message.length > card.characters
      ) {
        return {
          success: false,
          error: `This card allows ${card.characters} message characters.`,
        }
      }
      cardName = card.name
      cardPriceCents = card.price === null ? null : Math.round(card.price * 100)
      providerCardId = String(card.id)
    } else {
      const template = getEcardTemplate(validated.data.templateId)
      if (!template) return { success: false, error: "Choose an available e-card design." }
      cardName = template.name
      cardPriceCents = null
      providerCardId = template.id
    }

    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    await getDb(env.DB)
      .insert(greetingCardRequests)
      .values({
        id,
        organizationId,
        requestedBy: user.id,
        provider:
          validated.data.deliveryMethod === "physical_mail"
            ? "handwrytten"
            : "compass",
        deliveryMethod: validated.data.deliveryMethod,
        status: "pending_approval",
        providerCardId,
        cardName,
        cardPriceCents,
        recipientType: validated.data.recipientType,
        occasion: validated.data.occasion || null,
        message: validated.data.message,
        wishes: validated.data.wishes,
        recipientFirstName: validated.data.recipient.firstName,
        recipientLastName: validated.data.recipient.lastName,
        recipientBusinessName: validated.data.recipient.businessName || null,
        recipientAddress1: validated.data.recipient.address1,
        recipientAddress2: validated.data.recipient.address2 || null,
        recipientCity: validated.data.recipient.city,
        recipientState: validated.data.recipient.state,
        recipientPostalCode: validated.data.recipient.postalCode,
        recipientCountry: "United States",
        recipientEmail: validated.data.recipient.email || null,
        giftProvider:
          validated.data.deliveryMethod === "digital_email" &&
          validated.data.giftAmountCents !== null
            ? "giftbit"
            : null,
        giftAmountCents:
          validated.data.deliveryMethod === "digital_email"
            ? validated.data.giftAmountCents
            : null,
        giftRegion:
          validated.data.deliveryMethod === "digital_email" &&
          validated.data.giftAmountCents !== null
            ? "USA"
            : null,
        publicToken:
          validated.data.deliveryMethod === "digital_email"
            ? crypto.randomUUID()
            : null,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    revalidateCards()
    return {
      success: true,
      data: buildNewGreetingCardRequest({
        id,
        validated: validated.data,
        cardName,
        cardPriceCents,
        requestedByName: user.displayName?.trim() || user.email,
        now,
      }),
    }
  } catch (error) {
    return actionError(error, "Unable to submit the greeting-card request.")
  }
}

export async function approveGreetingCardRequest(
  requestId: string,
): Promise<ActionResult<{ readonly id: string; readonly status: "approved" }>> {
  try {
    const user = await requireAuth()
    if (!canApproveGreetingCards(user)) return approvalAccessError()
    const id = cleanText(requestId, 100)
    if (!id) return { success: false, error: "Choose a card request to approve." }
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    if (!env?.DB) return storageError()
    const now = new Date().toISOString()
    const rows = await getDb(env.DB)
      .update(greetingCardRequests)
      .set({
        status: "approved",
        approvedBy: user.id,
        approvedAt: now,
        approvalNote: null,
        providerError: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(greetingCardRequests.id, id),
          eq(greetingCardRequests.organizationId, organizationId),
          eq(greetingCardRequests.status, "pending_approval"),
          isNull(greetingCardRequests.deletedAt),
        ),
      )
      .returning({ id: greetingCardRequests.id })
    if (!rows[0]) {
      return { success: false, error: "This request is no longer awaiting approval." }
    }
    revalidateCards()
    return { success: true, data: { id, status: "approved" } }
  } catch (error) {
    return actionError(error, "Unable to approve the greeting-card request.")
  }
}

export async function rejectGreetingCardRequest(
  requestId: string,
  note: string,
): Promise<ActionResult<{ readonly id: string; readonly status: "rejected" }>> {
  try {
    const user = await requireAuth()
    if (!canApproveGreetingCards(user)) return approvalAccessError()
    const id = cleanText(requestId, 100)
    const approvalNote = cleanText(note, MAX_NOTE_LENGTH)
    if (!id) return { success: false, error: "Choose a card request to reject." }
    if (!approvalNote) {
      return { success: false, error: "Add a short reason so the requester knows what to change." }
    }
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    if (!env?.DB) return storageError()
    const now = new Date().toISOString()
    const rows = await getDb(env.DB)
      .update(greetingCardRequests)
      .set({
        status: "rejected",
        rejectedBy: user.id,
        rejectedAt: now,
        approvalNote,
        updatedAt: now,
      })
      .where(
        and(
          eq(greetingCardRequests.id, id),
          eq(greetingCardRequests.organizationId, organizationId),
          inArray(greetingCardRequests.status, ["pending_approval", "approved"]),
          isNull(greetingCardRequests.deletedAt),
        ),
      )
      .returning({ id: greetingCardRequests.id })
    if (!rows[0]) {
      return { success: false, error: "This request can no longer be rejected." }
    }
    revalidateCards()
    return { success: true, data: { id, status: "rejected" } }
  } catch (error) {
    return actionError(error, "Unable to reject the greeting-card request.")
  }
}

export async function releaseGreetingCardRequest(
  requestId: string,
): Promise<ActionResult<{ readonly id: string; readonly status: GreetingCardRequestStatus }>> {
  try {
    const user = await requireAuth()
    if (!canApproveGreetingCards(user)) return approvalAccessError()
    const id = cleanText(requestId, 100)
    if (!id) return { success: false, error: "Choose an approved card request." }
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    if (!env?.DB) return storageError()
    const db = getDb(env.DB)
    const rows = await db
      .select()
      .from(greetingCardRequests)
      .where(
        and(
          eq(greetingCardRequests.id, id),
          eq(greetingCardRequests.organizationId, organizationId),
          eq(greetingCardRequests.status, "approved"),
          isNull(greetingCardRequests.deletedAt),
        ),
      )
      .limit(1)
    const row = rows[0]
    if (!row) return { success: false, error: "Approve this request before releasing it." }

    if (row.deliveryMethod === "digital_email") {
      const template = getEcardTemplate(row.providerCardId)
      if (!template || !row.publicToken || !row.recipientEmail) {
        return { success: false, error: "The saved e-card delivery details are invalid." }
      }
      const publicBaseUrl = getEcardPublicBaseUrl(env)
      if (!publicBaseUrl.success) return publicBaseUrl
      const giftConfig =
        row.giftAmountCents === null ? null : getGiftbitConfig(env)
      if (giftConfig && !giftConfig.success) return giftConfig
      if (giftConfig?.success && !giftConfig.data.orderingEnabled) {
        return {
          success: false,
          error: "Giftbit production ordering is paused. No reward was purchased.",
        }
      }

      const releasedAt = new Date().toISOString()
      // Persist the planned date before calling Giftbit so an uncertain response
      // can be retried with the same idempotency key and the same request body.
      const plannedGiftExpiresOn =
        row.giftAmountCents === null
          ? null
          : row.giftExpiresOn ?? giftbitClaimExpiryDate(releasedAt)
      const claimed = await db
        .update(greetingCardRequests)
        .set({
          status: "submitting",
          releasedBy: user.id,
          releasedAt,
          giftExpiresOn: plannedGiftExpiresOn,
          providerError: null,
          updatedAt: releasedAt,
        })
        .where(
          and(
            eq(greetingCardRequests.id, id),
            eq(greetingCardRequests.organizationId, organizationId),
            eq(greetingCardRequests.status, "approved"),
            isNull(greetingCardRequests.deletedAt),
          ),
        )
        .returning({ id: greetingCardRequests.id })
      if (!claimed[0]) {
        return { success: false, error: "Another release action is already running." }
      }

      let campaignUuid = row.giftCampaignUuid
      let giftClaimUrl = row.giftClaimUrl
      let giftStatus = row.giftStatus
      let giftExpiresOn = plannedGiftExpiresOn
      if (row.giftAmountCents !== null && giftConfig?.success) {
        const expiresOn = plannedGiftExpiresOn ?? giftbitClaimExpiryDate(releasedAt)
        giftExpiresOn = expiresOn
        const giftResult = await createGiftbitClient({
          apiKey: giftConfig.data.apiKey,
          baseUrl: giftConfig.data.baseUrl,
        }).createDirectLink({
          id: giftbitOrderId(id),
          priceInCents: row.giftAmountCents,
          region: "USA",
          expiresOn,
        })
        if (!giftResult.success) {
          await restoreReleasedRequest({
            db,
            id,
            organizationId,
            status: giftResult.retrySafety === "safe" ? "approved" : "needs_attention",
            error: giftResult.error,
          })
          revalidateCards()
          return { success: false, error: giftResult.error }
        }
        campaignUuid = giftResult.data.campaignUuid
        giftClaimUrl = giftResult.data.claimUrl
        giftStatus = giftResult.data.campaignStatus
        await db
          .update(greetingCardRequests)
          .set({
            giftCampaignUuid: campaignUuid,
            giftClaimUrl,
            giftStatus,
            giftExpiresOn,
            updatedAt: new Date().toISOString(),
          })
          .where(
            and(
              eq(greetingCardRequests.id, id),
              eq(greetingCardRequests.organizationId, organizationId),
              eq(greetingCardRequests.status, "submitting"),
            ),
          )
          .run()
      }

      const deliveryUrl = ecardUrl(publicBaseUrl.data, row.publicToken)
      const email = buildEcardEmail({
        recipientFirstName: row.recipientFirstName,
        cardName: template.name,
        occasion: row.occasion,
        giftAmountCents: row.giftAmountCents,
        url: deliveryUrl,
      })
      let emailResult: Awaited<ReturnType<typeof sendCompassEmail>>
      try {
        emailResult = await sendCompassEmail({
          env,
          db,
          organizationId,
          to: [row.recipientEmail],
          replyTo: "compass@hps-colorado.com",
          subject: email.subject,
          text: email.text,
          html: email.html,
        })
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "E-card email delivery was not confirmed."
        await restoreReleasedRequest({
          db,
          id,
          organizationId,
          status: "needs_attention",
          error: message,
        })
        revalidateCards()
        return {
          success: false,
          error: `${message} Check the recipient's inbox before trying another action.`,
        }
      }
      if (emailResult.status !== "sent") {
        const giftWasPurchased = giftClaimUrl !== null
        await restoreReleasedRequest({
          db,
          id,
          organizationId,
          status: giftWasPurchased ? "needs_attention" : "approved",
          error: emailResult.error ?? "E-card email delivery is not configured.",
        })
        revalidateCards()
        return {
          success: false,
          error: giftWasPurchased
            ? `${emailResult.error ?? "E-card email delivery is not configured."} The purchased gift remains available to cancel from this queue.`
            : emailResult.error ?? "E-card email delivery is not configured.",
        }
      }

      const submittedAt = new Date().toISOString()
      await db
        .update(greetingCardRequests)
        .set({
          providerOrderId: campaignUuid ?? emailResult.providerMessageId,
          giftCampaignUuid: campaignUuid,
          giftClaimUrl,
          giftStatus,
          giftExpiresOn,
          emailProvider: emailResult.provider,
          emailProviderMessageId: emailResult.providerMessageId,
          status: "submitted",
          providerError: null,
          submittedAt,
          updatedAt: submittedAt,
        })
        .where(
          and(
            eq(greetingCardRequests.id, id),
            eq(greetingCardRequests.organizationId, organizationId),
            eq(greetingCardRequests.status, "submitting"),
          ),
        )
        .run()
      revalidateCards()
      return { success: true, data: { id, status: "submitted" } }
    }

    const config = getHandwryttenConfig(env)
    if (!config.success) return configurationError(config.missingKeys)
    const cardId = Number(row.providerCardId)
    if (!Number.isInteger(cardId) || cardId <= 0) {
      return { success: false, error: "The saved Handwrytten card is invalid." }
    }
    const handwrytten = createHandwryttenClient({ apiKey: config.data.apiKey })
    const catalogResult = await handwrytten.listCards()
    if (!catalogResult.success) return { success: false, error: catalogResult.error }
    const card = catalogResult.data.find((item) => item.id === cardId)
    if (!card) return { success: false, error: "This card is no longer available in Handwrytten." }
    if (
      card.characters !== null &&
      card.characters > 0 &&
      row.message.length > card.characters
    ) {
      return { success: false, error: `This card now allows ${card.characters} message characters.` }
    }

    const releasedAt = new Date().toISOString()
    const claimed = await db
      .update(greetingCardRequests)
      .set({
        status: "submitting",
        releasedBy: user.id,
        releasedAt,
        providerError: null,
        updatedAt: releasedAt,
      })
      .where(
        and(
          eq(greetingCardRequests.id, id),
          eq(greetingCardRequests.organizationId, organizationId),
          eq(greetingCardRequests.status, "approved"),
          isNull(greetingCardRequests.deletedAt),
        ),
      )
      .returning({ id: greetingCardRequests.id })
    if (!claimed[0]) return { success: false, error: "Another release action is already running." }

    const result = await handwrytten.submitOrder({
      cardId,
      message: row.message,
      wishes: row.wishes,
      fontLabel: config.data.fontLabel,
      sender: config.data.sender,
      recipient: rowRecipientAddress(row),
      clientMetadata: id,
    })
    if (!result.success) {
      const status: GreetingCardRequestStatus =
        result.retrySafety === "safe" ? "approved" : "needs_attention"
      await db
        .update(greetingCardRequests)
        .set({
          status,
          providerError: truncate(result.error, 500),
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(greetingCardRequests.id, id),
            eq(greetingCardRequests.organizationId, organizationId),
            eq(greetingCardRequests.status, "submitting"),
          ),
        )
        .run()
      revalidateCards()
      return {
        success: false,
        error:
          status === "approved"
            ? `${result.error} No order was accepted; the approved request can be released again.`
            : `${result.error} The outcome is uncertain. Check Handwrytten before taking another action.`,
      }
    }

    const submittedAt = new Date().toISOString()
    await db
      .update(greetingCardRequests)
      .set({
        providerOrderId: String(result.data.orderId),
        status: "submitted",
        providerError: null,
        submittedAt,
        updatedAt: submittedAt,
      })
      .where(
        and(
          eq(greetingCardRequests.id, id),
          eq(greetingCardRequests.organizationId, organizationId),
          eq(greetingCardRequests.status, "submitting"),
        ),
      )
      .run()
    revalidateCards()
    return { success: true, data: { id, status: "submitted" } }
  } catch (error) {
    return actionError(error, "Unable to release the greeting-card order.")
  }
}

export async function cancelGreetingCardRequest(
  requestId: string,
): Promise<ActionResult<{ readonly id: string; readonly status: GreetingCardRequestStatus }>> {
  try {
    const user = await requireAuth()
    if (!canApproveGreetingCards(user)) return approvalAccessError()
    const id = cleanText(requestId, 100)
    if (!id) return { success: false, error: "Choose a card order to cancel." }
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    if (!env?.DB) return storageError()
    const db = getDb(env.DB)
    const rows = await db
      .select({
        deliveryMethod: greetingCardRequests.deliveryMethod,
        providerOrderId: greetingCardRequests.providerOrderId,
        status: greetingCardRequests.status,
        giftAmountCents: greetingCardRequests.giftAmountCents,
        giftCampaignUuid: greetingCardRequests.giftCampaignUuid,
        giftRewardUuid: greetingCardRequests.giftRewardUuid,
      })
      .from(greetingCardRequests)
      .where(
        and(
          eq(greetingCardRequests.id, id),
          eq(greetingCardRequests.organizationId, organizationId),
          inArray(greetingCardRequests.status, ["submitted", "needs_attention"]),
          isNull(greetingCardRequests.deletedAt),
        ),
      )
      .limit(1)
    const row = rows[0]
    if (
      !row ||
      (row.status === "needs_attention" && row.deliveryMethod !== "digital_email")
    ) {
      return { success: false, error: "Only a submitted card can be cancelled." }
    }

    if (row.deliveryMethod === "digital_email") {
      const previousStatus: "submitted" | "needs_attention" =
        row.status === "needs_attention" ? "needs_attention" : "submitted"
      const giftConfig =
        row.giftAmountCents === null ? null : getGiftbitConfig(env)
      if (giftConfig && !giftConfig.success) return giftConfig
      const now = new Date().toISOString()
      const claimed = await db
        .update(greetingCardRequests)
        .set({ status: "cancelling", updatedAt: now })
        .where(
          and(
            eq(greetingCardRequests.id, id),
            eq(greetingCardRequests.organizationId, organizationId),
            eq(greetingCardRequests.status, previousStatus),
          ),
        )
        .returning({ id: greetingCardRequests.id })
      if (!claimed[0]) {
        return { success: false, error: "Another card action is already running." }
      }

      let rewardUuid = row.giftRewardUuid
      if (row.giftAmountCents !== null && giftConfig?.success) {
        const giftbit = createGiftbitClient({
          apiKey: giftConfig.data.apiKey,
          baseUrl: giftConfig.data.baseUrl,
        })
        if (!rewardUuid) {
          if (!row.giftCampaignUuid) {
            await restoreReleasedRequest({
              db,
              id,
              organizationId,
              status: "needs_attention",
              error: "The Giftbit campaign identifier is missing.",
              fromStatus: "cancelling",
            })
            return { success: false, error: "The Giftbit campaign identifier is missing." }
          }
          const rewards = await giftbit.listRewards(row.giftCampaignUuid)
          if (!rewards.success || !rewards.data[0]) {
            const error = rewards.success
              ? "Giftbit has not returned the reward record yet. Try cancellation again shortly."
              : rewards.error
            await restoreReleasedRequest({
              db,
              id,
              organizationId,
              status: rewards.success || rewards.retrySafety === "safe"
                ? previousStatus
                : "needs_attention",
              error,
              fromStatus: "cancelling",
            })
            revalidateCards()
            return { success: false, error }
          }
          rewardUuid = rewards.data[0].uuid
          if (rewards.data[0].status === "REDEEMED") {
            await restoreReleasedRequest({
              db,
              id,
              organizationId,
              status: previousStatus,
              error: "This Giftbit reward has already been redeemed and cannot be cancelled.",
              fromStatus: "cancelling",
            })
            revalidateCards()
            return {
              success: false,
              error: "This Giftbit reward has already been redeemed and cannot be cancelled.",
            }
          }
        }
        const cancelled = await giftbit.cancelReward(rewardUuid)
        if (!cancelled.success) {
          await restoreReleasedRequest({
            db,
            id,
            organizationId,
            status: cancelled.retrySafety === "safe" ? previousStatus : "needs_attention",
            error: cancelled.error,
            fromStatus: "cancelling",
          })
          revalidateCards()
          return { success: false, error: cancelled.error }
        }
      }

      const cancelledAt = new Date().toISOString()
      await db
        .update(greetingCardRequests)
        .set({
          status: "cancelled",
          giftRewardUuid: rewardUuid,
          giftStatus: row.giftAmountCents === null ? null : "GIVER_CANCELLED",
          providerError: null,
          cancelledAt,
          updatedAt: cancelledAt,
        })
        .where(
          and(
            eq(greetingCardRequests.id, id),
            eq(greetingCardRequests.organizationId, organizationId),
            eq(greetingCardRequests.status, "cancelling"),
          ),
        )
        .run()
      revalidateCards()
      return { success: true, data: { id, status: "cancelled" } }
    }

    const config = getHandwryttenApiKey(env)
    if (!config.success) return configurationError(config.missingKeys)
    const providerOrderId = Number(row.providerOrderId)
    if (!Number.isInteger(providerOrderId) || providerOrderId <= 0) {
      return { success: false, error: "Only a submitted card can be cancelled." }
    }
    const now = new Date().toISOString()
    const claimed = await db
      .update(greetingCardRequests)
      .set({ status: "cancelling", updatedAt: now })
      .where(
        and(
          eq(greetingCardRequests.id, id),
          eq(greetingCardRequests.organizationId, organizationId),
          eq(greetingCardRequests.status, "submitted"),
        ),
      )
      .returning({ id: greetingCardRequests.id })
    if (!claimed[0]) return { success: false, error: "Another card action is already running." }

    const result = await createHandwryttenClient({
      apiKey: config.apiKey,
    }).cancelOrder(providerOrderId)
    if (!result.success) {
      const status: GreetingCardRequestStatus =
        result.retrySafety === "safe" ? "submitted" : "needs_attention"
      await db
        .update(greetingCardRequests)
        .set({
          status,
          providerError: truncate(result.error, 500),
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(greetingCardRequests.id, id),
            eq(greetingCardRequests.organizationId, organizationId),
            eq(greetingCardRequests.status, "cancelling"),
          ),
        )
        .run()
      revalidateCards()
      return { success: false, error: result.error }
    }

    const cancelledAt = new Date().toISOString()
    await db
      .update(greetingCardRequests)
      .set({
        status: "cancelled",
        providerError: null,
        cancelledAt,
        updatedAt: cancelledAt,
      })
      .where(
        and(
          eq(greetingCardRequests.id, id),
          eq(greetingCardRequests.organizationId, organizationId),
          eq(greetingCardRequests.status, "cancelling"),
        ),
      )
      .run()
    revalidateCards()
    return { success: true, data: { id, status: "cancelled" } }
  } catch (error) {
    return actionError(error, "Unable to cancel the greeting-card order.")
  }
}

export async function deleteGreetingCardRequest(
  requestId: string,
): Promise<ActionResult<{ readonly id: string }>> {
  try {
    const user = await requireAuth()
    const canApprove = canApproveGreetingCards(user)
    if (!canPrepareGreetingCards(user) && !canApprove) return cardAccessError()
    const id = cleanText(requestId, 100)
    if (!id) return { success: false, error: "Choose a card request to remove." }
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    if (!env?.DB) return storageError()
    const ownership = canApprove
      ? and(
          eq(greetingCardRequests.id, id),
          eq(greetingCardRequests.organizationId, organizationId),
          inArray(greetingCardRequests.status, ["pending_approval", "rejected"]),
          isNull(greetingCardRequests.deletedAt),
        )
      : and(
          eq(greetingCardRequests.id, id),
          eq(greetingCardRequests.organizationId, organizationId),
          eq(greetingCardRequests.requestedBy, user.id),
          inArray(greetingCardRequests.status, ["pending_approval", "rejected"]),
          isNull(greetingCardRequests.deletedAt),
        )
    const now = new Date().toISOString()
    const rows = await getDb(env.DB)
      .update(greetingCardRequests)
      .set({ deletedBy: user.id, deletedAt: now, updatedAt: now })
      .where(ownership)
      .returning({ id: greetingCardRequests.id })
    if (!rows[0]) {
      return {
        success: false,
        error: "Only an unreleased pending or rejected request can be removed.",
      }
    }
    revalidateCards()
    return { success: true, data: { id } }
  } catch (error) {
    return actionError(error, "Unable to remove the greeting-card request.")
  }
}

function rowRecipientAddress(row: typeof greetingCardRequests.$inferSelect): HandwryttenAddress {
  return {
    firstName: row.recipientFirstName,
    lastName: row.recipientLastName,
    businessName: row.recipientBusinessName ?? "",
    address1: row.recipientAddress1,
    address2: row.recipientAddress2 ?? "",
    city: row.recipientCity,
    state: row.recipientState,
    postalCode: row.recipientPostalCode,
    country: "United States",
  }
}

async function restoreReleasedRequest(input: {
  readonly db: ReturnType<typeof getDb>
  readonly id: string
  readonly organizationId: string
  readonly status: GreetingCardRequestStatus
  readonly error: string
  readonly fromStatus?: "submitting" | "cancelling"
}): Promise<void> {
  await input.db
    .update(greetingCardRequests)
    .set({
      status: input.status,
      providerError: truncate(input.error, 500),
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(greetingCardRequests.id, input.id),
        eq(greetingCardRequests.organizationId, input.organizationId),
        eq(greetingCardRequests.status, input.fromStatus ?? "submitting"),
      ),
    )
    .run()
}

function giftbitOrderId(requestId: string): string {
  return `compass-ecard-${requestId}`
}

function cleanText(value: string, maxLength: number): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : null
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength)
}

function revalidateCards(): void {
  revalidatePath("/dashboard")
  revalidatePath("/dashboard/cards")
}

function cardAccessError<T>(): ActionResult<T> {
  return { success: false, error: "Employee greeting-card access is required." }
}

function approvalAccessError<T>(): ActionResult<T> {
  return { success: false, error: "Executive Admin approval is required." }
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

function isExpiredSessionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  const name = error.name.toLowerCase()
  const status =
    typeof error.cause === "object" && error.cause !== null
      ? Reflect.get(error.cause, "status")
      : undefined
  return (
    message.includes("session has expired") ||
    message.includes("unauthorized") ||
    message.includes("invalid_grant") ||
    message.includes("could not authorize the request") ||
    name === "unauthorizedexception" ||
    status === 401 ||
    isExpiredSessionError(error.cause)
  )
}

function expiredSessionResult<T>(): ActionResult<T> {
  return {
    success: false,
    error: "Your Compass session expired. Sign in again, then return to this card and submit it.",
  }
}
