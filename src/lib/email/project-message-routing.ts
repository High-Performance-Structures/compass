import "server-only"

import { and, eq, inArray, sql } from "drizzle-orm"
import type { getDb } from "@/db"
import { notificationPreferences } from "@/db/schema"
import { companiesView, membershipsView, peopleView } from "@/lib/domain/identity/views"
import { projectMembersView } from "@/lib/domain/project/views"
import { correspondenceMessages } from "@/db/schema-correspondence"
import { isCorrespondenceEnabled } from "@/lib/correspondence/access"
import { USER_ROLES } from "@/lib/domain/identity/statuses"
import { isInternalStaffRole } from "@/lib/user-roles"
import type { InboundCandidate } from "./gmail-message-parser"
import { projectEmailTitle } from "./project-address"
import { inboundMessageMentionsSomeone, inboundProjectMessageRecipients } from "./project-message-mentions"
import { storeInboundMessageAttachments } from "@/lib/correspondence/inbound-attachments"
import { attachmentInsertStatement, conversationInsertStatement, messageInsertStatement, participantInsertStatement, recipientInsertStatement, writeGuardDeleteStatement, writeGuardInsertStatement } from "@/lib/domain/correspondence/store"
import { notificationEventInsertStatement, notificationRecipientInsertStatement } from "@/lib/domain/notifications/store"
import type { HeldMessageReason } from "./held-email-reasons"
import { isHeldJobEmailReviewerRole } from "@/lib/staff-message-desk"

const memberships = membershipsView()
const companies = companiesView()
const accounts = peopleView()
const projectMemberships = projectMembersView()

/** Most people one inbound message notifies. */
const MAX_RECIPIENTS = 30
/** Most held-email reviewers notified when a job has no staff. */
const MAX_REVIEWERS = 10
/** Added to a posted message whose files couldn't be saved. */
export const FILES_NOT_SAVED_NOTE = "(The attached files couldn't be saved here. They're still in the original email.)"

/** `filesLeftOut`: the email had files that couldn't be saved, so it was posted without them. */
export type RoutedProjectMessage = { readonly id: string; readonly status: "routed_message"; readonly filesLeftOut: boolean }
/** The message was not saved; the email or text stays in review for this reason. */
export type HeldProjectMessage = { readonly status: "held"; readonly reason: HeldMessageReason }

/**
 * Called only after the shared email/SMS router verifies the sender and
 * project, or when staff post a held email from the Staff Message Desk.
 */
export async function routeInboundProjectMessage(input: {
  readonly db: ReturnType<typeof getDb>
  readonly env: unknown
  readonly organizationId: string
  readonly projectId: string
  readonly candidate: InboundCandidate
  readonly body: string
  readonly source: "email" | "sms"
  readonly now: string
  /**
   * Staff posting a held email: who to notify when no @mention can be matched
   * and no staff are assigned to the job (the reviewer). They must still be
   * active internal staff.
   */
  readonly fallbackRecipientUserId?: string | null
  /**
   * An email to a known job is held only when messaging is off. An unmatched
   * @name goes to the job's assigned staff, a job with no staff goes to the
   * company's held-email reviewers, and files that can't be saved are left
   * out with a note in the message.
   */
  readonly postWhenJobKnown?: boolean
  /** Save without notifications and already read (re-posting old held email). */
  readonly quiet?: boolean
}): Promise<RoutedProjectMessage | HeldProjectMessage> {
  const held = (reason: HeldMessageReason): HeldProjectMessage => ({ status: "held", reason })
  if (!isCorrespondenceEnabled(input.projectId, input.env) && !isCorrespondenceEnabled(input.projectId)) return held("messaging_off")
  const sourceKey = JSON.stringify(["project-message", input.organizationId, input.projectId, input.source, input.candidate.gmailMessageId])
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sourceKey)))
  const id = `inbound-message-${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`
  const conversationId = `conversation-${id}`
  const existing = await input.db.select({ id: correspondenceMessages.id }).from(correspondenceMessages).where(eq(correspondenceMessages.id, id)).get()
  if (existing) return { id, status: "routed_message", filesLeftOut: false }

  const staffRoles = USER_ROLES.filter(isInternalStaffRole)
  const staff = await input.db.select({
    id: accounts.id, name: accounts.displayName, firstName: accounts.firstName, lastName: accounts.lastName, email: accounts.email, role: memberships.role,
    inApp: notificationPreferences.inAppEnabled,
    assigned: sql<number>`EXISTS(SELECT 1 FROM ${projectMemberships} pm WHERE pm.project_id=${input.projectId} AND pm.user_id=${accounts.id}) OR EXISTS(SELECT 1 FROM project_contacts pc WHERE pc.project_id=${input.projectId} AND pc.source_entity_type='user' AND pc.source_entity_id=${accounts.id} AND pc.contact_type='internal' AND pc.active=1)`,
  }).from(accounts)
    .innerJoin(memberships, and(eq(memberships.userId, accounts.id), eq(memberships.organizationId, input.organizationId)))
    .innerJoin(companies, and(eq(companies.id, memberships.organizationId), eq(companies.type, "internal")))
    .leftJoin(notificationPreferences, eq(notificationPreferences.userId, accounts.id))
    .where(and(eq(accounts.isActive, true), inArray(memberships.role, staffRoles)))
  const text = `${input.candidate.subject}\n${input.body}`
  const mentionsSomeone = inboundMessageMentionsSomeone(text)
  const people = staff.map((person) => ({
    ...person, name: person.name ?? [person.firstName, person.lastName].filter(Boolean).join(" "), assigned: Boolean(person.assigned), inApp: person.inApp ?? true,
  }))
  const resolved = inboundProjectMessageRecipients(text, people)
  const assigned = people.filter((person) => person.assigned)
  // A known job's email never waits on a name: an unmatched @name goes to the job's staff.
  const jobStaff = input.postWhenJobKnown && assigned.length > 0 && assigned.length <= MAX_RECIPIENTS ? assigned : null
  // Only when no one on the job can be resolved: the reviewing staff member, else the company's reviewers.
  const reviewer = people.find((person) => person.id === input.fallbackRecipientUserId)
  const reviewers = input.postWhenJobKnown
    ? people.filter((person) => isHeldJobEmailReviewerRole(person.role)).sort((a, b) => a.name.localeCompare(b.name)).slice(0, MAX_REVIEWERS)
    : []
  const chosen = resolved?.[0] ? { recipients: resolved, assignedOnly: !mentionsSomeone }
    : jobStaff ? { recipients: jobStaff, assignedOnly: true }
    : reviewer ? { recipients: [reviewer], assignedOnly: false }
    : reviewers[0] ? { recipients: reviewers, assignedOnly: false }
    : null
  if (!chosen || !chosen.recipients[0]) return held(mentionsSomeone && !input.postWhenJobKnown ? "mention_unmatched" : "no_recipients")
  const recipients = chosen.recipients
  const owner = chosen.recipients[0]
  // The batch guard re-checks job assignment when the recipients are the job's assigned staff.
  const requiresAssignment = chosen.assignedOnly
  // Files are stored before the batch. Without postWhenJobKnown, files that can't be stored keep the email in review.
  const stored = await storeInboundMessageAttachments({ ...input, messageId: id, ownerUserId: owner.id, attachments: input.candidate.attachments })
    .catch((error: unknown) => { console.error("[project-message-routing] attachment storage failed", error); return null })
  if (!stored && !input.postWhenJobKnown) return held("attachment_failed")
  const filesLeftOut = !stored
  const files = stored ?? { rows: [], discard: async (): Promise<void> => {} }
  const body = filesLeftOut ? `${input.body}\n\n${FILES_NOT_SAVED_NOTE}` : input.body
  const title = projectEmailTitle(input.candidate.subject) || "Project message"
  const sender = `${input.candidate.fromName?.trim() || input.candidate.fromAddress} <${input.candidate.fromAddress}>`
  const eventId = `notification-${id}`
  const guardId = crypto.randomUUID()
  // Save the message, audience grants, and in-app notification in one D1 batch.
  // External sender headers never grant access or impersonate a Compass account.
  try { await input.db.batch([
    writeGuardInsertStatement(input.db, guardId, sql`CASE WHEN EXISTS(SELECT 1 FROM projects WHERE id=${input.projectId} AND organization_id=${input.organizationId}) AND NOT EXISTS(SELECT 1 FROM json_each(${JSON.stringify(recipients.map((person) => person.id))}) person WHERE NOT EXISTS(SELECT 1 FROM ${accounts} u JOIN ${memberships} om ON om.user_id=u.id JOIN ${companies} o ON o.id=om.organization_id WHERE u.id=person.value AND u.is_active=1 AND o.type='internal' AND om.organization_id=${input.organizationId} AND om.role IN (SELECT value FROM json_each(${JSON.stringify(staffRoles)}))
      AND (${!requiresAssignment} OR EXISTS(SELECT 1 FROM ${projectMemberships} pm WHERE pm.project_id=${input.projectId} AND pm.user_id=u.id)
        OR EXISTS(SELECT 1 FROM project_contacts pc WHERE pc.project_id=${input.projectId} AND pc.source_entity_type='user' AND pc.source_entity_id=u.id AND pc.contact_type='internal' AND pc.active=1))
    )) THEN 1 ELSE 0 END`),
    conversationInsertStatement(input.db, { id: conversationId, organizationId: input.organizationId, projectId: input.projectId, subject: title, createdAt: input.now }),
    messageInsertStatement(input.db, { id, conversationId, authorUserId: null, authorName: sender, source: input.source, sourceKey, body, sentAt: input.candidate.receivedAt, requestHash: sourceKey }),
    ...files.rows.map((row) => attachmentInsertStatement(input.db, row)),
    ...recipients.map((person) => participantInsertStatement(input.db, [{ id: `${id}-participant-${person.id}`, conversationId, userId: person.id, name: person.name || person.email, email: person.email, role: "staff" }])),
    // Quiet posts arrive already read, with no notification.
    ...recipients.map((person) => recipientInsertStatement(input.db, [{ id: `${id}-recipient-${person.id}`, messageId: id, userId: person.id, name: person.name || person.email, kind: "to", openedAt: input.quiet ? input.now : null }])),
    ...(input.quiet ? [] : [notificationEventInsertStatement(input.db, { id: eventId, organizationId: input.organizationId, projectId: input.projectId, eventType: "project_message", sourceType: "project_correspondence", sourceId: id, title: `Project message from ${input.candidate.fromName?.trim() || input.candidate.fromAddress}`, body: title, href: `/dashboard/projects/${encodeURIComponent(input.projectId)}/messages?conversationId=${encodeURIComponent(conversationId)}&messageId=${encodeURIComponent(id)}`, audience: "internal", createdBy: null, createdAt: input.now }),
    ...recipients.map((person) => notificationRecipientInsertStatement(input.db, { id: `${eventId}-${person.id}`, eventId, userId: person.id, inApp: person.inApp, createdAt: input.now }))]),
    writeGuardDeleteStatement(input.db, guardId),
  ]) } catch (error) {
    await files.discard()
    throw error
  }
  return { id, status: "routed_message", filesLeftOut }
}
