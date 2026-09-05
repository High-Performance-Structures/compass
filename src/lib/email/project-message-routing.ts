import "server-only"

import { and, eq, inArray, sql } from "drizzle-orm"
import type { getDb } from "@/db"
import { notificationEvents, notificationPreferences, notificationRecipients, organizationMembers, organizations, users } from "@/db/schema"
import { correspondence, correspondenceMessages, correspondenceParticipants, correspondenceRecipients, correspondenceWriteGuards } from "@/db/schema-correspondence"
import { isCorrespondenceEnabled } from "@/lib/correspondence/access"
import { USER_ROLES, isInternalStaffRole } from "@/lib/user-roles"
import type { InboundCandidate } from "./gmail-message-parser"
import { projectEmailTitle } from "./project-address"
import { inboundProjectMessageRecipients } from "./project-message-mentions"

/** Called only after the shared email/SMS router verifies the sender and project. */
export async function routeInboundProjectMessage(input: {
  readonly db: ReturnType<typeof getDb>
  readonly env: unknown
  readonly organizationId: string
  readonly projectId: string
  readonly candidate: InboundCandidate
  readonly body: string
  readonly source: "email" | "sms"
  readonly now: string
}): Promise<{ readonly id: string; readonly status: "routed_message" } | null> {
  if (!isCorrespondenceEnabled(input.projectId, input.env) && !isCorrespondenceEnabled(input.projectId)) return null
  // Keep the full incoming item in review until its files can be safely imported.
  if (input.candidate.attachments.length > 0) return null
  const sourceKey = JSON.stringify(["project-message", input.organizationId, input.projectId, input.source, input.candidate.gmailMessageId])
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sourceKey)))
  const id = `inbound-message-${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`
  const conversationId = `conversation-${id}`
  const existing = await input.db.select({ id: correspondenceMessages.id }).from(correspondenceMessages).where(eq(correspondenceMessages.id, id)).get()
  if (existing) return { id, status: "routed_message" }

  const staffRoles = USER_ROLES.filter(isInternalStaffRole)
  const staff = await input.db.select({
    id: users.id, name: users.displayName, firstName: users.firstName, lastName: users.lastName, email: users.email,
    inApp: notificationPreferences.inAppEnabled,
    assigned: sql<number>`EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=${input.projectId} AND pm.user_id=${users.id}) OR EXISTS(SELECT 1 FROM project_contacts pc WHERE pc.project_id=${input.projectId} AND pc.source_entity_type='user' AND pc.source_entity_id=${users.id} AND pc.contact_type='internal' AND pc.active=1)`,
  }).from(users)
    .innerJoin(organizationMembers, and(eq(organizationMembers.userId, users.id), eq(organizationMembers.organizationId, input.organizationId)))
    .innerJoin(organizations, and(eq(organizations.id, organizationMembers.organizationId), eq(organizations.type, "internal")))
    .leftJoin(notificationPreferences, eq(notificationPreferences.userId, users.id))
    .where(and(eq(users.isActive, true), inArray(organizationMembers.role, staffRoles)))
  const text = `${input.candidate.subject}\n${input.body}`
  const requiresAssignment = !/(?:^|[\s(])@/u.test(text)
  const recipients = inboundProjectMessageRecipients(text, staff.map((person) => ({
    ...person, name: person.name ?? [person.firstName, person.lastName].filter(Boolean).join(" "), assigned: Boolean(person.assigned), inApp: person.inApp ?? true,
  })))
  if (!recipients) return null
  const title = projectEmailTitle(input.candidate.subject) || "Project message"
  const sender = `${input.candidate.fromName?.trim() || input.candidate.fromAddress} <${input.candidate.fromAddress}>`
  const eventId = `notification-${id}`
  const guardId = crypto.randomUUID()
  // Save the message, audience grants, and in-app notification in one D1 batch.
  // External sender headers never grant access or impersonate a Compass account.
  await input.db.batch([
    input.db.insert(correspondenceWriteGuards).values({ id: guardId, allowed: sql`CASE WHEN EXISTS(SELECT 1 FROM projects WHERE id=${input.projectId} AND organization_id=${input.organizationId}) AND NOT EXISTS(SELECT 1 FROM json_each(${JSON.stringify(recipients.map((person) => person.id))}) person WHERE NOT EXISTS(SELECT 1 FROM users u JOIN organization_members om ON om.user_id=u.id JOIN organizations o ON o.id=om.organization_id WHERE u.id=person.value AND u.is_active=1 AND o.type='internal' AND om.organization_id=${input.organizationId} AND om.role IN (SELECT value FROM json_each(${JSON.stringify(staffRoles)}))
      AND (${!requiresAssignment} OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=${input.projectId} AND pm.user_id=u.id)
        OR EXISTS(SELECT 1 FROM project_contacts pc WHERE pc.project_id=${input.projectId} AND pc.source_entity_type='user' AND pc.source_entity_id=u.id AND pc.contact_type='internal' AND pc.active=1))
    )) THEN 1 ELSE 0 END` }),
    input.db.insert(correspondence).values({ id: conversationId, organizationId: input.organizationId, projectId: input.projectId, subject: title, createdAt: input.now }),
    input.db.insert(correspondenceMessages).values({ id, conversationId, authorUserId: null, authorName: sender, source: input.source, sourceKey, body: input.body, sentAt: input.candidate.receivedAt, requestHash: sourceKey }),
    ...recipients.map((person) => input.db.insert(correspondenceParticipants).values({ id: `${id}-participant-${person.id}`, conversationId, userId: person.id, name: person.name || person.email, email: person.email, role: "staff" })),
    ...recipients.map((person) => input.db.insert(correspondenceRecipients).values({ id: `${id}-recipient-${person.id}`, messageId: id, userId: person.id, name: person.name || person.email, kind: "to" })),
    input.db.insert(notificationEvents).values({ id: eventId, organizationId: input.organizationId, projectId: input.projectId, eventType: "project_message", sourceType: "project_correspondence", sourceId: id, title: `Project message from ${input.candidate.fromName?.trim() || input.candidate.fromAddress}`, body: title, href: `/dashboard/projects/${encodeURIComponent(input.projectId)}/messages?conversationId=${encodeURIComponent(conversationId)}&messageId=${encodeURIComponent(id)}`, audience: "internal", createdBy: null, createdAt: input.now }),
    ...recipients.map((person) => input.db.insert(notificationRecipients).values({ id: `${eventId}-${person.id}`, eventId, userId: person.id, inApp: person.inApp, createdAt: input.now })),
    input.db.delete(correspondenceWriteGuards).where(eq(correspondenceWriteGuards.id, guardId)),
  ])
  return { id, status: "routed_message" }
}
