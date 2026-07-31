import { and, eq, inArray, isNull } from "drizzle-orm"

import type { getDb } from "@/db"
import {
  organizationMembers,
  projectAccessInvitations,
  projectMembers,
  projects,
  users,
} from "@/db/schema"
import {
  channelMembers,
  channelReadState,
  channels,
} from "@/db/schema-conversations"
import {
  canUseProjectAudience,
  type ProjectAudience,
} from "@/lib/project-audience-access"
import { isAssignedVisibleAudienceTeamMember } from "@/lib/project-audience-team"

type Db = ReturnType<typeof getDb>
type ConversationMemberRole = "owner" | "moderator" | "member"
type DesiredMember = {
  readonly userId: string
  readonly role: ConversationMemberRole
}
type ExistingMember = DesiredMember

export type ProjectAudienceMemberReconciliation = {
  readonly addMembers: readonly DesiredMember[]
  readonly updateMembers: readonly DesiredMember[]
  readonly removeMemberUserIds: readonly string[]
  readonly addReadStateUserIds: readonly string[]
  readonly removeReadStateUserIds: readonly string[]
}

export function planProjectAudienceMemberReconciliation(input: {
  readonly existingMembers: readonly ExistingMember[]
  readonly existingReadStateUserIds: readonly string[]
  readonly desiredMembers: readonly DesiredMember[]
}): ProjectAudienceMemberReconciliation {
  const desiredByUserId = new Map(
    input.desiredMembers.map((member) => [member.userId, member])
  )
  const existingByUserId = new Map(
    input.existingMembers.map((member) => [member.userId, member])
  )
  const existingReadStateUserIds = new Set(input.existingReadStateUserIds)

  return {
    addMembers: Array.from(desiredByUserId.values()).filter(
      (member) => !existingByUserId.has(member.userId)
    ),
    updateMembers: Array.from(desiredByUserId.values()).filter((member) => {
      const existing = existingByUserId.get(member.userId)
      return existing !== undefined && existing.role !== member.role
    }),
    removeMemberUserIds: Array.from(existingByUserId.keys()).filter(
      (userId) => !desiredByUserId.has(userId)
    ),
    addReadStateUserIds: Array.from(desiredByUserId.keys()).filter(
      (userId) => !existingReadStateUserIds.has(userId)
    ),
    removeReadStateUserIds: Array.from(existingReadStateUserIds).filter(
      (userId) => !desiredByUserId.has(userId)
    ),
  }
}

export function projectAudienceChannelAudience(
  audience: ProjectAudience
): "clients" | "sub_vendors" {
  return audience === "owner" ? "clients" : "sub_vendors"
}

export function projectAudienceConversationId(input: {
  readonly projectId: string
  readonly audience: ProjectAudience
  readonly contactId: string | null
}): string {
  if (input.audience === "owner") {
    return `project-owner-${input.projectId}`
  }
  return `project-partner-${input.projectId}-${input.contactId ?? "general"}`
}

function channelName(input: {
  readonly projectNumber: string | null
  readonly projectName: string
  readonly audience: ProjectAudience
}): string {
  const projectLabel = input.projectNumber ?? input.projectName
  return input.audience === "owner"
    ? `${projectLabel} · Owner Team`
    : `${projectLabel} · Project Team`
}

async function ensureMembers(
  db: Db,
  channelId: string,
  desiredMembers: readonly DesiredMember[],
  now: string
): Promise<void> {
  const existingMembers = await db
    .select({
      userId: channelMembers.userId,
      role: channelMembers.role,
    })
    .from(channelMembers)
    .where(eq(channelMembers.channelId, channelId))

  const existingReadStates = await db
    .select({ userId: channelReadState.userId })
    .from(channelReadState)
    .where(eq(channelReadState.channelId, channelId))

  const reconciliation = planProjectAudienceMemberReconciliation({
    existingMembers: existingMembers.map((member) => ({
      userId: member.userId,
      role:
        member.role === "owner" || member.role === "moderator"
          ? member.role
          : "member",
    })),
    existingReadStateUserIds: existingReadStates.map((state) => state.userId),
    desiredMembers,
  })

  // Revoke stale access first so a partial reconciliation fails closed.
  if (reconciliation.removeReadStateUserIds.length > 0) {
    await db
      .delete(channelReadState)
      .where(
        and(
          eq(channelReadState.channelId, channelId),
          inArray(
            channelReadState.userId,
            reconciliation.removeReadStateUserIds
          )
        )
      )
      .run()
  }
  if (reconciliation.removeMemberUserIds.length > 0) {
    await db
      .delete(channelMembers)
      .where(
        and(
          eq(channelMembers.channelId, channelId),
          inArray(channelMembers.userId, reconciliation.removeMemberUserIds)
        )
      )
      .run()
  }

  for (const member of reconciliation.updateMembers) {
    await db
      .update(channelMembers)
      .set({ role: member.role })
      .where(
        and(
          eq(channelMembers.channelId, channelId),
          eq(channelMembers.userId, member.userId)
        )
      )
      .run()
  }

  if (reconciliation.addMembers.length > 0) {
    await db
      .insert(channelMembers)
      .values(reconciliation.addMembers.map((member) => ({
        id: crypto.randomUUID(),
        channelId,
        userId: member.userId,
        role: member.role,
        notifyLevel: "all",
        joinedAt: now,
      })))
      .run()
  }

  if (reconciliation.addReadStateUserIds.length > 0) {
    await db
      .insert(channelReadState)
      .values(reconciliation.addReadStateUserIds.map((userId) => ({
        id: crypto.randomUUID(),
        userId,
        channelId,
        lastReadMessageId: null,
        lastReadAt: now,
        unreadCount: 0,
      })))
      .run()
  }
}

async function organizationStaffUserIds(
  db: Db,
  organizationId: string,
  projectId: string
): Promise<readonly string[]> {
  const memberRows = await db
    .select({
      userId: organizationMembers.userId,
      email: users.email,
      organizationRole: organizationMembers.role,
      projectRole: projectMembers.role,
    })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .innerJoin(
      organizationMembers,
      and(
        eq(organizationMembers.userId, projectMembers.userId),
        eq(organizationMembers.organizationId, organizationId)
      )
    )
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        eq(users.isActive, true)
      )
    )

  return Array.from(
    new Set(
      memberRows
        .filter((row) =>
          isAssignedVisibleAudienceTeamMember({
            userId: row.userId,
            email: row.email,
            organizationRole: row.organizationRole,
            projectRole: row.projectRole,
          })
        )
        .map((row) => row.userId)
    )
  )
}

async function externalParticipantUserIds(input: {
  readonly db: Db
  readonly projectId: string
  readonly audience: ProjectAudience
  readonly contactId: string | null
  readonly requestedUserId: string | null
}): Promise<readonly string[]> {
  const projectMemberRows = await input.db
    .select({
      userId: projectMembers.userId,
      projectRole: projectMembers.role,
    })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(
      and(
        eq(projectMembers.projectId, input.projectId),
        eq(users.isActive, true)
      )
    )
  const eligibleUserIds = new Set(
    projectMemberRows
      .filter((member) =>
        canUseProjectAudience(member.projectRole, input.audience)
      )
      .map((member) => member.userId)
  )

  if (input.audience === "owner") {
    return Array.from(eligibleUserIds)
  }

  const acceptedInvitationRows = await input.db
    .select({ userId: projectAccessInvitations.acceptedBy })
    .from(projectAccessInvitations)
    .where(
      and(
        eq(projectAccessInvitations.projectId, input.projectId),
        input.contactId === null
          ? isNull(projectAccessInvitations.projectContactId)
          : eq(projectAccessInvitations.projectContactId, input.contactId),
        eq(projectAccessInvitations.status, "accepted")
      )
    )
  const acceptedUserIds = acceptedInvitationRows.flatMap((invitation) =>
    invitation.userId === null ? [] : [invitation.userId]
  )
  const participantUserIds = new Set(
    acceptedUserIds.filter((userId) => eligibleUserIds.has(userId))
  )
  // Invitation acceptance provisions the channel before the invitation row is
  // marked accepted. The requested user is still constrained by project role.
  if (
    input.requestedUserId !== null &&
    eligibleUserIds.has(input.requestedUserId)
  ) {
    participantUserIds.add(input.requestedUserId)
  }
  return Array.from(participantUserIds)
}

export async function ensureProjectAudienceConversation(input: {
  readonly db: Db
  readonly projectId: string
  readonly organizationId: string
  readonly audience: ProjectAudience
  readonly contactId: string | null
  readonly externalUserId: string | null
  readonly createdBy: string
  readonly now: string
}): Promise<string> {
  const project = await input.db
    .select({
      name: projects.name,
      projectNumber: projects.projectNumber,
    })
    .from(projects)
    .where(
      and(
        eq(projects.id, input.projectId),
        eq(projects.organizationId, input.organizationId)
      )
    )
    .get()

  if (!project) throw new Error("Project not found")

  const staffIds = await organizationStaffUserIds(
    input.db,
    input.organizationId,
    input.projectId
  )
  const externalParticipantIds = await externalParticipantUserIds({
    db: input.db,
    projectId: input.projectId,
    audience: input.audience,
    contactId: input.contactId,
    requestedUserId: input.externalUserId,
  })
  const createdBy = staffIds.includes(input.createdBy)
    ? input.createdBy
    : staffIds[0] ?? input.createdBy
  const channelId = projectAudienceConversationId({
    projectId: input.projectId,
    audience: input.audience,
    contactId: input.contactId,
  })
  const existing = await input.db
    .select({ id: channels.id })
    .from(channels)
    .where(eq(channels.id, channelId))
    .get()

  if (!existing) {
    await input.db
      .insert(channels)
      .values({
        id: channelId,
        name: channelName({
          projectNumber: project.projectNumber,
          projectName: project.name,
          audience: input.audience,
        }),
        type: "text",
        description: "Private conversation with the internal project team",
        organizationId: input.organizationId,
        projectId: input.projectId,
        categoryId: null,
        isPrivate: true,
        audience: projectAudienceChannelAudience(input.audience),
        createdBy,
        sortOrder: 0,
        archivedAt: null,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .run()
  }

  const desiredMembers: {
    userId: string
    role: "moderator" | "member"
  }[] = staffIds.map((userId) => ({
    userId,
    role: "moderator",
  }))
  for (const externalUserId of externalParticipantIds) {
    if (staffIds.includes(externalUserId)) continue
    desiredMembers.push({
      userId: externalUserId,
      role: "member",
    })
  }
  await ensureMembers(input.db, channelId, desiredMembers, input.now)

  return channelId
}
