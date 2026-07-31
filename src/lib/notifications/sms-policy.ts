import { hasCurrentSmsConsent } from "@/lib/notifications/sms-consent"

export type SmsPolicyPreferences = {
  readonly smsEnabled: boolean
  readonly smsPhoneNumber: string | null
  readonly smsConsentAccepted: boolean
  readonly smsConsentDisclosureVersion: string | null
  readonly smsConsentPhoneNumber: string | null
  readonly mentionSmsEnabled: boolean
  readonly announcementSmsEnabled: boolean
  readonly projectActivitySmsEnabled: boolean
  readonly smsQuietHoursEnabled: boolean
  readonly smsQuietHoursStart: string
  readonly smsQuietHoursEnd: string
  readonly timeZone: string
}

export type SmsNotificationContext = {
  readonly eventType: string
  readonly createdBy: string | null
  readonly occurredAt: Date
}

export type SmsMessageMention = {
  readonly mentionType: string
  readonly targetId: string | null
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

export function isValidSmsQuietHoursTime(value: string): boolean {
  return TIME_PATTERN.test(value)
}

function minutesAtTimeZone(date: Date, timeZone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date)
    const hour = Number(parts.find((part) => part.type === "hour")?.value)
    const minute = Number(
      parts.find((part) => part.type === "minute")?.value
    )
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null
    return hour * 60 + minute
  } catch {
    return null
  }
}

function timeToMinutes(value: string): number | null {
  if (!isValidSmsQuietHoursTime(value)) return null
  const [hourValue, minuteValue] = value.split(":")
  const hour = Number(hourValue)
  const minute = Number(minuteValue)
  return hour * 60 + minute
}

export function isDuringSmsQuietHours(
  preferences: Pick<
    SmsPolicyPreferences,
    | "smsQuietHoursEnabled"
    | "smsQuietHoursStart"
    | "smsQuietHoursEnd"
    | "timeZone"
  >,
  occurredAt: Date
): boolean {
  if (!preferences.smsQuietHoursEnabled) return false

  const current = minutesAtTimeZone(occurredAt, preferences.timeZone)
  const start = timeToMinutes(preferences.smsQuietHoursStart)
  const end = timeToMinutes(preferences.smsQuietHoursEnd)
  // Invalid persisted quiet-hour data fails closed rather than sending at an
  // unexpected time.
  if (current === null || start === null || end === null) return true
  if (start === end) return true
  if (start < end) return current >= start && current < end
  return current >= start || current < end
}

export function isProjectActivitySmsEvent(eventType: string): boolean {
  return (
    eventType === "message.channel" ||
    eventType === "message.thread_reply" ||
    eventType === "message.project"
  )
}

export function shouldUseProjectActivitySmsRoute(input: {
  readonly channelType: string
  readonly recipientUserId: string
  readonly mentions: readonly SmsMessageMention[]
}): boolean {
  if (input.channelType === "announcement") return false
  return !input.mentions.some(
    (mention) =>
      mention.mentionType === "channel" ||
      mention.mentionType === "here" ||
      (mention.mentionType === "user" &&
        mention.targetId === input.recipientUserId)
  )
}

export function shouldSendSmsNotification(
  preferences: SmsPolicyPreferences,
  context: SmsNotificationContext
): boolean {
  if (
    !preferences.smsEnabled ||
    !hasCurrentSmsConsent({
      accepted: preferences.smsConsentAccepted,
      phoneNumber: preferences.smsPhoneNumber,
      consentPhoneNumber: preferences.smsConsentPhoneNumber,
      disclosureVersion: preferences.smsConsentDisclosureVersion,
    }) ||
    isDuringSmsQuietHours(preferences, context.occurredAt)
  ) {
    return false
  }

  if (context.eventType === "message.mention") {
    return preferences.mentionSmsEnabled
  }
  if (context.eventType === "announcement.message") {
    return preferences.announcementSmsEnabled
  }
  if (isProjectActivitySmsEvent(context.eventType)) {
    // Historical imports and system replays do not have a live actor and must
    // never produce a burst of project-activity texts.
    return (
      context.createdBy !== null &&
      preferences.projectActivitySmsEnabled
    )
  }
  return false
}
