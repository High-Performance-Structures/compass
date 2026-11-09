import type { getDb } from "@/db"
import { insertNotificationDelivery } from "@/lib/domain/notifications/store"
import type { NotificationDigestSettings } from "@/lib/feature-settings/notification-digest-settings"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { DIGEST_HELD_STATUS } from "@/lib/notifications/digest"

type Db = ReturnType<typeof getDb>

/** The company's digest settings; null (send right away) if they can't be read. */
export async function readDigestSettings(
  db: Db,
  organizationId: string
): Promise<NotificationDigestSettings | null> {
  try {
    return await readFeatureSettings(db, organizationId, "notification-digest")
  } catch (error) {
    console.error("Unable to read notification digest settings; sending right away", error)
    return null
  }
}

type HeldChannel = { readonly channel: "email" | "sms" | "push"; readonly toAddress: string | null }

/** Records the email, text and push a person would get, to send at the next digest time. */
export async function holdDeliveriesForDigest(
  db: Db,
  recipient: { readonly eventId: string; readonly recipientId: string; readonly userId: string; readonly createdAt: string },
  channels: readonly (HeldChannel | null)[]
): Promise<void> {
  for (const hold of channels) {
    if (!hold) continue
    await insertNotificationDelivery(db, {
      id: crypto.randomUUID(),
      eventId: recipient.eventId,
      recipientId: recipient.recipientId,
      userId: recipient.userId,
      channel: hold.channel,
      status: DIGEST_HELD_STATUS,
      toAddress: hold.toAddress,
      provider: "digest",
      providerMessageId: null,
      error: null,
      attemptedAt: null,
      createdAt: recipient.createdAt,
    })
  }
}
