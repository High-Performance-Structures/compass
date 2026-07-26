import { and, eq, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import {
  notificationDeliveries,
  notificationEvents,
  notificationPreferences,
  notificationRecipients,
  organizationMembers,
  users,
} from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { requireOrg } from "@/lib/org-scope"
import { sendPushNotification } from "@/lib/push/send"

type NotificationPreferenceState = {
  readonly inAppEnabled: boolean
  readonly emailEnabled: boolean
  readonly pushEnabled: boolean
  readonly weeklyDigestEnabled: boolean
  readonly rfiEnabled: boolean
  readonly ownerUpdateEnabled: boolean
  readonly scheduleEnabled: boolean
  readonly poEnabled: boolean
}

export type NotificationRecipientInput = {
  readonly userId: string
  readonly email: string
}

export type NotificationDelivery = {
  readonly inApp: boolean
  readonly email: boolean
  readonly push: boolean
}

export type CreateNotificationInput = {
  readonly organizationId: string
  readonly projectId: string | null
  readonly eventType: string
  readonly sourceType: string
  readonly sourceId: string | null
  readonly title: string
  readonly body: string
  readonly href: string
  readonly priority: string
  readonly audience: string
  readonly createdBy: string | null
  readonly recipients: readonly NotificationRecipientInput[]
  readonly delivery: NotificationDelivery
}

const DEFAULT_PREFERENCES: NotificationPreferenceState = {
  inAppEnabled: true,
  emailEnabled: true,
  pushEnabled: true,
  weeklyDigestEnabled: false,
  rfiEnabled: true,
  ownerUpdateEnabled: true,
  scheduleEnabled: true,
  poEnabled: true,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function envString(env: unknown, key: string): string | null {
  if (!isRecord(env)) return process.env[key] ?? null
  const value = env[key]
  return typeof value === "string" && value.trim().length > 0
    ? value
    : process.env[key] ?? null
}

export function isMissingNotificationTableError(
  error: unknown
): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return (
    message.includes("notification_") &&
    (message.includes("no such table") ||
      message.includes("failed query"))
  )
}

function preferenceFromRow(
  row: typeof notificationPreferences.$inferSelect | null
): NotificationPreferenceState {
  if (!row) return DEFAULT_PREFERENCES
  return {
    inAppEnabled: row.inAppEnabled,
    emailEnabled: row.emailEnabled,
    pushEnabled: row.pushEnabled,
    weeklyDigestEnabled: row.weeklyDigestEnabled,
    rfiEnabled: row.rfiEnabled,
    ownerUpdateEnabled: row.ownerUpdateEnabled,
    scheduleEnabled: row.scheduleEnabled,
    poEnabled: row.poEnabled,
  }
}

function notificationCategoryEnabled(
  preferences: NotificationPreferenceState,
  eventType: string
): boolean {
  if (eventType.startsWith("rfi.")) return preferences.rfiEnabled
  if (eventType.startsWith("owner_update.")) {
    return preferences.ownerUpdateEnabled
  }
  if (eventType.startsWith("schedule.")) {
    return preferences.scheduleEnabled
  }
  if (eventType.startsWith("po.")) return preferences.poEnabled
  return true
}

export function resolveNotificationDelivery(
  preferences: Pick<
    NotificationPreferenceState,
    "inAppEnabled" | "emailEnabled" | "pushEnabled"
  >,
  requested: NotificationDelivery
): NotificationDelivery {
  return {
    inApp: requested.inApp && preferences.inAppEnabled,
    email: requested.email && preferences.emailEnabled,
    push: requested.push && preferences.pushEnabled,
  }
}

function notificationEmailBody(
  input: Pick<CreateNotificationInput, "title" | "body" | "href">
): string {
  return [
    input.title,
    "",
    input.body,
    "",
    `Open in Compass: ${input.href}`,
  ].join("\n")
}

async function sendResendEmail(
  env: unknown,
  toAddress: string,
  subject: string,
  body: string
): Promise<{
  readonly status: string
  readonly providerMessageId: string | null
  readonly error: string | null
}> {
  const apiKey = envString(env, "RESEND_API_KEY")
  if (!apiKey) {
    return {
      status: "pending_provider",
      providerMessageId: null,
      error: "RESEND_API_KEY is not configured",
    }
  }

  const fromAddress =
    envString(env, "COMPASS_EMAIL_FROM") ??
    "Compass <notifications@compass.build>"
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromAddress,
      to: [toAddress],
      subject,
      text: body,
    }),
  })

  const responseText = await response.text()
  let providerMessageId: string | null = null
  try {
    const parsed: unknown = JSON.parse(responseText)
    if (isRecord(parsed) && typeof parsed.id === "string") {
      providerMessageId = parsed.id
    }
  } catch {
    providerMessageId = null
  }

  return {
    status: response.ok ? "sent" : "failed",
    providerMessageId,
    error: response.ok ? null : responseText.slice(0, 500),
  }
}

async function getPreferenceForUser(
  db: ReturnType<typeof getDb>,
  userId: string
): Promise<NotificationPreferenceState> {
  const row = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
    .limit(1)
    .then((rows) => rows[0] ?? null)

  return preferenceFromRow(row)
}

async function persistNotificationEvent(
  input: CreateNotificationInput
): Promise<void> {
  const requestedRecipientIds = Array.from(
    new Set(input.recipients.map((recipient) => recipient.userId))
  )
  if (requestedRecipientIds.length === 0) return

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const recipients = await db
    .select({
      userId: users.id,
      email: users.email,
      googleEmail: users.googleEmail,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(
      and(
        eq(
          organizationMembers.organizationId,
          input.organizationId
        ),
        eq(users.isActive, true),
        inArray(organizationMembers.userId, requestedRecipientIds)
      )
    )
  if (recipients.length === 0) return

  const now = new Date().toISOString()
  const eventId = crypto.randomUUID()
  try {
    await db.insert(notificationEvents).values({
      id: eventId,
      organizationId: input.organizationId,
      projectId: input.projectId,
      eventType: input.eventType,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      title: input.title,
      body: input.body,
      href: input.href,
      priority: input.priority,
      audience: input.audience,
      createdBy: input.createdBy,
      createdAt: now,
    })

    for (const recipient of recipients) {
      const preferences = await getPreferenceForUser(
        db,
        recipient.userId
      )
      if (
        !notificationCategoryEnabled(preferences, input.eventType)
      ) {
        continue
      }

      const delivery = resolveNotificationDelivery(
        preferences,
        input.delivery
      )
      if (!delivery.email && !delivery.inApp && !delivery.push) {
        continue
      }

      const recipientId = crypto.randomUUID()
      await db.insert(notificationRecipients).values({
        id: recipientId,
        eventId,
        userId: recipient.userId,
        inApp: delivery.inApp,
        email: delivery.email,
        push: delivery.push,
        readAt: null,
        dismissedAt: null,
        createdAt: now,
      })

      if (delivery.email) {
        const emailDelivery = await sendResendEmail(
          env,
          recipient.googleEmail ?? recipient.email,
          input.title,
          notificationEmailBody(input)
        )
        await db.insert(notificationDeliveries).values({
          id: crypto.randomUUID(),
          eventId,
          recipientId,
          userId: recipient.userId,
          channel: "email",
          status: emailDelivery.status,
          toAddress: recipient.email,
          provider: "resend",
          providerMessageId: emailDelivery.providerMessageId,
          error: emailDelivery.error,
          attemptedAt: new Date().toISOString(),
          createdAt: now,
        })
      }

      if (delivery.push) {
        const fcmServerKey = envString(env, "FCM_SERVER_KEY")
        let status = "pending_provider"
        let error: string | null =
          "FCM_SERVER_KEY is not configured"
        if (fcmServerKey) {
          try {
            const result = await sendPushNotification(
              env.DB,
              fcmServerKey,
              {
                userId: recipient.userId,
                title: input.title,
                body: input.body,
                data: {
                  href: input.href,
                  eventType: input.eventType,
                },
              }
            )
            status =
              result.failed > 0
                ? "failed"
                : result.sent > 0
                  ? "sent"
                  : "skipped_no_token"
            error =
              result.failed > 0
                ? `${result.failed} push delivery attempt(s) failed`
                : null
          } catch (pushError) {
            status = "failed"
            error =
              pushError instanceof Error
                ? pushError.message
                : "Push delivery failed"
          }
        }

        await db.insert(notificationDeliveries).values({
          id: crypto.randomUUID(),
          eventId,
          recipientId,
          userId: recipient.userId,
          channel: "push",
          status,
          toAddress: null,
          provider: "fcm",
          providerMessageId: null,
          error,
          attemptedAt: new Date().toISOString(),
          createdAt: now,
        })
      }
    }

    revalidatePath("/", "layout")
  } catch (error) {
    if (!isMissingNotificationTableError(error)) {
      throw error
    }
  }
}

export async function createNotificationEvent(
  input: CreateNotificationInput
): Promise<void> {
  const user = await requireAuth()
  const organizationId = requireOrg(user)
  if (organizationId !== input.organizationId) {
    throw new Error(
      "Cannot create notifications outside the active organization"
    )
  }
  if (input.createdBy !== user.id) {
    throw new Error(
      "Cannot create notifications on behalf of another user"
    )
  }

  await persistNotificationEvent(input)
}

export async function createSystemNotificationEvent(
  input: Omit<CreateNotificationInput, "createdBy">
): Promise<void> {
  await persistNotificationEvent({
    ...input,
    createdBy: null,
  })
}
