import { and, eq } from "drizzle-orm"

import type { getDb } from "@/db"
import {
  notificationDeliveries,
  notificationEvents,
  notificationRecipients,
  projects,
} from "@/db/schema"
import { companyTimeZone } from "@/lib/daily-logs/log-followups-server"
import { markDigestDeliveries } from "@/lib/domain/notifications/store"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { notificationLink, queueSmsDelivery } from "@/lib/notifications/create-event"
import {
  DIGEST_HELD_STATUS,
  DIGEST_SENT_STATUS,
  DIGEST_SKIPPED_READ_STATUS,
  digestEmailText,
  digestSubject,
  latestDigestCutoff,
  localMoment,
  type DigestItem,
} from "@/lib/notifications/digest"
import { sendPushNotification } from "@/lib/push/send"
import { dateKeyInTimeZone, timeKeyInTimeZone } from "@/lib/work-calendar"

type Db = ReturnType<typeof getDb>

/** People per run; the rest go out on the next run a few minutes later. */
const MAX_PEOPLE_PER_RUN = 150

type HeldRow = {
  readonly deliveryId: string
  readonly userId: string
  readonly channel: string
  readonly toAddress: string | null
  readonly createdAt: string
  readonly readAt: string | null
  readonly title: string
  readonly body: string
  readonly href: string
  readonly projectName: string | null
  readonly projectNumber: string | null
}

export type DigestRunSummary = {
  readonly companies: number
  readonly people: number
  readonly sent: number
  readonly skippedRead: number
  readonly failed: number
}

type SendResult = {
  readonly status: string
  readonly provider: string
  readonly providerMessageId: string | null
  readonly error: string | null
}

function projectLabel(row: HeldRow): string | null {
  if (!row.projectName) return null
  return row.projectNumber ? `${row.projectNumber} - ${row.projectName}` : row.projectName
}

async function heldRowsFor(db: Db, organizationId: string): Promise<HeldRow[]> {
  return db
    .select({
      deliveryId: notificationDeliveries.id,
      userId: notificationDeliveries.userId,
      channel: notificationDeliveries.channel,
      toAddress: notificationDeliveries.toAddress,
      createdAt: notificationDeliveries.createdAt,
      readAt: notificationRecipients.readAt,
      title: notificationEvents.title,
      body: notificationEvents.body,
      href: notificationEvents.href,
      projectName: projects.name,
      projectNumber: projects.projectNumber,
    })
    .from(notificationDeliveries)
    .innerJoin(notificationEvents, eq(notificationEvents.id, notificationDeliveries.eventId))
    .innerJoin(notificationRecipients, eq(notificationRecipients.id, notificationDeliveries.recipientId))
    .leftJoin(projects, eq(projects.id, notificationEvents.projectId))
    .where(
      and(
        eq(notificationDeliveries.status, DIGEST_HELD_STATUS),
        eq(notificationEvents.organizationId, organizationId)
      )
    )
    .orderBy(notificationDeliveries.createdAt)
}

async function sendOne(
  env: CloudflareEnv,
  db: Db,
  organizationId: string,
  userId: string,
  channel: string,
  toAddress: string | null,
  items: readonly DigestItem[]
): Promise<SendResult> {
  const projectCount = new Set(items.map((item) => item.projectLabel ?? "")).size
  const subject = digestSubject(items.length, projectCount)
  const openLink = notificationLink(env, "/dashboard")
  try {
    if (channel === "email" && toAddress) {
      const { sendCompassEmail } = await import("@/lib/email/compass-email")
      const delivery = await sendCompassEmail({
        env,
        db,
        organizationId,
        to: [toAddress],
        subject,
        text: digestEmailText(items, openLink),
      })
      return { status: delivery.status, provider: delivery.provider, providerMessageId: delivery.providerMessageId, error: delivery.error }
    }
    if (channel === "sms" && toAddress) {
      const body = items.length === 1 ? items[0]?.title ?? "" : `${items.length} updates. Open Compass for the details.`
      return await queueSmsDelivery(env, toAddress, subject, body, null)
    }
    if (channel === "push") {
      const result = await sendPushNotification(env, {
        userId,
        title: subject,
        body: items.slice(0, 3).map((item) => item.title).join(" · "),
        data: { url: "/dashboard", href: "/dashboard", eventType: "notification.digest" },
      })
      const status = result.failed > 0 ? "failed" : result.sent > 0 ? "sent" : "skipped_no_token"
      return { status, provider: "native_push", providerMessageId: null, error: result.failed > 0 ? `${result.failed} push delivery attempt(s) failed` : null }
    }
    return { status: "failed", provider: "digest", providerMessageId: null, error: `No address for ${channel}` }
  } catch (error) {
    return { status: "failed", provider: "digest", providerMessageId: null, error: error instanceof Error ? error.message.slice(0, 500) : "Digest delivery failed" }
  }
}

/**
 * Scheduled: sends each person one summary per channel (email, text, push)
 * of the notices held since the last digest time. Notices already read in
 * Compass are dropped from the summary. A company that turned the digest off
 * gets anything still held sent at once.
 */
export async function sendNotificationDigests(
  db: Db,
  env: CloudflareEnv,
  now = new Date()
): Promise<DigestRunSummary> {
  const organizations = await db
    .selectDistinct({ organizationId: notificationEvents.organizationId })
    .from(notificationDeliveries)
    .innerJoin(notificationEvents, eq(notificationEvents.id, notificationDeliveries.eventId))
    .where(eq(notificationDeliveries.status, DIGEST_HELD_STATUS))

  let people = 0
  let sent = 0
  let skippedRead = 0
  let failed = 0
  for (const { organizationId } of organizations) {
    const settings = await readFeatureSettings(db, organizationId, "notification-digest")
    const timeZone = await companyTimeZone(db, organizationId)
    const toLocal = (instant: Date): string =>
      localMoment(dateKeyInTimeZone(instant, timeZone), timeKeyInTimeZone(instant, timeZone))
    // With the digest off, everything still held is due now ("~" sorts after
    // any time, so this minute's notices count too).
    const cutoff = settings.mode === "on"
      ? latestDigestCutoff(settings.times, dateKeyInTimeZone(now, timeZone), timeKeyInTimeZone(now, timeZone))
      : `${toLocal(now)}~`
    const due = (await heldRowsFor(db, organizationId)).filter(
      (row) => toLocal(new Date(row.createdAt)) < cutoff
    )

    const groups = new Map<string, HeldRow[]>()
    for (const row of due) {
      const key = `${row.userId}\u0000${row.channel}`
      groups.set(key, [...(groups.get(key) ?? []), row])
    }
    const userIds = new Set<string>()
    for (const rows of groups.values()) {
      const first = rows[0]
      if (!first) continue
      if (!userIds.has(first.userId) && userIds.size >= MAX_PEOPLE_PER_RUN) continue
      userIds.add(first.userId)
      const attemptedAt = new Date().toISOString()
      const read = rows.filter((row) => row.readAt !== null)
      const unread = rows.filter((row) => row.readAt === null)
      if (read.length > 0) {
        await markDigestDeliveries(db, read.map((row) => row.deliveryId), {
          status: DIGEST_SKIPPED_READ_STATUS, provider: "digest", providerMessageId: null, error: null, attemptedAt,
        })
        skippedRead += read.length
      }
      if (unread.length === 0) continue
      const items = unread.map((row): DigestItem => ({
        title: row.title,
        body: row.body,
        link: notificationLink(env, row.href),
        projectLabel: projectLabel(row),
      }))
      const result = await sendOne(env, db, organizationId, first.userId, first.channel, first.toAddress, items)
      const ok = result.status !== "failed"
      await markDigestDeliveries(db, unread.map((row) => row.deliveryId), {
        status: ok ? DIGEST_SENT_STATUS : "failed",
        provider: result.provider,
        providerMessageId: result.providerMessageId,
        error: result.error,
        attemptedAt,
      })
      if (ok) sent += unread.length
      else failed += unread.length
    }
    people += userIds.size
  }
  return { companies: organizations.length, people, sent, skippedRead, failed }
}

