import { and, eq } from "drizzle-orm"

import type { getDb } from "@/db"
import {
  organizationMembers,
  projectMembers,
  projects,
  users,
} from "@/db/schema"
import {
  channelMembers,
  channelReadState,
  channels,
} from "@/db/schema-conversations"
import type { ProjectAudience } from "@/lib/project-audience-access"
import { isInternalStaffRole } from "@/lib/user-roles"

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

async function ensureMember(
  db: Db,
  channelId: string,
  userId: string,
  role: "owner" | "moderator" | "member",
  now: string
): Promise<void> {
  const existing = await db
    .select({ id: channelMembers.id })
    .from(channelMembers)
    .where(
      and(
        eq(channelMembers.channelId, channelId),
        eq(channelMembers.userId, userId)
      )
    )
    .get()

  if (!existing) {
    await db
      .insert(channelMembers)
      .values({
        id: crypto.randomUUID(),
        channelId,
        userId,
        role,
        notifyLevel: "all",
        joinedAt: now,
      })
      .run()
  }

  const readState = await db
    .select({ id: channelReadState.id })
    .from(channelReadState)
    .where(
      and(
        eq(channelReadState.channelId, channelId),
        eq(channelReadState.userId, userId)
      )
    )
    .get()

  if (!readState) {
    await db
      .insert(channelReadState)
      .values({
        id: crypto.randomUUID(),
        userId,
        channelId,
        lastReadMessageId: null,
        lastReadAt: now,
        unreadCount: 0,
      })
      .run()
  }
}

async function projectStaffUserIds(
  db: Db,
  projectId: string,
  organizationId: string
): Promise<readonly string[]> {
  const memberRows = await db
    .select({
      userId: projectMembers.userId,
      role: organizationMembers.role,
    })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .innerJoin(
      organizationMembers,
      and(
        eq(organizationMembers.userId, users.id),
        eq(organizationMembers.organizationId, organizationId)
      )
    )
    .where(
      and(eq(projectMembers.projectId, projectId), eq(users.isActive, true))
    )

  return Array.from(
    new Set(
      memberRows
        .filter((row) => isInternalStaffRole(row.role))
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
        createdBy: input.createdBy,
        sortOrder: 0,
        archivedAt: null,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .run()
  }

  const staffIds = await projectStaffUserIds(
    input.db,
    input.projectId,
    input.organizationId
  )
  const internalIds = new Set([input.createdBy, ...staffIds])
  for (const userId of internalIds) {
    await ensureMember(input.db, channelId, userId, "moderator", input.now)
  }
  if (input.externalUserId) {
    await ensureMember(
      input.db,
      channelId,
      input.externalUserId,
      "member",
      input.now
    )
  }

  return channelId
}
