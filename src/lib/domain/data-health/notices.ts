/**
 * The "Data health" notice (issue #1329): tells each company's chosen staff
 * (its administrators unless Settings › Workflows › Data health names other
 * people) what the daily drift check found. Staff-only and in-app.
 * Deployment-wide drift (the schema, rows with no company) goes only to the
 * operating company when DATA_HEALTH_OPERATOR_ORGANIZATION_ID names one.
 *
 * No daily spam: a company gets a notice only when the drift it sees
 * changes (which values or schema differences, not their row counts), and
 * one more when the drift clears. A company that never had drift hears
 * nothing. The last notice's fingerprint is its notification source id, so
 * no extra table is needed. A new notice dismisses the earlier ones.
 */
import { and, eq, inArray, isNull, max } from "drizzle-orm"

import { notificationEvents, notificationRecipients } from "@/db/schema-notifications"
import { isDemoOrg } from "@/lib/demo"
import { activeInternalCompanyStaff } from "@/lib/domain/identity/reads"
import { dismissNotificationRecipients } from "@/lib/domain/notifications/store"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { createSystemNotificationEvent } from "@/lib/notifications/events"
import type { Db } from "@/lib/server/action-context"
import { isAdminRole } from "@/lib/user-roles"

import { HEALTHY_FINGERPRINT, driftFingerprint, driftNotice, reportForOrganization, seesDeploymentDrift, shouldNotify, type DataHealthReport } from "./rules"

const SOURCE_TYPE = "data_health"
const EVENT_TYPE = "data_health.drift"
const DATA_HEALTH_HREF = "/dashboard/settings?section=workflows&workflow=data-health"

export type DataHealthNoticeSummary = {
  readonly companies: number
  readonly notified: number
  readonly unchanged: number
  readonly turnedOff: number
  /** Companies with drift to report but no active administrator or chosen person. */
  readonly withoutRecipients: number
}

type Recipient = { readonly userId: string; readonly email: string }

/** The fingerprint of each company's latest data health notice. */
async function latestFingerprints(db: Db): Promise<ReadonlyMap<string, string | null>> {
  // SQLite returns the other columns from the row that holds MAX(created_at).
  const rows = await db
    .select({ organizationId: notificationEvents.organizationId, sourceId: notificationEvents.sourceId, createdAt: max(notificationEvents.createdAt) })
    .from(notificationEvents)
    .where(and(eq(notificationEvents.sourceType, SOURCE_TYPE), eq(notificationEvents.eventType, EVENT_TYPE)))
    .groupBy(notificationEvents.organizationId)
  return new Map(rows.map((row) => [row.organizationId, row.sourceId]))
}

async function dismissEarlierNotices(db: Db, organizationIds: readonly string[], dismissedAt: string): Promise<void> {
  if (organizationIds.length === 0) return
  const open = await db
    .select({ id: notificationRecipients.id })
    .from(notificationRecipients)
    .innerJoin(notificationEvents, eq(notificationEvents.id, notificationRecipients.eventId))
    .where(
      and(
        eq(notificationEvents.sourceType, SOURCE_TYPE),
        eq(notificationEvents.eventType, EVENT_TYPE),
        inArray(notificationEvents.organizationId, [...organizationIds]),
        isNull(notificationRecipients.dismissedAt),
      ),
    )
  await dismissNotificationRecipients(db, open.map((row) => row.id), dismissedAt)
}

/** Sends each company the notice its part of the report calls for, if any. */
export async function sendDataHealthNotices(
  db: Db,
  report: DataHealthReport,
  operatorOrganizationId: string | null,
  now: Date = new Date(),
): Promise<DataHealthNoticeSummary> {
  const staff = await activeInternalCompanyStaff(db)
  const organizationIds = [...new Set(staff.map((person) => person.organizationId))].filter((id) => !isDemoOrg(id))
  const [settings, latest] = await Promise.all([
    Promise.all(organizationIds.map(async (id) => [id, await readFeatureSettings(db, id, "data-health")] as const)),
    latestFingerprints(db),
  ])

  let unchanged = 0
  let turnedOff = 0
  let withoutRecipients = 0
  const due: { readonly organizationId: string; readonly fingerprint: string; readonly report: DataHealthReport; readonly recipients: readonly Recipient[] }[] = []
  for (const [organizationId, setting] of settings) {
    if (!setting.notices) {
      turnedOff += 1
      continue
    }
    const companyReport = reportForOrganization(report, organizationId, seesDeploymentDrift(organizationId, operatorOrganizationId))
    const fingerprint = driftFingerprint(companyReport)
    const previous = latest.get(organizationId) ?? null
    if (!shouldNotify(previous, fingerprint)) {
      unchanged += 1
      continue
    }
    const companyStaff = staff.filter((person) => person.organizationId === organizationId)
    const chosen = companyStaff.filter((person) => setting.recipientUserIds.includes(person.userId))
    // Nobody chosen, or everyone chosen has left: the administrators.
    const recipients = (chosen.length > 0 ? chosen : companyStaff.filter((person) => isAdminRole(person.role))).map((person) => ({
      userId: person.userId,
      email: person.email,
    }))
    if (recipients.length > 0) due.push({ organizationId, fingerprint, report: companyReport, recipients })
    else withoutRecipients += 1
  }

  await dismissEarlierNotices(db, due.map((item) => item.organizationId), now.toISOString())
  // A handful of companies at most; each notice is its own event.
  for (const item of due) {
    const notice = driftNotice(item.report)
    await createSystemNotificationEvent({
      organizationId: item.organizationId,
      projectId: null,
      eventType: EVENT_TYPE,
      sourceType: SOURCE_TYPE,
      sourceId: item.fingerprint,
      title: notice.title,
      body: notice.body,
      href: DATA_HEALTH_HREF,
      priority: item.fingerprint === HEALTHY_FINGERPRINT ? "normal" : "high",
      audience: "internal",
      recipients: item.recipients,
      delivery: { inApp: true, email: false, push: false },
    })
  }
  return { companies: organizationIds.length, notified: due.length, unchanged, turnedOff, withoutRecipients }
}
