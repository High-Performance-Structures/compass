import { and, eq, isNull, sql } from "drizzle-orm"
import type { getDb } from "@/db"
import { projectFollowUps, projectInteractions, projectJobStatuses, projects } from "@/db/schema"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import {
  clientFollowUpState,
  followUpThresholds,
  projectAgingLevel,
  type ProjectFollowUpSignal,
} from "@/lib/project-follow-up"

/**
 * Follow-up aging for a set of jobs, from the client contact log (the
 * project's activity tracker), any scheduled follow-up, and the company's
 * project aging settings. Jobs whose status is not followed up are left out.
 */
/** The later of the company's no-contact clock start and the job's creation. */
function noContactSince(clockStart: string | null, createdAt: string | null): string | null {
  if (!clockStart) return null
  return createdAt && createdAt > clockStart ? createdAt : clockStart
}

export async function loadProjectFollowUpSignals(
  db: ReturnType<typeof getDb>,
  organizationId: string,
  jobs: readonly { readonly id: string; readonly jobStatusId: string; readonly createdAt?: string | null }[],
  now: Date,
): Promise<ReadonlyMap<string, ProjectFollowUpSignal>> {
  if (jobs.length === 0) return new Map()
  const [settings, lastContacts, scheduled, customStatuses] = await Promise.all([
    readFeatureSettings(db, organizationId, "project-aging"),
    // Only the latest qualifying contact per project matters.
    db
      .select({
        projectId: projectInteractions.projectId,
        occurredAt: sql<string>`max(${projectInteractions.occurredAt})`,
      })
      .from(projectInteractions)
      .where(
        and(
          eq(projectInteractions.organizationId, organizationId),
          eq(projectInteractions.qualifiesForClientTouch, true),
          isNull(projectInteractions.deletedAt),
        ),
      )
      .groupBy(projectInteractions.projectId),
    db
      .select({ projectId: projectFollowUps.projectId, nextFollowUpAt: projectFollowUps.nextFollowUpAt })
      .from(projectFollowUps)
      .where(eq(projectFollowUps.organizationId, organizationId)),
    db
      .select({ id: projectJobStatuses.id, cadenceDays: projectJobStatuses.followUpCadenceDays })
      .from(projectJobStatuses)
      .where(and(eq(projectJobStatuses.organizationId, organizationId), eq(projectJobStatuses.active, true))),
  ])
  const lastContactById = new Map(lastContacts.map((row) => [row.projectId, row.occurredAt]))
  // Creation dates only matter once the company's no-contact clock is on.
  const createdAtById = new Map<string, string>()
  if (settings.noContactClockStart) {
    const created = await db
      .select({ id: projects.id, createdAt: projects.createdAt })
      .from(projects)
      .where(eq(projects.organizationId, organizationId))
    for (const row of created) createdAtById.set(row.id, row.createdAt)
  }
  const scheduledById = new Map(scheduled.map((row) => [row.projectId, row.nextFollowUpAt]))
  const customCadenceById = new Map(customStatuses.map((row) => [row.id, row.cadenceDays]))

  const signals = new Map<string, ProjectFollowUpSignal>()
  for (const job of jobs) {
    const thresholds = followUpThresholds({
      jobStatusId: job.jobStatusId,
      customCadenceDays: customCadenceById.has(job.jobStatusId) ? (customCadenceById.get(job.jobStatusId) ?? null) : undefined,
      settings,
    })
    if (!thresholds) continue
    const lastContactAt = lastContactById.get(job.id) ?? null
    const state = clientFollowUpState({
      jobStatusId: job.jobStatusId,
      thresholds,
      interactions: lastContactAt ? [{ occurredAt: lastContactAt, deletedAt: null, qualifiesForClientTouch: true }] : [],
      nextFollowUpAt: scheduledById.get(job.id) ?? null,
      now,
      noContactSince: noContactSince(settings.noContactClockStart ?? null, job.createdAt ?? createdAtById.get(job.id) ?? null),
    })
    const level = projectAgingLevel(state.state)
    if (!level) continue
    signals.set(job.id, {
      level,
      businessDaysSinceLastTouch: state.businessDaysSinceLastTouch,
      lastContactAt: state.lastClientInteractionAt,
      nextFollowUpAt: state.nextFollowUpAt,
      thresholds,
    })
  }
  return signals
}
