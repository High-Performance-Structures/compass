/**
 * Client follow-up: who may own it, the company-wide queue, and setting,
 * snoozing, or clearing a project's next follow-up. Each change is audited.
 */
import { and, asc, desc, eq, isNull } from "drizzle-orm"

import {
  organizationMembers,
  projectFollowUps,
  projectInteractions,
  projectJobStatuses,
  projects,
  users,
} from "@/db/schema"
import { isDemoUser } from "@/lib/demo"
import { buildFollowUpQueue, followUpOwners, type ProjectFollowUpOwner, type ProjectFollowUpQueueItem } from "@/lib/domain/crm/rules"
import { deleteProjectFollowUps, upsertProjectFollowUp } from "@/lib/domain/crm/store"
import { recordProjectAudit } from "@/lib/domain/project-audit/store"
import { profileOrgContext, projectProfileContext } from "@/lib/domain/project/profile-access"
import type { ProjectProfileResult } from "@/lib/domain/project/profile-rules"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { canFeature } from "@/lib/permission-enforcement"
import { isEligibleFollowUpOwner } from "@/lib/project-profile"
import type { Db } from "@/lib/server/action-context"
import { cleanText } from "@/lib/shared/guards"
import { isInternalStaffRole } from "@/lib/user-roles"

async function activeMemberOwners(db: Db, organizationId: string): Promise<readonly ProjectFollowUpOwner[]> {
  const members = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      email: users.email,
      active: users.isActive,
      role: organizationMembers.role,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(and(eq(organizationMembers.organizationId, organizationId), eq(users.isActive, true)))
    .orderBy(asc(users.displayName), asc(users.email))
  return followUpOwners(members)
}

export async function loadProjectFollowUpOwners(projectId: string): Promise<readonly ProjectFollowUpOwner[]> {
  const { db, organizationId } = await projectProfileContext(projectId, "read")
  return activeMemberOwners(db, organizationId)
}

/** Staff who can own client follow-up, for company-wide settings (no project needed). */
export async function loadOrganizationFollowUpOwners(): Promise<readonly ProjectFollowUpOwner[]> {
  const { db, organizationId, user } = await profileOrgContext()
  if (!isInternalStaffRole(user.role)) return []
  return activeMemberOwners(db, organizationId)
}

export async function loadProjectFollowUpQueue(): Promise<readonly ProjectFollowUpQueueItem[]> {
  const { db, organizationId, user } = await profileOrgContext()
  // The Project Hub permission was once called without await, so it never
  // blocked; a denied override now hides the queue like a non-staff viewer.
  if (!isInternalStaffRole(user.role) || !(await canFeature(user, "project-hub", "read"))) return []
  const [rows, customStatuses, agingSettings] = await Promise.all([
    db
      .select({
        projectId: projects.id,
        projectNumber: projects.projectNumber,
        projectName: projects.name,
        clientName: projects.clientName,
        clientStatus: projects.clientStatus,
        jobStatusId: projects.jobStatusId,
        occurredAt: projectInteractions.occurredAt,
        nextFollowUpAt: projectFollowUps.nextFollowUpAt,
        ownerName: users.displayName,
      })
      .from(projects)
      .leftJoin(projectFollowUps, eq(projectFollowUps.projectId, projects.id))
      .leftJoin(
        organizationMembers,
        and(
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.userId, projectFollowUps.ownerUserId),
        ),
      )
      .leftJoin(users, and(eq(users.id, organizationMembers.userId), eq(users.isActive, true)))
      .leftJoin(
        projectInteractions,
        and(
          eq(projectInteractions.projectId, projects.id),
          eq(projectInteractions.qualifiesForClientTouch, true),
          isNull(projectInteractions.deletedAt),
        ),
      )
      .where(eq(projects.organizationId, organizationId))
      .orderBy(desc(projectInteractions.occurredAt)),
    db
      .select({
        id: projectJobStatuses.id,
        label: projectJobStatuses.label,
        cadenceDays: projectJobStatuses.followUpCadenceDays,
      })
      .from(projectJobStatuses)
      .where(
        and(
          eq(projectJobStatuses.organizationId, organizationId),
          eq(projectJobStatuses.active, true),
        ),
      ),
    readFeatureSettings(db, organizationId, "project-aging"),
  ])
  return buildFollowUpQueue({ rows, customStatuses, agingSettings, now: new Date() })
}

export async function scheduleProjectFollowUp(input: {
  readonly projectId: string
  readonly nextFollowUpAt: string
  readonly ownerUserId: string | null
}): Promise<ProjectProfileResult> {
  const nextFollowUpAt = cleanText(input.nextFollowUpAt)
  if (!nextFollowUpAt || Number.isNaN(new Date(nextFollowUpAt).getTime())) {
    return { success: false, error: "Choose a valid follow-up date." }
  }
  const { db, organizationId, user } = await projectProfileContext(input.projectId, "update")
  if (isDemoUser(user.id)) return { success: false, error: "Demo data cannot be changed." }
  if (input.ownerUserId) {
    const ownerRows = await db
      .select({ active: users.isActive, role: organizationMembers.role })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.userId, input.ownerUserId),
        ),
      )
      .limit(1)
    if (!ownerRows[0] || !isEligibleFollowUpOwner(ownerRows[0])) {
      return { success: false, error: "Choose an active internal organization member." }
    }
  }
  const timestamp = new Date().toISOString()
  await upsertProjectFollowUp(
    db,
    {
      projectId: input.projectId,
      organizationId,
      nextFollowUpAt: new Date(nextFollowUpAt).toISOString(),
      ownerUserId: input.ownerUserId,
      createdBy: user.id,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      target: projectFollowUps.projectId,
      set: { nextFollowUpAt: new Date(nextFollowUpAt).toISOString(), ownerUserId: input.ownerUserId, updatedAt: timestamp },
    },
  )
  await recordProjectAudit(db, {
    organizationId,
    projectId: input.projectId,
    actorUserId: user.id,
    eventType: "project_follow_up_set",
    entityType: "project_follow_up",
    entityId: input.projectId,
    beforeJson: JSON.stringify(null),
    afterJson: JSON.stringify({ nextFollowUpAt, ownerUserId: input.ownerUserId }),
    createdAt: new Date().toISOString(),
  })
  return { success: true }
}

/**
 * Push the next follow-up to a later date, keeping its owner. Used by
 * "Snooze" on the map and the project's follow-up tracker.
 */
export async function postponeProjectFollowUp(input: {
  readonly projectId: string
  readonly nextFollowUpAt: string
}): Promise<ProjectProfileResult> {
  const next = new Date(input.nextFollowUpAt)
  if (Number.isNaN(next.getTime()) || next.getTime() <= Date.now()) {
    return { success: false, error: "Choose a future follow-up date." }
  }
  const { db, organizationId, user } = await projectProfileContext(input.projectId, "update")
  if (isDemoUser(user.id)) return { success: false, error: "Demo data cannot be changed." }
  const before = await db
    .select({ nextFollowUpAt: projectFollowUps.nextFollowUpAt })
    .from(projectFollowUps)
    .where(eq(projectFollowUps.projectId, input.projectId))
    .limit(1)
    .then((rows) => rows[0] ?? null)
  const timestamp = new Date().toISOString()
  await upsertProjectFollowUp(
    db,
    {
      projectId: input.projectId,
      organizationId,
      nextFollowUpAt: next.toISOString(),
      ownerUserId: null,
      createdBy: user.id,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      target: projectFollowUps.projectId,
      set: { nextFollowUpAt: next.toISOString(), updatedAt: timestamp },
    },
  )
  await recordProjectAudit(db, {
    organizationId,
    projectId: input.projectId,
    actorUserId: user.id,
    eventType: "project_follow_up_snoozed",
    entityType: "project_follow_up",
    entityId: input.projectId,
    beforeJson: JSON.stringify(before),
    afterJson: JSON.stringify({ nextFollowUpAt: next.toISOString() }),
    createdAt: new Date().toISOString(),
  })
  return { success: true }
}

/** Returns whether there was a follow-up to clear (nothing to revalidate otherwise). */
export async function removeProjectFollowUp(projectId: string): Promise<ProjectProfileResult & { readonly changed: boolean }> {
  const { db, organizationId, user } = await projectProfileContext(projectId, "update")
  if (isDemoUser(user.id)) return { success: false, error: "Demo data cannot be changed.", changed: false }
  const followUpRows = await db
    .select({ nextFollowUpAt: projectFollowUps.nextFollowUpAt, ownerUserId: projectFollowUps.ownerUserId })
    .from(projectFollowUps)
    .where(eq(projectFollowUps.projectId, projectId))
    .limit(1)
  const followUp = followUpRows[0]
  if (!followUp) return { success: true, changed: false }
  await deleteProjectFollowUps(db, eq(projectFollowUps.projectId, projectId))
  await recordProjectAudit(db, {
    organizationId,
    projectId,
    actorUserId: user.id,
    eventType: "project_follow_up_cleared",
    entityType: "project_follow_up",
    entityId: projectId,
    beforeJson: JSON.stringify(followUp),
    afterJson: JSON.stringify(null),
    createdAt: new Date().toISOString(),
  })
  return { success: true, changed: true }
}
