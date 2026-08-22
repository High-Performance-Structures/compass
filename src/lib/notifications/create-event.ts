import { and, eq, inArray, isNull } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import {
  notificationDeliveries,
  notificationEvents,
  notificationPreferences,
  notificationRecipients,
  organizationMembers,
  projects,
  users,
} from "@/db/schema"
import {
  channelMembers,
  channels,
  messageMentions,
  messages,
} from "@/db/schema-conversations"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import {
  gotoSenderNumberForProject,
  normalizeSmsPhoneNumber,
} from "@/lib/goto/numbers"
import {
  resolveNotificationDelivery,
  type NotificationDelivery,
} from "@/lib/notifications/delivery"
import { requireOrg } from "@/lib/org-scope"
import { sendPushNotification } from "@/lib/push/send"
import {
  isConversationSmsEligibleChannel,
  isProjectActivitySmsEvent,
  shouldSendSmsNotification,
  shouldUseProjectActivitySmsRoute,
} from "@/lib/notifications/sms-policy"

type NotificationPreferenceState = {
  readonly inAppEnabled: boolean
  readonly emailEnabled: boolean
  readonly smsEnabled: boolean
  readonly smsPhoneNumber: string | null
  readonly smsConsentAccepted: boolean
  readonly smsConsentDisclosureVersion: string | null
  readonly smsConsentPhoneNumber: string | null
  readonly pushEnabled: boolean
  readonly mentionEmailEnabled: boolean
  readonly mentionSmsEnabled: boolean
  readonly announcementEmailEnabled: boolean
  readonly announcementSmsEnabled: boolean
  readonly projectActivitySmsEnabled: boolean
  readonly smsQuietHoursEnabled: boolean
  readonly smsQuietHoursStart: string
  readonly smsQuietHoursEnd: string
  readonly weeklyDigestEnabled: boolean
  readonly rfiEnabled: boolean
  readonly ownerUpdateEnabled: boolean
  readonly scheduleEnabled: boolean
  readonly poEnabled: boolean
  readonly timeZone: string
}

export type NotificationRecipientInput = {
  readonly userId: string
  readonly email: string
}

export type CreateNotificationInput = {
  readonly idempotencyKey?: string
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
  smsEnabled: false,
  smsPhoneNumber: null,
  smsConsentAccepted: false,
  smsConsentDisclosureVersion: null,
  smsConsentPhoneNumber: null,
  pushEnabled: true,
  mentionEmailEnabled: true,
  mentionSmsEnabled: false,
  announcementEmailEnabled: true,
  announcementSmsEnabled: false,
  projectActivitySmsEnabled: true,
  smsQuietHoursEnabled: false,
  smsQuietHoursStart: "21:00",
  smsQuietHoursEnd: "07:00",
  weeklyDigestEnabled: false,
  rfiEnabled: true,
  ownerUpdateEnabled: true,
  scheduleEnabled: true,
  poEnabled: true,
  timeZone: "America/Denver",
}

type SmsDeliveryResult = {
  readonly status: string
  readonly provider: string
  readonly providerMessageId: string | null
  readonly error: string | null
}

type GotoAccessTokenResult =
  | {
      readonly success: true
      readonly accessToken: string
      readonly accountKey: string | null
    }
  | { readonly success: false; readonly error: string }

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

function gotoAccountKey(value: Record<string, unknown>): string | null {
  const field = value.account_key ?? value.accountKey
  if (typeof field === "string" && field.trim().length > 0) {
    return field.trim()
  }
  return typeof field === "number" && Number.isFinite(field)
    ? String(field)
    : null
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
    smsEnabled: row.smsEnabled,
    smsPhoneNumber: row.smsPhoneNumber,
    smsConsentAccepted: row.smsConsentAccepted,
    smsConsentDisclosureVersion: row.smsConsentDisclosureVersion,
    smsConsentPhoneNumber: row.smsConsentPhoneNumber,
    pushEnabled: row.pushEnabled,
    mentionEmailEnabled: row.mentionEmailEnabled,
    mentionSmsEnabled: row.mentionSmsEnabled,
    announcementEmailEnabled: row.announcementEmailEnabled,
    announcementSmsEnabled: row.announcementSmsEnabled,
    projectActivitySmsEnabled: row.projectActivitySmsEnabled,
    smsQuietHoursEnabled: row.smsQuietHoursEnabled,
    smsQuietHoursStart: row.smsQuietHoursStart,
    smsQuietHoursEnd: row.smsQuietHoursEnd,
    weeklyDigestEnabled: row.weeklyDigestEnabled,
    rfiEnabled: row.rfiEnabled,
    ownerUpdateEnabled: row.ownerUpdateEnabled,
    scheduleEnabled: row.scheduleEnabled,
    poEnabled: row.poEnabled,
    timeZone: row.timeZone,
  }
}

function notificationCategoryEnabled(
  preferences: NotificationPreferenceState,
  eventType: string
): boolean {
  if (eventType === "message.mention") {
    return (
      preferences.mentionEmailEnabled ||
      (preferences.smsEnabled && preferences.mentionSmsEnabled) ||
      preferences.inAppEnabled ||
      preferences.pushEnabled
    )
  }
  if (eventType === "announcement.message") {
    return (
      preferences.announcementEmailEnabled ||
      (preferences.smsEnabled && preferences.announcementSmsEnabled) ||
      preferences.inAppEnabled ||
      preferences.pushEnabled
    )
  }
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

function notificationEmailEnabled(
  preferences: NotificationPreferenceState,
  eventType: string,
  requested: boolean
): boolean {
  if (!requested || !preferences.emailEnabled) return false
  if (eventType === "message.mention") {
    return preferences.mentionEmailEnabled
  }
  if (eventType === "announcement.message") {
    return preferences.announcementEmailEnabled
  }
  return true
}

function notificationSmsEnabled(
  preferences: NotificationPreferenceState,
  input: Pick<CreateNotificationInput, "eventType" | "createdBy">,
  occurredAt: Date
): boolean {
  return shouldSendSmsNotification(preferences, {
    eventType: input.eventType,
    createdBy: input.createdBy,
    occurredAt,
  })
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

export {
  resolveNotificationDelivery,
  type NotificationDelivery,
} from "@/lib/notifications/delivery"

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

function toBasicAuthToken(clientId: string, clientSecret: string): string {
  return btoa(`${clientId}:${clientSecret}`)
}

function notificationSmsBody(title: string, body: string): string {
  const message = `${title}\n${body}\nReply STOP to opt out.`.trim()
  return message.length > 1000
    ? `${message.slice(0, 997)}...`
    : message
}

function extractProviderMessageId(value: unknown): string | null {
  if (!isRecord(value)) return null
  if (typeof value.id === "string") return value.id
  if (typeof value.messageId === "string") return value.messageId
  if (!Array.isArray(value.messages)) return null
  const firstMessage = value.messages[0]
  if (!isRecord(firstMessage)) return null
  return typeof firstMessage.id === "string" ? firstMessage.id : null
}

export async function getGotoAccessToken(
  env: unknown
): Promise<GotoAccessTokenResult> {
  const pat = envString(env, "GOTO_SMS_ACCESS_TOKEN")
  const clientId = envString(env, "GOTO_CLIENT_ID")
  const clientSecret = envString(env, "GOTO_CLIENT_SECRET")
  if (!pat || !clientId || !clientSecret) {
    return {
      success: false,
      error:
        "GOTO_SMS_ACCESS_TOKEN, GOTO_CLIENT_ID, and GOTO_CLIENT_SECRET are not configured",
    }
  }

  const response = await fetch(
    "https://authentication.logmeininc.com/oauth/token",
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${toBasicAuthToken(clientId, clientSecret)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "personal_access_token",
        pat,
      }).toString(),
    }
  )
  const responseText = await response.text()
  if (!response.ok) {
    return { success: false, error: responseText.slice(0, 500) }
  }

  try {
    const parsed: unknown = JSON.parse(responseText)
    if (isRecord(parsed) && typeof parsed.access_token === "string") {
      return {
        success: true,
        accessToken: parsed.access_token,
        accountKey: gotoAccountKey(parsed),
      }
    }
  } catch {
    return { success: false, error: "GoTo token response was not JSON" }
  }
  return {
    success: false,
    error: "GoTo token response did not include access_token",
  }
}

async function sendGotoSms(
  env: unknown,
  toPhoneNumber: string,
  title: string,
  body: string,
  projectNumber: string | null
): Promise<SmsDeliveryResult> {
  const tokenResult = await getGotoAccessToken(env)
  if (!tokenResult.success) {
    return {
      status: "pending_provider",
      provider: "goto",
      providerMessageId: null,
      error: tokenResult.error,
    }
  }

  const response = await fetch(
    "https://api.goto.com/messaging/v1/messages",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenResult.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ownerPhoneNumber: gotoSenderNumberForProject(env, projectNumber),
        contactPhoneNumbers: [normalizeSmsPhoneNumber(toPhoneNumber)],
        body: notificationSmsBody(title, body),
      }),
    }
  )
  const responseText = await response.text()
  let providerMessageId: string | null = null
  try {
    providerMessageId = extractProviderMessageId(JSON.parse(responseText))
  } catch {
    providerMessageId = null
  }

  return {
    status: response.ok ? "sent" : "failed",
    provider: "goto",
    providerMessageId,
    error: response.ok ? null : responseText.slice(0, 500),
  }
}

export async function queueSmsDelivery(
  env: unknown,
  toPhoneNumber: string,
  title: string,
  body: string,
  projectNumber: string | null
): Promise<SmsDeliveryResult> {
  const hasGotoConfig =
    envString(env, "GOTO_SMS_ACCESS_TOKEN") !== null &&
    envString(env, "GOTO_CLIENT_ID") !== null &&
    envString(env, "GOTO_CLIENT_SECRET") !== null
  if (hasGotoConfig) {
    return sendGotoSms(
      env,
      toPhoneNumber,
      title,
      body,
      projectNumber
    )
  }

  const webhookUrl = envString(env, "COMPASS_SMS_WEBHOOK_URL")
  if (!webhookUrl) {
    return {
      status: "pending_provider",
      provider: "sms_webhook",
      providerMessageId: null,
      error:
        "GoTo SMS credentials and COMPASS_SMS_WEBHOOK_URL are not configured",
    }
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: toPhoneNumber, title, body }),
  })
  const responseText = await response.text()
  return {
    status: response.ok ? "sent" : "failed",
    provider: "sms_webhook",
    providerMessageId: null,
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

function isMessageSmsEvent(eventType: string): boolean {
  return (
    eventType === "message.mention" ||
    eventType === "announcement.message" ||
    isProjectActivitySmsEvent(eventType)
  )
}

async function isEligibleLiveMessageSmsRecipient(
  db: ReturnType<typeof getDb>,
  input: CreateNotificationInput,
  userId: string
): Promise<boolean> {
  if (!isMessageSmsEvent(input.eventType)) return true
  if (
    input.sourceType !== "message" ||
    input.sourceId === null ||
    input.createdBy === null
  ) {
    return false
  }

  const source = await db
    .select({
      channelId: channels.id,
      channelType: channels.type,
      channelAudience: channels.audience,
      channelIsPrivate: channels.isPrivate,
      channelProjectId: channels.projectId,
      channelDescription: channels.description,
    })
    .from(messages)
    .innerJoin(channels, eq(channels.id, messages.channelId))
    .innerJoin(
      channelMembers,
      and(
        eq(channelMembers.channelId, channels.id),
        eq(channelMembers.userId, userId)
      )
    )
    .where(
      and(
        eq(messages.id, input.sourceId),
        eq(messages.userId, input.createdBy),
        eq(channels.organizationId, input.organizationId),
        input.projectId === null
          ? isNull(channels.projectId)
          : eq(channels.projectId, input.projectId)
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)
  if (!source) return false

  // Direct conversations stay inside Compass. They use in-app/native push
  // delivery and must never create a parallel GoTo SMS conversation.
  if (
    !isConversationSmsEligibleChannel({
      id: source.channelId,
      audience: source.channelAudience,
      isPrivate: source.channelIsPrivate,
      projectId: source.channelProjectId,
      description: source.channelDescription,
    })
  ) {
    return false
  }

  if (!isProjectActivitySmsEvent(input.eventType)) return true
  // Announcements and mentions have their own explicit SMS switches. Do not
  // silently route them through the broader project-message preference.
  const mentions = await db
    .select({
      mentionType: messageMentions.mentionType,
      targetId: messageMentions.targetId,
    })
    .from(messageMentions)
    .where(eq(messageMentions.messageId, input.sourceId))
  return shouldUseProjectActivitySmsRoute({
    channelType: source.channelType,
    recipientUserId: userId,
    mentions,
  })
}

async function hasExistingSmsDeliveryForSource(
  db: ReturnType<typeof getDb>,
  input: CreateNotificationInput,
  userId: string
): Promise<boolean> {
  if (input.sourceId === null) return false

  return db
    .select({ id: notificationDeliveries.id })
    .from(notificationDeliveries)
    .innerJoin(
      notificationEvents,
      eq(notificationEvents.id, notificationDeliveries.eventId)
    )
    .where(
      and(
        eq(notificationEvents.organizationId, input.organizationId),
        eq(notificationEvents.sourceType, input.sourceType),
        eq(notificationEvents.sourceId, input.sourceId),
        eq(notificationDeliveries.userId, userId),
        eq(notificationDeliveries.channel, "sms")
      )
    )
    .limit(1)
    .then((rows) => rows.length > 0)
}

async function persistNotificationEvent(
  input: CreateNotificationInput,
  options: Readonly<{ swallowMissingTableError: boolean }> = {
    swallowMissingTableError: true,
  },
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

  const projectNumber = input.projectId
    ? await db
        .select({ projectNumber: projects.projectNumber })
        .from(projects)
        .where(eq(projects.id, input.projectId))
        .limit(1)
        .then((rows) => rows[0]?.projectNumber ?? null)
    : null
  const occurredAt = new Date()
  const now = occurredAt.toISOString()
  const eventId = input.idempotencyKey === undefined
    ? crypto.randomUUID()
    : `notification:${input.idempotencyKey}`
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
    }).onConflictDoNothing().run()

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
      const emailEnabled = notificationEmailEnabled(
        preferences,
        input.eventType,
        delivery.email
      )
      const smsPolicyEnabled = notificationSmsEnabled(
        preferences,
        input,
        occurredAt
      )
      const smsEnabled =
        smsPolicyEnabled &&
        (await isEligibleLiveMessageSmsRecipient(
          db,
          input,
          recipient.userId
        )) &&
        !(await hasExistingSmsDeliveryForSource(
          db,
          input,
          recipient.userId
        ))
      if (
        !emailEnabled &&
        !delivery.inApp &&
        !delivery.push &&
        !smsEnabled
      ) {
        continue
      }

      const recipientId = `notification-recipient:${eventId}:${recipient.userId}`
      const recipientInserted = await db.insert(notificationRecipients).values({
        id: recipientId,
        eventId,
        userId: recipient.userId,
        inApp: delivery.inApp,
        email: emailEnabled,
        sms: smsEnabled,
        push: delivery.push,
        readAt: null,
        dismissedAt: null,
        createdAt: now,
      }).onConflictDoNothing().run()
      if (recipientInserted.meta.changes !== 1) continue

      if (emailEnabled) {
        const emailDelivery = await sendResendEmail(
          env,
          recipient.googleEmail ?? recipient.email,
          input.title,
          notificationEmailBody(input)
        )
        await db.insert(notificationDeliveries).values({
          id: `${eventId}:${recipient.userId}:email`,
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

      if (smsEnabled && preferences.smsPhoneNumber) {
        const smsDelivery = await queueSmsDelivery(
          env,
          preferences.smsPhoneNumber,
          input.title,
          input.body,
          projectNumber
        )
        await db.insert(notificationDeliveries).values({
          id: `${eventId}:${recipient.userId}:sms`,
          eventId,
          recipientId,
          userId: recipient.userId,
          channel: "sms",
          status: smsDelivery.status,
          toAddress: preferences.smsPhoneNumber,
          provider: smsDelivery.provider,
          providerMessageId: smsDelivery.providerMessageId,
          error: smsDelivery.error,
          attemptedAt: new Date().toISOString(),
          createdAt: now,
        })
      }

      if (delivery.push) {
        let status = "pending_provider"
        let error: string | null = null
        try {
          const result = await sendPushNotification(env, {
            userId: recipient.userId,
            title: input.title,
            body: input.body,
            data: {
              url: input.href,
              href: input.href,
              eventType: input.eventType,
            },
          })
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

        await db.insert(notificationDeliveries).values({
          id: `${eventId}:${recipient.userId}:push`,
          eventId,
          recipientId,
          userId: recipient.userId,
          channel: "push",
          status,
          toAddress: null,
          provider: "native_push",
          providerMessageId: null,
          error,
          attemptedAt: new Date().toISOString(),
          createdAt: now,
        })
      }
    }

    revalidatePath("/", "layout")
  } catch (error) {
    if (
      !isMissingNotificationTableError(error) ||
      !options.swallowMissingTableError
    ) {
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

export async function createStrictSystemNotificationEvent(
  input: Omit<CreateNotificationInput, "createdBy">
): Promise<void> {
  await persistNotificationEvent(
    {
      ...input,
      createdBy: null,
    },
    { swallowMissingTableError: false },
  )
}
