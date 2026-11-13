import { and, eq, inArray, isNull, isNotNull } from "drizzle-orm"

import { projects } from "@/db/schema"
import { channelMembers, channelReadState, channels } from "@/db/schema-conversations"
import { chunkD1Values } from "@/lib/d1-query"
import { peopleView } from "@/lib/domain/identity/views"
import { projectMembersView } from "@/lib/domain/project/views"
import {
  insertChannelMembers,
  insertReadStates,
  removeUserFromChannels,
} from "@/lib/domain/conversations/store"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { canUseProjectAudience } from "@/lib/project-audience-access"
import type { Db } from "@/lib/server/action-context"
import { isInternalStaffRole } from "@/lib/user-roles"

/*
 * Clients on the same job share that job's client conversations (company
 * setting "Client conversations", on by default). Every person whose project
 * membership is a client/owner role joins every open `clients` conversation
 * on the job, including imported threads and emails that came through
 * another client. Vendor conversations are never touched, and a job marked
 * staff-only keeps its imported threads closed to clients.
 *
 * Joining is silent: no notification, no email, and nothing becomes unread.
 * Runs when a client is approved or invited, when staff share an imported
 * thread with clients, and when the setting is saved or reset (which catches
 * up every job). Turning the setting off stops new joins; it removes no one.
 *
 * The other direction: when someone outside the company loses their place on
 * a job, `removeLostJobConversationAccess` takes them out of that job's client
 * and vendor conversations, so a removed co-owner keeps none of the threads.
 */

const projectMemberships = projectMembersView()
const people = peopleView()

type ClientChannel = { readonly id: string; readonly projectId: string }
type Membership = { readonly channelId: string; readonly userId: string }

function membershipKey(member: Membership): string {
  return `${member.channelId}\u0000${member.userId}`
}

/** Every (client conversation, client on its job) pair not in `existing`. */
function missingMemberships(
  channelRows: readonly ClientChannel[],
  clientsByProject: ReadonlyMap<string, readonly string[]>,
  existing: readonly Membership[]
): Membership[] {
  const have = new Set(existing.map(membershipKey))
  const missing: Membership[] = []
  for (const channel of channelRows) {
    for (const userId of clientsByProject.get(channel.projectId) ?? []) {
      if (!have.has(membershipKey({ channelId: channel.id, userId }))) missing.push({ channelId: channel.id, userId })
    }
  }
  return missing
}

async function clientChannels(db: Db, organizationId: string, projectId: string | null): Promise<ClientChannel[]> {
  const rows = await db
    .select({
      id: channels.id,
      projectId: channels.projectId,
      sourceSystem: channels.sourceSystem,
      staffOnly: projects.importedConversationsStaffOnly,
    })
    .from(channels)
    .innerJoin(projects, eq(projects.id, channels.projectId))
    .where(
      and(
        eq(channels.organizationId, organizationId),
        // A channel whose job belongs to another company is never shared from here.
        eq(projects.organizationId, organizationId),
        eq(channels.audience, "clients"),
        isNull(channels.archivedAt),
        isNotNull(channels.projectId),
        projectId === null ? undefined : eq(channels.projectId, projectId)
      )
    )
  return rows.flatMap((row) =>
    // A staff-only job (for example under a legal hold) never opens imported threads to clients.
    row.projectId === null || (row.sourceSystem !== null && row.staffOnly) ? [] : [{ id: row.id, projectId: row.projectId }]
  )
}

async function clientsByProject(db: Db, projectIds: readonly string[]): Promise<Map<string, string[]>> {
  const byProject = new Map<string, string[]>()
  for (const chunk of chunkD1Values(projectIds)) {
    const rows = await db
      .select({ projectId: projectMemberships.projectId, userId: projectMemberships.userId, role: projectMemberships.role })
      .from(projectMemberships)
      .innerJoin(people, eq(people.id, projectMemberships.userId))
      .where(and(inArray(projectMemberships.projectId, chunk), eq(people.isActive, true)))
    for (const row of rows) {
      if (!canUseProjectAudience(row.role, "owner")) continue
      byProject.set(row.projectId, [...(byProject.get(row.projectId) ?? []), row.userId])
    }
  }
  return byProject
}

/** Who already has a membership, and who already has a read state, in the company's client conversations. */
async function existingClientChannelRows(
  db: Db,
  organizationId: string,
  projectId: string | null
): Promise<{ readonly members: Membership[]; readonly readStates: Membership[] }> {
  const scope = and(
    eq(channels.organizationId, organizationId),
    eq(channels.audience, "clients"),
    projectId === null ? undefined : eq(channels.projectId, projectId)
  )
  const members = await db
    .select({ channelId: channelMembers.channelId, userId: channelMembers.userId })
    .from(channelMembers)
    .innerJoin(channels, eq(channels.id, channelMembers.channelId))
    .where(scope)
  const readStates = await db
    .select({ channelId: channelReadState.channelId, userId: channelReadState.userId })
    .from(channelReadState)
    .innerJoin(channels, eq(channels.id, channelReadState.channelId))
    .where(scope)
  return { members, readStates }
}

/**
 * Joins every client on the job (or, with `projectId: null`, on every job in
 * the company) to the job's client conversations they are missing. Returns
 * how many memberships were added.
 */
export async function shareClientConversations(input: {
  readonly db: Db
  readonly organizationId: string
  readonly projectId: string | null
  readonly now: string
}): Promise<number> {
  const settings = await readFeatureSettings(input.db, input.organizationId, "client-conversations")
  if (!settings.shareAmongClients) return 0

  const channelRows = await clientChannels(input.db, input.organizationId, input.projectId)
  if (channelRows.length === 0) return 0
  const clients = await clientsByProject(input.db, [...new Set(channelRows.map((channel) => channel.projectId))])
  if (clients.size === 0) return 0
  const existing = await existingClientChannelRows(input.db, input.organizationId, input.projectId)
  // Members and read states are each worked out on their own, so a run that
  // stopped part way is finished by the next one.
  const newMembers = missingMemberships(channelRows, clients, existing.members)
  const newReadStates = missingMemberships(channelRows, clients, existing.readStates)

  await insertChannelMembers(
    input.db,
    newMembers.map((member) => ({
      id: crypto.randomUUID(),
      channelId: member.channelId,
      userId: member.userId,
      role: "member",
      notifyLevel: "all",
      joinedAt: input.now,
    })),
    { ignoreConflict: true }
  )
  await insertReadStates(
    input.db,
    newReadStates.map((member) => ({
      id: crypto.randomUUID(),
      userId: member.userId,
      channelId: member.channelId,
      lastReadMessageId: null,
      lastReadAt: input.now,
      unreadCount: 0,
    })),
    { ignoreConflict: true }
  )
  return newMembers.length
}

/**
 * Sharing for one job, logged instead of thrown, for flows (client approval,
 * sharing a thread) that must not fail because the extra joins did. Saving
 * the setting catches the job up later.
 */
export async function shareClientConversationsQuietly(input: Parameters<typeof shareClientConversations>[0]): Promise<void> {
  try {
    await shareClientConversations(input)
  } catch (error) {
    console.error(`[client-conversations] sharing failed for project ${input.projectId ?? "all"}: ${error instanceof Error ? error.name : "Unknown error"}`)
  }
}

/**
 * Takes people who just lost their place on a job (or, with `projectId: null`,
 * on any job in the company) out of that job's client and vendor
 * conversations when they no longer hold a project role for that audience.
 * Internal staff are never removed. Returns how many memberships were removed.
 */
export async function removeLostJobConversationAccess(input: {
  readonly db: Db
  readonly organizationId: string
  readonly projectId: string | null
  readonly userIds: readonly string[]
}): Promise<number> {
  let removed = 0
  for (const userIds of chunkD1Values([...new Set(input.userIds)])) {
    const rows = await input.db
      .select({
        channelId: channelMembers.channelId,
        userId: channelMembers.userId,
        projectId: channels.projectId,
        audience: channels.audience,
        accountRole: people.role,
      })
      .from(channelMembers)
      .innerJoin(channels, eq(channels.id, channelMembers.channelId))
      .innerJoin(people, eq(people.id, channelMembers.userId))
      .where(
        and(
          eq(channels.organizationId, input.organizationId),
          inArray(channels.audience, ["clients", "sub_vendors"]),
          inArray(channelMembers.userId, userIds),
          input.projectId === null ? isNotNull(channels.projectId) : eq(channels.projectId, input.projectId)
        )
      )
    const external = rows.filter((row) => !isInternalStaffRole(row.accountRole))
    const projectIds = [...new Set(external.flatMap((row) => (row.projectId === null ? [] : [row.projectId])))]
    const roles = new Map<string, string>()
    for (const chunk of chunkD1Values(projectIds)) {
      const memberships = await input.db
        .select({ projectId: projectMemberships.projectId, userId: projectMemberships.userId, role: projectMemberships.role })
        .from(projectMemberships)
        .where(and(inArray(projectMemberships.projectId, chunk), inArray(projectMemberships.userId, userIds)))
      for (const membership of memberships) roles.set(`${membership.projectId}\u0000${membership.userId}`, membership.role)
    }
    const stale = external.filter((row) => {
      const role = row.projectId === null ? undefined : roles.get(`${row.projectId}\u0000${row.userId}`)
      return !canUseProjectAudience(role ?? null, row.audience === "clients" ? "owner" : "sub_vendor")
    })
    const channelsByUser = new Map<string, string[]>()
    for (const row of stale) channelsByUser.set(row.userId, [...(channelsByUser.get(row.userId) ?? []), row.channelId])
    for (const [userId, channelIds] of channelsByUser) {
      await removeUserFromChannels(input.db, userId, channelIds)
      removed += channelIds.length
    }
  }
  return removed
}
