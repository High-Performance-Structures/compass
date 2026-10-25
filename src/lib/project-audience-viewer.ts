import "server-only"

import { and, desc, eq } from "drizzle-orm"
import { cache } from "react"
import { resolveProjectRouteId } from "@/lib/project-route-id"
import { getDb } from "@/db"
import { organizationMembers, organizations, projectAccessInvitations, projectContacts, projectMembers, users } from "@/db/schema"
import { requireAuth, type AuthUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { assertProjectAccess } from "@/lib/project-access"
import { canUseProjectAudience, type ProjectAudience } from "@/lib/project-audience-access"
import { getProjectAudienceRequestScope } from "@/lib/project-audience-request-server"
export { getProjectAudienceRequestScope, assertAudiencePreviewWriteAllowed } from "@/lib/project-audience-request-server"
import { canFeature } from "@/lib/permission-enforcement"
import { isInternalStaffRole } from "@/lib/user-roles"
import { recordActivityEvent } from "@/lib/activity-log"

export type ProjectAudiencePreviewPerson = {
  readonly id: string
  readonly name: string
  readonly email: string
  readonly companyName: string | null
}

export type ProjectAudienceViewerContext = {
  readonly db: ReturnType<typeof getDb>
  readonly env: unknown
  readonly actor: AuthUser
  readonly viewer: AuthUser | null
  readonly organizationId: string
  readonly projectId: string
  readonly audience: ProjectAudience
  readonly isPreview: boolean
  readonly previewOptions: readonly ProjectAudiencePreviewPerson[]
}

export const resolveProjectAudienceViewer = cache(async function resolveProjectAudienceViewer(
  requestedProjectId: string,
  audience: ProjectAudience,
  targetUserId?: string | null,
): Promise<ProjectAudienceViewerContext> {
  const projectId = await resolveProjectRouteId(requestedProjectId)
  if (!projectId) throw new Error("Project not found.")
  const actor = await requireAuth()
  if (!actor.isActive) throw new Error("Project not found.")
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const project = await assertProjectAccess(db, actor, projectId)
  if (!project.organizationId) throw new Error("Project not found.")
  const organizationId = project.organizationId
  const request = await getProjectAudienceRequestScope()
  if (request && (request.projectId !== projectId || request.audience !== audience)) {
    throw new Error("Preview scope does not match this project.")
  }
  const target = targetUserId === undefined ? request?.targetUserId ?? null : targetUserId
  const membership = await db.select({ role: organizationMembers.role, organization: organizations })
    .from(organizationMembers).innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(and(eq(organizationMembers.userId, actor.id), eq(organizationMembers.organizationId, organizationId))).get()
  if (!membership || !membership.organization.isActive) throw new Error("Project not found.")
  const isPreview = membership.organization.type === "internal" && isInternalStaffRole(membership.role)
  if (!isPreview) {
    if (target !== null) throw new Error("Preview is unavailable.")
    const projectMembership = await db.select({ role: projectMembers.role }).from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, actor.id))).get()
    if (!canUseProjectAudience(projectMembership?.role ?? null, audience)) throw new Error("Project not found.")
    return { db, env, actor, viewer: { ...actor, role: membership.role, organizationId, organizationType: membership.organization.type, organizationName: membership.organization.name }, organizationId, projectId, audience, isPreview, previewOptions: [] }
  }
  const authorizedActor: AuthUser = { ...actor, role: membership.role, organizationId, organizationType: membership.organization.type, organizationName: membership.organization.name }
  if (!(await canFeature(authorizedActor, "project-audience-preview", "read"))) throw new Error("External preview permission is required.")
  const people = await db.select({ user: users, role: organizationMembers.role, projectRole: projectMembers.role })
    .from(projectMembers).innerJoin(users, eq(users.id, projectMembers.userId))
    .innerJoin(organizationMembers, and(eq(organizationMembers.userId, users.id), eq(organizationMembers.organizationId, organizationId)))
    .where(and(eq(projectMembers.projectId, projectId), eq(users.isActive, true)))
  const eligible = people.filter((person, index) => !isInternalStaffRole(person.role) && canUseProjectAudience(person.projectRole, audience) && people.findIndex((candidate) => candidate.user.id === person.user.id) === index)
  const selected = target === null ? null : eligible.find((person) => person.user.id === target)
  if (target !== null && !selected) throw new Error("The selected person no longer has this project access.")
  const viewer: AuthUser | null = selected ? { ...selected.user, role: selected.role, organizationId, organizationType: membership.organization.type, organizationName: membership.organization.name } : null
  // Company labels are presentation only. Load accepted contact links once
  // rather than performing a contact lookup for every eligible person.
  const contactLinks = eligible.length === 0 ? [] : await db.select({ userId: projectAccessInvitations.acceptedBy, companyName: projectContacts.companyName })
    .from(projectAccessInvitations).innerJoin(projectContacts, eq(projectContacts.id, projectAccessInvitations.projectContactId))
    .where(and(eq(projectAccessInvitations.projectId, projectId), eq(projectContacts.projectId, projectId), eq(projectAccessInvitations.status, "accepted"), eq(projectContacts.active, true)))
    .orderBy(desc(projectAccessInvitations.acceptedAt))
  const previewOptions = eligible.map(({ user }): ProjectAudiencePreviewPerson => ({ id: user.id, name: user.displayName ?? user.email, email: user.email, companyName: contactLinks.find((link) => link.userId === user.id)?.companyName ?? null }))
  return { db, env, actor: authorizedActor, viewer, organizationId, projectId, audience, isPreview, previewOptions }
})

/** Audit page visits, not every poll, thumbnail, or reader resolution. */
export async function recordProjectAudiencePreviewVisit(context: ProjectAudienceViewerContext): Promise<void> {
  if (!context.isPreview || !context.viewer) return
  await recordActivityEvent({
    db: context.db,
    organizationId: context.organizationId,
    projectId: context.projectId,
    actor: context.actor,
    category: "access",
    action: "preview.external_view",
    entityType: "user",
    entityId: context.viewer.id,
    summary: "Opened a read-only external preview",
    metadata: { audience: context.audience, previewUserId: context.viewer.id },
  })
}
