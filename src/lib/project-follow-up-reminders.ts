import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm"
import type { getDb } from "@/db"
import { projectFollowUpReminders, projectFollowUps, projectInteractions, projects, users } from "@/db/schema"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { createSystemNotificationEvent } from "@/lib/notifications/create-event"
import { loadProjectFollowUpSignals } from "@/lib/project-aging-server"
import type { ProjectFollowUpSignal } from "@/lib/project-follow-up"

export const OVERDUE_FOLLOW_UP_EVENT = "project.follow_up_overdue"

type Db = ReturnType<typeof getDb>

/** How far back to look for who last contacted a job's client. */
const LAST_CONTACT_WINDOW_DAYS = 365

/**
 * Whether an overdue job needs a reminder: it's overdue (the same level the
 * map, pipeline and job pages show) and nobody has been reminded since its
 * last client contact, so each overdue stretch gets one reminder.
 */
export function overdueReminderDue(
  signal: Pick<ProjectFollowUpSignal, "level" | "lastContactAt">,
  remindedAt: string | null,
): boolean {
  if (signal.level !== "overdue") return false
  if (remindedAt === null) return true
  return signal.lastContactAt !== null && remindedAt < signal.lastContactAt
}

/**
 * Who answers for each job's follow-up: its follow-up owner, else whoever
 * last logged client contact on it.
 */
async function followUpResponsibles(db: Db, organizationId: string, now: Date): Promise<ReadonlyMap<string, string>> {
  const since = new Date(now.getTime() - LAST_CONTACT_WINDOW_DAYS * 86_400_000).toISOString()
  const [owners, contacts] = await Promise.all([
    db
      .select({ projectId: projectFollowUps.projectId, ownerUserId: projectFollowUps.ownerUserId })
      .from(projectFollowUps)
      .where(eq(projectFollowUps.organizationId, organizationId)),
    db
      .select({ projectId: projectInteractions.projectId, createdBy: projectInteractions.createdBy })
      .from(projectInteractions)
      .where(
        and(
          eq(projectInteractions.organizationId, organizationId),
          eq(projectInteractions.qualifiesForClientTouch, true),
          isNull(projectInteractions.deletedAt),
          gte(projectInteractions.occurredAt, since),
        ),
      )
      .orderBy(desc(projectInteractions.occurredAt)),
  ])
  const responsible = new Map<string, string>()
  // Newest first, so the first person seen per job is the latest contact.
  for (const row of contacts) {
    if (row.createdBy && !responsible.has(row.projectId)) responsible.set(row.projectId, row.createdBy)
  }
  for (const row of owners) {
    if (row.ownerUserId) responsible.set(row.projectId, row.ownerUserId)
  }
  return responsible
}

async function orgSignals(db: Db, organizationId: string, now: Date) {
  const jobs = await db
    .select({ id: projects.id, jobStatusId: projects.jobStatusId, name: projects.name, projectNumber: projects.projectNumber })
    .from(projects)
    .where(eq(projects.organizationId, organizationId))
  const signals = await loadProjectFollowUpSignals(db, organizationId, jobs, now)
  return { jobs, signals }
}

/** Overdue jobs this user answers for (the red count on Client follow-up). */
export async function countOverdueFollowUpsForUser(db: Db, organizationId: string, userId: string, now: Date = new Date()): Promise<number> {
  const [{ signals }, responsible] = await Promise.all([orgSignals(db, organizationId, now), followUpResponsibles(db, organizationId, now)])
  let count = 0
  for (const [projectId, signal] of signals) {
    if (signal.level === "overdue" && responsible.get(projectId) === userId) count += 1
  }
  return count
}

/**
 * Scheduled: send each overdue job's responsible person one urgent reminder
 * per overdue stretch. Honors each company's "remind on overdue" setting.
 */
export async function sendOverdueFollowUpReminders(db: Db, now: Date = new Date()): Promise<{ readonly reminded: number }> {
  const orgs = await db.selectDistinct({ organizationId: projects.organizationId }).from(projects)
  let reminded = 0
  const nowIso = now.toISOString()
  for (const { organizationId } of orgs) {
    if (!organizationId) continue
    const settings = await readFeatureSettings(db, organizationId, "project-aging")
    if (settings.remindOnOverdue === false) continue
    const { jobs, signals } = await orgSignals(db, organizationId, now)
    const overdue = jobs.filter((job) => signals.get(job.id)?.level === "overdue")
    if (overdue.length === 0) continue
    const [responsible, reminders] = await Promise.all([
      followUpResponsibles(db, organizationId, now),
      db
        .select({ projectId: projectFollowUpReminders.projectId, remindedAt: projectFollowUpReminders.remindedAt })
        .from(projectFollowUpReminders)
        .where(eq(projectFollowUpReminders.organizationId, organizationId)),
    ])
    const recipientIds = [...new Set(overdue.flatMap((job) => responsible.get(job.id) ?? []))]
    const people = []
    // Chunked to stay under D1's bound-parameter limit.
    for (let start = 0; start < recipientIds.length; start += 80) {
      people.push(
        ...(await db
          .select({ id: users.id, email: users.email, isActive: users.isActive })
          .from(users)
          .where(inArray(users.id, recipientIds.slice(start, start + 80)))),
      )
    }
    const remindedAtById = new Map(reminders.map((row) => [row.projectId, row.remindedAt]))
    const personById = new Map(people.map((row) => [row.id, row]))
    for (const job of overdue) {
      const signal = signals.get(job.id)
      if (!signal || !overdueReminderDue(signal, remindedAtById.get(job.id) ?? null)) continue
      const recipientId = responsible.get(job.id)
      const recipient = recipientId ? personById.get(recipientId) : undefined
      if (!recipient || !recipient.isActive) continue
      const label = job.projectNumber ? `${job.projectNumber} · ${job.name}` : job.name
      await createSystemNotificationEvent({
        organizationId,
        projectId: job.id,
        eventType: OVERDUE_FOLLOW_UP_EVENT,
        sourceType: "project",
        sourceId: job.id,
        title: `Client follow-up overdue: ${label}`,
        body:
          signal.businessDaysSinceLastTouch === null
            ? "No client contact has been logged on this job."
            : `No client contact logged for ${signal.businessDaysSinceLastTouch} business days.`,
        href: `/dashboard/client-follow-up?job=${encodeURIComponent(job.id)}`,
        priority: "urgent",
        audience: "follow_up_owner",
        recipients: [{ userId: recipient.id, email: recipient.email }],
        delivery: { inApp: true, email: false, push: true },
      })
      await db
        .insert(projectFollowUpReminders)
        .values({ projectId: job.id, organizationId, recipientUserId: recipient.id, remindedAt: nowIso })
        .onConflictDoUpdate({ target: projectFollowUpReminders.projectId, set: { recipientUserId: recipient.id, remindedAt: nowIso } })
      reminded += 1
    }
  }
  return { reminded }
}
