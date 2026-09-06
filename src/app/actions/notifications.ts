"use server"

import { and, desc, eq, isNull } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import {
  notificationDeliveries,
  notificationEvents,
  notificationPreferences,
  notificationRecipients,
} from "@/db/schema"
import { getCurrentUser, requireAuth } from "@/lib/auth"
import { recipientNotificationHref } from "@/lib/conversations/notification-route"
import { getCloudflareContext } from "@/lib/db"
import {
  isMissingNotificationTableError,
  queueSmsDelivery,
} from "@/lib/notifications/events"
import {
  hasCurrentSmsConsent,
  SMS_OPT_IN_DISCLOSURE_URL,
  SMS_OPT_IN_DISCLOSURE_VERSION,
} from "@/lib/notifications/sms-consent"
import { isValidSmsQuietHoursTime } from "@/lib/notifications/sms-policy"
import { requireOrg } from "@/lib/org-scope"
import { isValidTimeZone } from "@/lib/work-calendar"

export type NotificationPreferenceState = {
  readonly inAppEnabled: boolean
  readonly emailEnabled: boolean
  readonly smsEnabled: boolean
  readonly smsPhoneNumber: string | null
  readonly smsConsentAccepted: boolean
  readonly smsConsentAcceptedAt: string | null
  readonly smsConsentDisclosureUrl: string | null
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

export type NotificationCenterItem = {
  readonly id: string
  readonly eventId: string
  readonly title: string
  readonly body: string
  readonly href: string
  readonly priority: string
  readonly eventType: string
  readonly projectId: string | null
  readonly readAt: string | null
  readonly createdAt: string
}

type NotificationActionResult =
  | { readonly success: true }
  | { readonly success: false; readonly error: string }

type NotificationPreferencesResult =
  | { readonly success: true; readonly data: NotificationPreferenceState }
  | { readonly success: false; readonly error: string }

type NotificationSmsTestResult =
  | {
      readonly success: true
      readonly data: {
        readonly status: string
        readonly provider: string
        readonly providerMessageId: string | null
      }
    }
  | { readonly success: false; readonly error: string }

type NotificationCenterResult =
  | {
      readonly success: true
      readonly data: {
        readonly unreadCount: number
        readonly items: readonly NotificationCenterItem[]
      }
    }
  | { readonly success: false; readonly error: string }

const DEFAULT_PREFERENCES: NotificationPreferenceState = {
  inAppEnabled: true,
  emailEnabled: true,
  smsEnabled: false,
  smsPhoneNumber: null,
  smsConsentAccepted: false,
  smsConsentAcceptedAt: null,
  smsConsentDisclosureUrl: null,
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
    smsConsentAcceptedAt: row.smsConsentAcceptedAt,
    smsConsentDisclosureUrl: row.smsConsentDisclosureUrl,
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

export async function getNotificationPreferences(): Promise<NotificationPreferencesResult> {
  try {
    const user = await requireAuth()
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const data = await getPreferenceForUser(db, user.id)
    return { success: true, data }
  } catch (error) {
    if (isMissingNotificationTableError(error)) {
      return { success: true, data: DEFAULT_PREFERENCES }
    }
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to load notification preferences",
    }
  }
}

export async function updateNotificationPreferences(
  input: NotificationPreferenceState
): Promise<NotificationActionResult> {
  try {
    const timeZone = input.timeZone.trim()
    if (!isValidTimeZone(timeZone)) {
      return { success: false, error: "Choose a valid timezone." }
    }
    if (
      !isValidSmsQuietHoursTime(input.smsQuietHoursStart) ||
      !isValidSmsQuietHoursTime(input.smsQuietHoursEnd)
    ) {
      return {
        success: false,
        error: "Choose valid SMS quiet-hour start and end times.",
      }
    }
    const user = await requireAuth()
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const now = new Date().toISOString()
    const smsPhoneNumber = input.smsPhoneNumber?.trim() || null
    const wantsSms = input.smsEnabled

    if (wantsSms && !smsPhoneNumber) {
      return {
        success: false,
        error: "Add a text phone number before enabling SMS notifications.",
      }
    }
    if (wantsSms && !input.smsConsentAccepted) {
      return {
        success: false,
        error: "Accept the SMS opt-in disclosure before enabling texts.",
      }
    }

    const existingRow = await db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, user.id))
      .limit(1)
      .then((rows) => rows[0] ?? null)
    const consentNeedsRefresh =
      input.smsConsentAccepted &&
      (existingRow?.smsConsentAccepted !== true ||
        existingRow.smsConsentPhoneNumber !== smsPhoneNumber ||
        existingRow.smsConsentDisclosureVersion !==
          SMS_OPT_IN_DISCLOSURE_VERSION)
    const smsConsentAcceptedAt = consentNeedsRefresh
      ? now
      : existingRow?.smsConsentAcceptedAt ?? input.smsConsentAcceptedAt
    const persistedInput: NotificationPreferenceState = {
      ...input,
      timeZone,
      smsEnabled: input.smsEnabled,
      smsPhoneNumber,
      smsConsentAccepted: input.smsConsentAccepted,
      smsConsentAcceptedAt,
      smsConsentDisclosureUrl: input.smsConsentAccepted
        ? SMS_OPT_IN_DISCLOSURE_URL
        : existingRow?.smsConsentDisclosureUrl ??
          input.smsConsentDisclosureUrl,
      smsConsentDisclosureVersion: input.smsConsentAccepted
        ? SMS_OPT_IN_DISCLOSURE_VERSION
        : existingRow?.smsConsentDisclosureVersion ??
          input.smsConsentDisclosureVersion,
      smsConsentPhoneNumber: input.smsConsentAccepted
        ? smsPhoneNumber
        : existingRow?.smsConsentPhoneNumber ??
          input.smsConsentPhoneNumber,
      mentionSmsEnabled: input.smsEnabled
        ? input.mentionSmsEnabled
        : false,
      announcementSmsEnabled: input.smsEnabled
        ? input.announcementSmsEnabled
        : false,
      projectActivitySmsEnabled: input.smsEnabled
        ? input.projectActivitySmsEnabled
        : false,
    }

    await db
      .insert(notificationPreferences)
      .values({
        userId: user.id,
        ...persistedInput,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: notificationPreferences.userId,
        set: {
          ...persistedInput,
          updatedAt: now,
        },
      })

    return { success: true }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to update notification preferences",
    }
  }
}

export async function sendTestSmsNotification(): Promise<NotificationSmsTestResult> {
  try {
    const user = await requireAuth()
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const now = new Date().toISOString()
    const preferences = await db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, user.id))
      .limit(1)
      .then((rows) => rows[0] ?? null)

    if (!preferences?.smsEnabled || !preferences.smsPhoneNumber) {
      return {
        success: false,
        error: "Save an SMS phone number before sending a test text.",
      }
    }
    if (
      !hasCurrentSmsConsent({
        accepted: preferences.smsConsentAccepted,
        phoneNumber: preferences.smsPhoneNumber,
        consentPhoneNumber: preferences.smsConsentPhoneNumber,
        disclosureVersion: preferences.smsConsentDisclosureVersion,
      })
    ) {
      return {
        success: false,
        error: "Accept the current SMS opt-in disclosure before testing texts.",
      }
    }

    const eventId = crypto.randomUUID()
    const recipientId = crypto.randomUUID()
    const title = "Compass SMS test"
    const body =
      "Your Compass text notifications are connected. Reply STOP to opt out or HELP for help."

    await db.insert(notificationEvents).values({
      id: eventId,
      organizationId,
      projectId: null,
      eventType: "sms.test",
      sourceType: "notification_test",
      sourceId: user.id,
      title,
      body,
      href: "/dashboard/settings",
      priority: "normal",
      audience: "current_user",
      createdBy: user.id,
      createdAt: now,
    })
    await db.insert(notificationRecipients).values({
      id: recipientId,
      eventId,
      userId: user.id,
      inApp: false,
      email: false,
      sms: true,
      push: false,
      readAt: null,
      dismissedAt: null,
      createdAt: now,
    })

    const delivery = await queueSmsDelivery(
      env,
      preferences.smsPhoneNumber,
      title,
      body,
      null
    )
    await db.insert(notificationDeliveries).values({
      id: crypto.randomUUID(),
      eventId,
      recipientId,
      userId: user.id,
      channel: "sms",
      status: delivery.status,
      toAddress: preferences.smsPhoneNumber,
      provider: delivery.provider,
      providerMessageId: delivery.providerMessageId,
      error: delivery.error,
      attemptedAt: new Date().toISOString(),
      createdAt: now,
    })

    if (delivery.status !== "sent") {
      return {
        success: false,
        error: delivery.error ?? "GoTo did not accept the test text.",
      }
    }
    return {
      success: true,
      data: {
        status: delivery.status,
        provider: delivery.provider,
        providerMessageId: delivery.providerMessageId,
      },
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to send test text.",
    }
  }
}

export async function getNotificationCenter(): Promise<NotificationCenterResult> {
  try {
    const user = await requireAuth()
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const rows = await db
      .select({
        id: notificationRecipients.id,
        eventId: notificationEvents.id,
        title: notificationEvents.title,
        body: notificationEvents.body,
        href: notificationEvents.href,
        priority: notificationEvents.priority,
        eventType: notificationEvents.eventType,
        projectId: notificationEvents.projectId,
        readAt: notificationRecipients.readAt,
        createdAt: notificationRecipients.createdAt,
      })
      .from(notificationRecipients)
      .innerJoin(
        notificationEvents,
        eq(notificationEvents.id, notificationRecipients.eventId)
      )
      .where(
        and(
          eq(notificationRecipients.userId, user.id),
          eq(notificationRecipients.inApp, true),
          isNull(notificationRecipients.dismissedAt)
        )
      )
      .orderBy(desc(notificationRecipients.createdAt))
      .limit(100)

    return {
      success: true,
      data: {
        unreadCount: rows.filter((row) => row.readAt === null).length,
        items: rows.map((row) => ({ ...row, href: recipientNotificationHref(row.href, user.role) })),
      },
    }
  } catch (error) {
    if (isMissingNotificationTableError(error)) {
      return { success: true, data: { unreadCount: 0, items: [] } }
    }
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to load notifications",
    }
  }
}

export async function markNotificationRead(
  recipientId: string
): Promise<NotificationActionResult> {
  try {
    const user = await requireAuth()
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const now = new Date().toISOString()

    await db
      .update(notificationRecipients)
      .set({ readAt: now })
      .where(
        and(
          eq(notificationRecipients.id, recipientId),
          eq(notificationRecipients.userId, user.id)
        )
      )

    revalidatePath("/", "layout")
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to mark notification read",
    }
  }
}

export async function markAllNotificationsRead(): Promise<NotificationActionResult> {
  try {
    const user = await requireAuth()
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const now = new Date().toISOString()

    await db
      .update(notificationRecipients)
      .set({ readAt: now })
      .where(
        and(
          eq(notificationRecipients.userId, user.id),
          isNull(notificationRecipients.readAt)
        )
      )

    revalidatePath("/", "layout")
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to mark notifications read",
    }
  }
}

export async function getNotificationDebugStatus(): Promise<{
  readonly signedIn: boolean
  readonly configuredEmail: boolean
}> {
  const user = await getCurrentUser()
  const { env } = await getCloudflareContext()
  return {
    signedIn: user !== null,
    configuredEmail: envString(env, "RESEND_API_KEY") !== null,
  }
}
