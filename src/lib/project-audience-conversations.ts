import { and, eq } from "drizzle-orm"

import type { getDb } from "@/db"
import {
  organizationMembers,
  projects,
  users,
} from "@/db/schema"
import {
  channelMembers,
  channelReadState,
  channels,
} from "@/db/schema-conversations"
import type { ProjectAudience } from "@/lib/project-audience-access"
import { isVisibleAudienceTeamMember } from "@/lib/project-audience-team"

type Db = ReturnType<typeof getDb>

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
  desiredMembers: readonly {
    readonly userId: string
    readonly role: "owner" | "moderator" | "member"
  }[],
  now: string
): Promise<void> {
  const existingMembers = await db
    .select({ userId: channelMembers.userId })
    .from(channelMembers)
    .where(eq(channelMembers.channelId, channelId))

  const existingMemberIds = new Set(
    existingMembers.map((member) => member.userId)
  )
  const missingMembers = desiredMembers.filter(
    (member) => !existingMemberIds.has(member.userId)
  )
  if (missingMembers.length > 0) {
    await db
      .insert(channelMembers)
      .values(missingMembers.map((member) => ({
        id: crypto.randomUUID(),
        channelId,
        userId: member.userId,
        role: member.role,
        notifyLevel: "all",
        joinedAt: now,
      })))
      .run()
  }

  const existingReadStates = await db
    .select({ userId: channelReadState.userId })
    .from(channelReadState)
    .where(eq(channelReadState.channelId, channelId))

  const existingReadStateUserIds = new Set(
    existingReadStates.map((state) => state.userId)
  )
  const missingReadStates = desiredMembers.filter(
    (member) => !existingReadStateUserIds.has(member.userId)
  )
  if (missingReadStates.length > 0) {
    await db
      .insert(channelReadState)
      .values(missingReadStates.map((member) => ({
        id: crypto.randomUUID(),
        userId: member.userId,
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
  organizationId: string
): Promise<readonly string[]> {
  const memberRows = await db
    .select({
      userId: organizationMembers.userId,
      email: users.email,
      role: organizationMembers.role,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(users.isActive, true)
      )
    )

  return Array.from(
    new Set(
      memberRows
        .filter((row) =>
          isVisibleAudienceTeamMember({
            userId: row.userId,
            email: row.email,
            role: row.role,
          })
        )
        .map((row) => row.userId)
    )
  )
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
    input.organizationId
  )
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
  if (input.externalUserId && !staffIds.includes(input.externalUserId)) {
    desiredMembers.push({
      userId: input.externalUserId,
      role: "member",
    })
  }
  await ensureMembers(input.db, channelId, desiredMembers, input.now)

  return channelId
}
