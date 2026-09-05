import { and, eq, sql, type SQL } from "drizzle-orm"
import { correspondenceWriteGuards } from "@/db/schema-correspondence"
import type { CorrespondenceContext } from "./access"
import { USER_ROLES, isInternalStaffRole } from "@/lib/user-roles"
import type { CorrespondencePerson } from "./types"

export function correspondenceWriteGuard(ctx: CorrespondenceContext, input: {
  readonly id: string
  readonly conversationId: string | null
  readonly participantVersion: number | null
  readonly people: readonly CorrespondencePerson[]
  readonly extra?: SQL
}): ReturnType<typeof createGuard> {
  return createGuard(ctx, input)
}

function createGuard(ctx: CorrespondenceContext, input: {
  readonly id: string
  readonly conversationId: string | null
  readonly participantVersion: number | null
  readonly people: readonly CorrespondencePerson[]
  readonly extra?: SQL
}) {
  const peopleJson = JSON.stringify(input.people.map((person) => ({ userId: person.userId, role: person.role })))
  const staffRoles = JSON.stringify(USER_ROLES.filter(isInternalStaffRole))
  const checks: SQL[] = [sql`EXISTS(SELECT 1 FROM projects WHERE id=${ctx.projectId} AND organization_id=${ctx.organizationId})`,
    sql`NOT EXISTS(SELECT 1 FROM json_each(${peopleJson}) person WHERE NOT EXISTS(
      SELECT 1 FROM users u JOIN organization_members om ON om.user_id=u.id
      LEFT JOIN project_members pm ON pm.user_id=u.id AND pm.project_id=${ctx.projectId}
      WHERE u.id=json_extract(person.value,'$.userId') AND u.is_active=1 AND om.organization_id=${ctx.organizationId}
      AND CASE json_extract(person.value,'$.role')
        WHEN 'owner' THEN pm.role IN ('owner','client')
        WHEN 'sub_vendor' THEN pm.role IN ('subcontractor','supplier')
        WHEN 'staff' THEN om.role IN (SELECT value FROM json_each(${staffRoles}))
        ELSE 0 END))`]
  if (input.conversationId) checks.push(sql`EXISTS(SELECT 1 FROM project_correspondence c JOIN correspondence_participants p ON p.conversation_id=c.id
    WHERE c.id=${input.conversationId} AND c.project_id=${ctx.projectId} AND c.organization_id=${ctx.organizationId}
    AND c.participant_version=${input.participantVersion} AND p.user_id=${ctx.user.id} AND p.revoked_at IS NULL)`)
  if (input.conversationId) checks.push(sql`NOT EXISTS(SELECT 1 FROM json_each(${peopleJson}) person WHERE NOT EXISTS(
    SELECT 1 FROM correspondence_participants cp WHERE cp.conversation_id=${input.conversationId}
    AND cp.user_id=json_extract(person.value,'$.userId') AND cp.revoked_at IS NULL))`)
  if (ctx.workspace !== "staff") {
    checks.push(sql`NOT EXISTS(SELECT 1 FROM json_each(${peopleJson}) person WHERE json_extract(person.value,'$.role')='staff' AND NOT EXISTS(
      SELECT 1 FROM project_contacts pc WHERE pc.project_id=${ctx.projectId} AND pc.source_entity_type='user'
      AND pc.source_entity_id=json_extract(person.value,'$.userId') AND pc.contact_type='internal' AND pc.active=1
      AND ${ctx.workspace === "owner" ? sql`pc.owner_portal_visible=1` : sql`pc.sub_vendor_portal_visible=1`}))`)
  }
  if (input.extra) checks.push(input.extra)
  return ctx.db.insert(correspondenceWriteGuards).values({ id: input.id, allowed: sql`CASE WHEN ${sql.join(checks, sql` AND `)} THEN 1 ELSE 0 END` })
}

export function clearCorrespondenceWriteGuard(ctx: CorrespondenceContext, id: string): ReturnType<typeof removeGuard> {
  return removeGuard(ctx, id)
}
function removeGuard(ctx: CorrespondenceContext, id: string) {
  return ctx.db.delete(correspondenceWriteGuards).where(and(eq(correspondenceWriteGuards.id, id)))
}
