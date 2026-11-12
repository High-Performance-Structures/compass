import { and, eq, isNull, sql } from "drizzle-orm"
import type { getDb } from "@/db"
import { notificationPreferences } from "@/db/schema"
import { companiesView, membershipsView, peopleView } from "@/lib/domain/identity/views"
import { projectMembersView } from "@/lib/domain/project/views"
import { correspondenceParticipants } from "@/db/schema-correspondence"
import { USER_ROLES } from "@/lib/domain/identity/statuses"
import { isInternalStaffRole, projectAudienceForRole } from "@/lib/user-roles"
import type { CorrespondencePerson } from "@/lib/correspondence/types"

const memberships = membershipsView()
const companies = companiesView()
const projectMemberships = projectMembersView()
const accounts = peopleView()

export async function activeProjectEmailParticipants(db: ReturnType<typeof getDb>, organizationId: string, projectId: string, conversationId: string): Promise<readonly (CorrespondencePerson & { readonly inApp: boolean })[]> {
  const rows = await db.select({ userId: accounts.id, name: accounts.displayName, email: accounts.email, participantRole: correspondenceParticipants.role, organizationRole: memberships.role, projectRole: projectMemberships.role, inApp: notificationPreferences.inAppEnabled }).from(correspondenceParticipants)
    .innerJoin(accounts, eq(accounts.id, correspondenceParticipants.userId))
    .innerJoin(memberships, and(eq(memberships.userId, accounts.id), eq(memberships.organizationId, organizationId)))
    .innerJoin(companies, and(eq(companies.id, memberships.organizationId), eq(companies.type, "internal")))
    .leftJoin(projectMemberships, and(eq(projectMemberships.userId, accounts.id), eq(projectMemberships.projectId, projectId)))
    .leftJoin(notificationPreferences, eq(notificationPreferences.userId, accounts.id))
    .where(and(eq(correspondenceParticipants.conversationId, conversationId), isNull(correspondenceParticipants.revokedAt), eq(accounts.isActive, true)))
  return rows.flatMap((person) => {
    const role = person.participantRole
    const active = role === "staff" ? isInternalStaffRole(person.organizationRole) : projectAudienceForRole(person.projectRole) === role
    return active ? [{ userId: person.userId, name: person.name ?? person.email, email: person.email, role, delivery: "compass", inApp: person.inApp ?? true }] : []
  })
}

export function projectEmailParticipantGuard(people: readonly CorrespondencePerson[], organizationId: string, projectId: string, conversationId: string): ReturnType<typeof sql> {
  const frozen = JSON.stringify(people.map((person) => ({ userId: person.userId, role: person.role })))
  const staffRoles = JSON.stringify(USER_ROLES.filter(isInternalStaffRole))
  return sql`NOT EXISTS(SELECT 1 FROM json_each(${frozen}) person WHERE NOT EXISTS(SELECT 1 FROM correspondence_participants participant JOIN ${accounts} u ON u.id=participant.user_id JOIN ${memberships} member ON member.user_id=u.id AND member.organization_id=${organizationId} JOIN companies org ON org.id=member.organization_id AND org.type='internal' LEFT JOIN ${projectMemberships} pm ON pm.user_id=u.id AND pm.project_id=${projectId} WHERE participant.conversation_id=${conversationId} AND participant.user_id=json_extract(person.value,'$.userId') AND participant.role=json_extract(person.value,'$.role') AND participant.revoked_at IS NULL AND u.is_active=1 AND CASE participant.role WHEN 'staff' THEN member.role IN (SELECT value FROM json_each(${staffRoles})) WHEN 'owner' THEN pm.role IN ('owner','client') WHEN 'sub_vendor' THEN pm.role IN ('subcontractor','supplier') ELSE 0 END))`
}
