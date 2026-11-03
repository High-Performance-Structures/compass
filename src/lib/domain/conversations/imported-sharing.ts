import { and, eq, sql } from "drizzle-orm"

import { projectContacts, projects, users } from "@/db/schema"
import { channels } from "@/db/schema-conversations"
import { projectSourceRecordParticipants } from "@/db/schema-participants"
import {
  insertChannelMembers,
  insertReadStates,
  openImportedChannelAudience,
} from "@/lib/domain/conversations/store"
import type { Db } from "@/lib/server/action-context"
import { isInternalStaffRole } from "@/lib/user-roles"

/*
 * Imported (Buildertrend) threads whose people could not all be identified
 * are imported staff-only (owner decision 2026-11-02). Once staff confirm who
 * the thread was with, they open it to its owner or vendor audience here. The
 * resolved people with Compass accounts join at once; directory contacts
 * without accounts join when they are given access (adoption). Nothing is
 * sent: no notification, no email, and nothing becomes unread.
 */

export type ImportedShareAudience = "clients" | "sub_vendors"

export type ImportedSharePerson = {
  readonly name: string
  readonly userId: string | null
  readonly projectContactId: string | null
}

export type ImportedSharePlan =
  | {
      readonly ok: true
      readonly channelId: string
      readonly organizationId: string
      readonly projectId: string
      readonly channelName: string
      readonly people: readonly ImportedSharePerson[]
    }
  | { readonly ok: false; readonly error: string }

const ROLE_FOR_AUDIENCE: Record<ImportedShareAudience, string> = { clients: "owner", sub_vendors: "vendor" }

export function isImportedShareAudience(value: string): value is ImportedShareAudience {
  return value === "clients" || value === "sub_vendors"
}

/** Who would get access, and whether the thread may be shared at all. */
export async function planImportedThreadShare(input: {
  readonly db: Db
  readonly channelId: string
  readonly organizationId: string
  readonly actorRole: string
  readonly audience: ImportedShareAudience
}): Promise<ImportedSharePlan> {
  if (!isInternalStaffRole(input.actorRole)) return { ok: false, error: "Only staff can share an imported conversation." }
  const channel = await input.db
    .select({
      id: channels.id, name: channels.name, organizationId: channels.organizationId, projectId: channels.projectId,
      audience: channels.audience, sourceSystem: channels.sourceSystem, sourceThreadId: channels.sourceThreadId,
      staffOnlyProject: projects.importedConversationsStaffOnly,
    })
    .from(channels)
    .leftJoin(projects, eq(projects.id, channels.projectId))
    .where(and(eq(channels.id, input.channelId), eq(channels.organizationId, input.organizationId)))
    .get()
  if (!channel || !channel.projectId || !channel.sourceSystem || !channel.sourceThreadId) return { ok: false, error: "Imported conversation not found." }
  if (channel.staffOnlyProject) return { ok: false, error: "This project keeps imported conversations staff-only." }
  if (channel.audience !== "staff") return { ok: false, error: "This conversation is already shared." }

  const rows = await input.db
    .select({
      role: projectSourceRecordParticipants.participantRole,
      userId: projectSourceRecordParticipants.userId,
      projectContactId: projectSourceRecordParticipants.projectContactId,
      contactName: projectContacts.displayName,
      userName: users.displayName,
      sourceName: projectSourceRecordParticipants.sourceContactName,
    })
    .from(projectSourceRecordParticipants)
    .leftJoin(projectContacts, eq(projectContacts.id, projectSourceRecordParticipants.projectContactId))
    .leftJoin(users, eq(users.id, projectSourceRecordParticipants.userId))
    .where(
      and(
        eq(projectSourceRecordParticipants.organizationId, input.organizationId),
        eq(projectSourceRecordParticipants.projectId, channel.projectId),
        eq(projectSourceRecordParticipants.sourceRecordType, sql`${channel.sourceSystem} || '_message_thread'`),
        eq(projectSourceRecordParticipants.sourceRecordId, channel.sourceThreadId),
        eq(projectSourceRecordParticipants.active, true),
      )
    )
  const roles = new Set(rows.map((row) => row.role))
  // A thread with both owners and vendors stays internal (owner decision).
  if (roles.has("owner") && roles.has("vendor")) return { ok: false, error: "This conversation includes both owners and vendors, so it stays internal." }
  const wanted = ROLE_FOR_AUDIENCE[input.audience]
  const people = rows
    .filter((row) => row.role === wanted && (row.userId !== null || row.projectContactId !== null))
    .map((row) => ({ name: row.userName ?? row.contactName ?? row.sourceName ?? "Unnamed", userId: row.userId, projectContactId: row.projectContactId }))
  if (people.length === 0) {
    return { ok: false, error: input.audience === "clients" ? "No owner in this conversation has been identified yet." : "No vendor in this conversation has been identified yet." }
  }
  return { ok: true, channelId: channel.id, organizationId: channel.organizationId, projectId: channel.projectId, channelName: channel.name, people }
}

/** Opens the thread to the audience and adds the identified people who have accounts. */
export async function shareImportedThread(input: {
  readonly db: Db
  readonly channelId: string
  readonly organizationId: string
  readonly actorRole: string
  readonly audience: ImportedShareAudience
  readonly now: string
}): Promise<ImportedSharePlan> {
  const plan = await planImportedThreadShare(input)
  if (!plan.ok) return plan
  await openImportedChannelAudience(input.db, { channelId: plan.channelId, audience: input.audience })
  const userIds = [...new Set(plan.people.flatMap((person) => (person.userId ? [person.userId] : [])))]
  await insertChannelMembers(
    input.db,
    userIds.map((userId) => ({ id: crypto.randomUUID(), channelId: plan.channelId, userId, role: "member", notifyLevel: "all", joinedAt: input.now })),
    { ignoreConflict: true }
  )
  await insertReadStates(
    input.db,
    userIds.map((userId) => ({ id: crypto.randomUUID(), userId, channelId: plan.channelId, lastReadMessageId: null, lastReadAt: input.now, unreadCount: 0 })),
    { ignoreConflict: true }
  )
  return plan
}
