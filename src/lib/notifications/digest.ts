import type {
  InstantNotificationKind,
  NotificationDigestSettings,
} from "@/lib/feature-settings/notification-digest-settings"
import { shiftDateKey } from "@/lib/project-timeline/model"

/** Delivery status of an email, text or push waiting for the next digest. */
export const DIGEST_HELD_STATUS = "held_for_digest"

/** Delivery status once a held notice went out inside a digest. */
export const DIGEST_SENT_STATUS = "sent_in_digest"

/** Delivery status of a held notice the person had already read in Compass. */
export const DIGEST_SKIPPED_READ_STATUS = "skipped_already_read"

/** Which instant kind an event type belongs to, or null for changes and activity. */
export function instantKindOf(eventType: string): InstantNotificationKind | null {
  if (
    eventType.startsWith("message.") ||
    eventType === "project_message" ||
    eventType === "announcement.message" ||
    eventType === "cherish.story_reply"
  ) {
    return "conversations"
  }
  if (eventType.startsWith("esign.")) return "signatures"
  if (
    eventType === "schedule.confirmation_reminder" ||
    eventType === "schedule.confirmed" ||
    eventType === "schedule.declined" ||
    eventType === "schedule.proposed"
  ) {
    return "confirmations"
  }
  if (eventType === "staff_message.assigned") return "assignments"
  if (eventType.endsWith(".failed") || eventType === "sms.test") return "system_alerts"
  return null
}

/**
 * Whether email, text and push for this notice wait for the digest. The
 * in-app bell is never held.
 */
export function holdsForDigest(
  settings: NotificationDigestSettings,
  eventType: string,
  changesRightAway: boolean
): boolean {
  if (settings.mode !== "on" || changesRightAway) return false
  const kind = instantKindOf(eventType)
  return kind === null || !settings.instantKinds.includes(kind)
}

/** "YYYY-MM-DD HH:MM", so local moments compare as strings. */
export type LocalMoment = string

export function localMoment(dateKey: string, timeKey: string): LocalMoment {
  return `${dateKey} ${timeKey}`
}

/**
 * The most recent digest time at or before now, in company time. Before the
 * first time of the day it is yesterday's last time. Notices held before it
 * are due.
 */
export function latestDigestCutoff(
  times: readonly string[],
  today: string,
  nowTime: string
): LocalMoment {
  const sorted = [...times].sort()
  const passed = sorted.filter((time) => time <= nowTime)
  const latestToday = passed.at(-1)
  if (latestToday !== undefined) return localMoment(today, latestToday)
  const lastTime = sorted.at(-1) ?? "00:00"
  return localMoment(shiftDateKey(today, -1), lastTime)
}

export type DigestItem = {
  readonly title: string
  readonly body: string
  readonly link: string
  readonly projectLabel: string | null
}

/** One summary for one person: notices grouped by project, oldest first. */
export function digestEmailText(items: readonly DigestItem[], openLink: string): string {
  const groups = new Map<string, DigestItem[]>()
  for (const item of items) {
    const key = item.projectLabel ?? "General"
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  const sections = [...groups.entries()].map(([label, group]) => [
    label,
    ...group.map((item) => `- ${item.title}\n  ${item.body}\n  ${item.link}`),
  ].join("\n"))
  return [
    `${items.length} ${items.length === 1 ? "update" : "updates"} since the last summary.`,
    "",
    sections.join("\n\n"),
    "",
    `Open Compass: ${openLink}`,
  ].join("\n")
}

export function digestSubject(count: number, projectCount: number): string {
  const updates = `${count} ${count === 1 ? "update" : "updates"}`
  if (projectCount <= 1) return `Compass summary: ${updates}`
  return `Compass summary: ${updates} on ${projectCount} projects`
}
