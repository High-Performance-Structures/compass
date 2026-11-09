import { z } from "zod/v4"

import { TIME_PATTERN } from "@/lib/daily-logs/reminders"

/**
 * Kinds of notification a company can choose to send right away instead of
 * in the digest. Everything else (changes and activity) waits for the next
 * digest time.
 */
export const INSTANT_NOTIFICATION_KINDS = [
  "conversations",
  "signatures",
  "confirmations",
  "assignments",
  "system_alerts",
] as const

export type InstantNotificationKind = (typeof INSTANT_NOTIFICATION_KINDS)[number]

export const INSTANT_NOTIFICATION_KIND_LABELS: { readonly [K in InstantNotificationKind]: string } = {
  conversations: "Messages, @mentions and announcements",
  signatures: "E-signature requests and results",
  confirmations: "Schedule confirmation requests and replies",
  assignments: "Message Desk items assigned to someone",
  system_alerts: "System problems (payment or Sage connection failures)",
}

export const notificationDigestSettingsSchema = z.object({
  /** "off" sends every notification right away, as before. */
  mode: z.enum(["on", "off"]),
  /** Company-time clock times (HH:MM) the digest goes out, earliest first. */
  times: z
    .array(z.string().regex(TIME_PATTERN, "Use a time such as 12:00 or 17:00."))
    .min(1)
    .max(6),
  /** Kinds still sent right away; email, text and push only — the in-app bell is always immediate. */
  instantKinds: z.array(z.enum(INSTANT_NOTIFICATION_KINDS)),
})

export type NotificationDigestSettings = z.infer<typeof notificationDigestSettingsSchema>

export const DEFAULT_NOTIFICATION_DIGEST_SETTINGS: NotificationDigestSettings = {
  mode: "on",
  times: ["12:00", "17:00"],
  instantKinds: [...INSTANT_NOTIFICATION_KINDS],
}

export const NOTIFICATION_DIGEST_SETTINGS_GROUP = {
  label: "Notification digest",
  description: "Collect change and activity notices into one email, text and push per person at set times of day instead of one per change. The in-app bell still updates right away, the kinds you choose below are always sent right away, and anyone can turn the digest off for themselves in their notification preferences.",
  defaults: DEFAULT_NOTIFICATION_DIGEST_SETTINGS,
  schema: notificationDigestSettingsSchema,
}
