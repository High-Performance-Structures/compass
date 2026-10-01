import { and, eq, isNull, sql } from "drizzle-orm"
import type { getDb } from "@/db"
import { organizationMembers, organizations, projectMembers, users, notificationPreferences } from "@/db/schema"
import { correspondenceParticipants } from "@/db/schema-correspondence"
import { USER_ROLES, isInternalStaffRole } from "@/lib/user-roles"
import type { CorrespondencePerson } from "@/lib/correspondence/types"

export async function activeProjectEmailParticipants(db: ReturnType<typeof getDb>, organizationId: string, projectId: string, conversationId: string): Promise<readonly (CorrespondencePerson & { readonly inApp: boolean })[]> {
  const rows = await db.select({ userId: users.id, name: users.displayName, email: users.email, participantRole: correspondenceParticipants.role, organizationRole: organizationMembers.role, projectRole: projectMembers.role, inApp: notificationPreferences.inAppEnabled }).from(correspondenceParticipants)
    .innerJoin(users, eq(users.id, correspondenceParticipants.userId))
    .innerJoin(organizationMembers, and(eq(organizationMembers.userId, users.id), eq(organizationMembers.organizationId, organizationId)))
    .innerJoin(organizations, and(eq(organizations.id, organizationMembers.organizationId), eq(organizations.type, "internal")))
    .leftJoin(projectMembers, and(eq(projectMembers.userId, users.id), eq(projectMembers.projectId, projectId)))
    .leftJoin(notificationPreferences, eq(notificationPreferences.userId, users.id))
    .where(and(eq(correspondenceParticipants.conversationId, conversationId), isNull(correspondenceParticipants.revokedAt), eq(users.isActive, true)))
  return rows.flatMap((person) => {
    const role = person.participantRole
    const active = role === "staff" ? isInternalStaffRole(person.organizationRole) : role === "owner" ? ["owner", "client"].includes(person.projectRole ?? "") : ["subcontractor", "supplier"].includes(person.projectRole ?? "")
    return active ? [{ userId: person.userId, name: person.name ?? person.email, email: person.email, role, delivery: "compass", inApp: person.inApp ?? true }] : []
  })
}

export function projectEmailParticipantGuard(people: readonly CorrespondencePerson[], organizationId: string, projectId: string, conversationId: string): ReturnType<typeof sql> {
  const frozen = JSON.stringify(people.map((person) => ({ userId: person.userId, role: person.role })))
  const staffRoles = JSON.stringify(USER_ROLES.filter(isInternalStaffRole))
  return sql`NOT EXISTS(SELECT 1 FROM json_each(${frozen}) person WHERE NOT EXISTS(SELECT 1 FROM correspondence_participants participant JOIN users u ON u.id=participant.user_id JOIN organization_members member ON member.user_id=u.id AND member.organization_id=${organizationId} JOIN organizations org ON org.id=member.organization_id AND org.type='internal' LEFT JOIN project_members pm ON pm.user_id=u.id AND pm.project_id=${projectId} WHERE participant.conversation_id=${conversationId} AND participant.user_id=json_extract(person.value,'$.userId') AND participant.role=json_extract(person.value,'$.role') AND participant.revoked_at IS NULL AND u.is_active=1 AND CASE participant.role WHEN 'staff' THEN member.role IN (SELECT value FROM json_each(${staffRoles})) WHEN 'owner' THEN pm.role IN ('owner','client') WHEN 'sub_vendor' THEN pm.role IN ('subcontractor','supplier') ELSE 0 END))`
}
