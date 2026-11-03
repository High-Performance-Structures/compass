import "server-only"

import { and, asc, desc, eq, inArray, lte } from "drizzle-orm"
import type { getDb } from "@/db"
import { organizationMembers, organizations, projectAccessInvitations, projectContacts, projects, users } from "@/db/schema"
import { type ActivityActor, recordActivityEvent } from "@/lib/activity-log"
import { projectNumberAndName } from "@/lib/project-display-name"
import { isInternalStaffRole } from "@/lib/user-roles"
import { getCompassGmailSender, getCompassSystemSender, sendCompassEmail } from "./compass-email"
import { emailRetryAt } from "./delivery-recovery"
import { buildProjectAccessWelcomeHtml } from "./project-access-welcome"
import { currentInvitationRecipient } from "./invitation-recipient"
import { claimMailbox, mailboxCooldown, releaseMailbox } from "./mailbox-state"

import { createSystemNotificationEvent } from "@/lib/notifications/create-event"
import {
  cancelClaimedInvitationEmail,
  cancelObsoleteInvitationEmails as cancelObsoleteEmails,
  claimInvitationEmail,
  deferInvitationEmail,
  finishInvitationEmail,
  markStaleInvitationEmailsUnknown,
  recordInvitationEmailAttempt,
} from "@/lib/domain/identity/store"
import { getPermissions } from "@/lib/permissions"

type Db = ReturnType<typeof getDb>
type Invitation = typeof projectAccessInvitations.$inferSelect
export type InvitationEmailState = { readonly status: string; readonly nextAttemptAt: string | null }
const MAX_ATTEMPTS = 12

function envString(env: unknown, key: string): string | null {
  if (typeof env !== "object" || env === null) return null
  const value = Reflect.get(env, key)
  return typeof value === "string" && value.trim() ? value.trim() : null
}

/** Release corrected/revoked queue entries immediately, even during a long provider cooldown. */
export async function cancelObsoleteInvitationEmails(db: Db, input: {
  readonly projectId: string
  readonly contactId: string
  readonly email: string
  readonly role: string
  readonly now: string
}): Promise<void> {
  // Superseded pending access must not be claimed later with the old recipient/role.
  // Accepted project access stays intact; this only cancels its obsolete welcome.
  await cancelObsoleteEmails(db, input)
}

async function emailContext(db: Db, invitation: Invitation): Promise<{
  readonly label: string
  readonly actor: ActivityActor
} | null> {
  if (!invitation.projectContactId || !["sent", "accepted"].includes(invitation.status)) return null
  const contact = await db.select({ id: projectContacts.id }).from(projectContacts).where(and(
    eq(projectContacts.id, invitation.projectContactId), eq(projectContacts.projectId, invitation.projectId),
    eq(projectContacts.active, true),
  )).get()
  const project = await db.select({ name: projects.name, projectNumber: projects.projectNumber }).from(projects).where(and(eq(projects.id, invitation.projectId),
    eq(projects.organizationId, invitation.organizationId))).get()
  const actor = await db.select({ id: users.id, email: users.email, firstName: users.firstName, lastName: users.lastName, displayName: users.displayName, role: users.role }).from(users).where(and(eq(users.id, invitation.invitedBy), eq(users.isActive, true))).get()
  const membership = await db.select({ role: organizationMembers.role, type: organizations.type }).from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(and(eq(organizationMembers.userId, invitation.invitedBy), eq(organizationMembers.organizationId, invitation.organizationId))).get()
  if (!contact || !project || !actor || !membership || membership.type !== "internal" || (!isInternalStaffRole(membership.role) || !getPermissions(membership.role, "project").includes("update"))) return null
  const latest = await db.select({ id: projectAccessInvitations.id }).from(projectAccessInvitations)
    .where(and(eq(projectAccessInvitations.projectId, invitation.projectId),
      eq(projectAccessInvitations.projectContactId, invitation.projectContactId)))
    .orderBy(desc(projectAccessInvitations.invitedAt), desc(projectAccessInvitations.id)).get()
  if (latest?.id !== invitation.id) return null
  const recipient = await currentInvitationRecipient(db, { projectId: invitation.projectId,
    contactId: invitation.projectContactId, organizationId: invitation.organizationId, role: invitation.role })
  if (recipient !== invitation.email.trim().toLowerCase()) return null
  return { label: project.projectNumber ? projectNumberAndName(project, " - ") : project.name, actor }
}

async function notifyDeliveryProblem(db: Db, invitation: Invitation, status: string): Promise<void> {
  const inviter = await db.select({ email: users.email }).from(users).where(eq(users.id, invitation.invitedBy)).get()
  if (!inviter) return
  await createSystemNotificationEvent({ organizationId: invitation.organizationId, projectId: invitation.projectId,
    eventType: "project.invitation_email_problem", sourceType: "project_access_invitation", sourceId: invitation.id,
    title: "Compass welcome email needs attention",
    body: status === "unknown" ? `Delivery to ${invitation.email} could not be confirmed. Check the sending mailbox before resending.`
      : `The welcome email to ${invitation.email} could not be sent. Review the recipient and retry the invitation.`,
    href: `/dashboard/projects/${invitation.projectId}/contacts`, priority: "high", audience: "internal",
    recipients: [{ userId: invitation.invitedBy, email: inviter.email }], delivery: { inApp: true, email: false, push: false },
  }).catch(() => { console.error("Invitation email attention notification failed") })
}

async function invitationUrl(env: unknown, invitation: Invitation): Promise<string | null> {
  if (invitation.workosExpiresAt && Date.parse(invitation.workosExpiresAt) <= Date.now()) return null
  const base = envString(env, "COMPASS_APP_URL") ?? envString(env, "COMPASS_PUBLIC_BASE_URL") ?? "https://compass.openrangeconstruction.ltd"
  const path = invitation.role === "owner" || invitation.role === "client" ? `/preview/projects/${invitation.projectId}/owner`
    : invitation.role === "subcontractor" || invitation.role === "supplier" ? `/preview/projects/${invitation.projectId}/sub-vendor`
      : `/dashboard/projects/${invitation.projectId}`
  const login = `${base.replace(/\/$/, "")}/login?from=${encodeURIComponent(path)}`
  if (!invitation.workosInvitationId || invitation.status === "accepted") return login
  const apiKey = envString(env, "WORKOS_API_KEY")
  if (!apiKey) throw new Error("Account invitation lookup is unavailable.")
  const { WorkOS } = await import("@workos-inc/node")
  // Read the existing invite; a retry must never create/resend an account invite.
  const current = await new WorkOS(apiKey).userManagement.getInvitation(invitation.workosInvitationId)
  if (current.email.trim().toLowerCase() !== invitation.email.trim().toLowerCase()) return null
  if (current.state === "accepted") return login
  if (current.state !== "pending" || Date.parse(current.expiresAt) <= Date.now()) return null
  return current.acceptInvitationUrl
}

/** Durable at-most-one automatic send: ambiguous responses and stale claims need staff review. */
export async function deliverInvitationEmail(input: {
  readonly db: Db
  readonly env: unknown
  readonly invitationId: string
}): Promise<InvitationEmailState> {
  const { db, env } = input
  const row = await db.select().from(projectAccessInvitations).where(eq(projectAccessInvitations.id, input.invitationId)).get()
  if (!row) return { status: "cancelled", nextAttemptAt: null }
  if (!["queued", "retrying"].includes(row.emailStatus)) return { status: row.emailStatus, nextAttemptAt: row.emailNextAttemptAt }
  const now = new Date().toISOString()
  if (row.emailNextAttemptAt && row.emailNextAttemptAt > now) return { status: row.emailStatus, nextAttemptAt: row.emailNextAttemptAt }
  const mailbox = getCompassGmailSender(env)
  const token = crypto.randomUUID()
  if (!await claimMailbox(db, mailbox, now, token)) {
    const nextAttemptAt = await mailboxCooldown(db, mailbox, now) ?? new Date(Date.parse(now) + 60_000).toISOString()
    await deferInvitationEmail(db, row.id, nextAttemptAt)
    return { status: row.emailStatus, nextAttemptAt }
  }
  let claimed = false
  let dispatched = false
  try {
    const rows = await claimInvitationEmail(db, row.id, token, now)
    if (rows.length === 0) return { status: row.emailStatus, nextAttemptAt: row.emailNextAttemptAt }
    claimed = true
    const context = await emailContext(db, row)
    const url = context ? await invitationUrl(env, row) : null
    if (!context || !url || !row.emailSubject || !row.emailMessage) {
      await cancelClaimedInvitationEmail(db, { invitationId: row.id, token, now,
        emailError: "Invitation, contact, or sending authorization changed. Review access before sending." })
      return { status: "cancelled", nextAttemptAt: null }
    }
    const attempts = row.emailAttempts + 1
    // Persist the attempt before provider I/O. A crashed Worker must not blindly resend it.
    const attemptClaim = await recordInvitationEmailAttempt(db, { invitationId: row.id, token, attempts })
    if (attemptClaim.length === 0) {
      const current = await db.select({ status: projectAccessInvitations.emailStatus, nextAttemptAt: projectAccessInvitations.emailNextAttemptAt })
        .from(projectAccessInvitations).where(eq(projectAccessInvitations.id, row.id)).get()
      return current ?? { status: "cancelled", nextAttemptAt: null }
    }
    dispatched = true
    const delivery = await sendCompassEmail({ env, db, organizationId: row.organizationId, to: [row.email],
      replyTo: getCompassSystemSender(env).address, subject: row.emailSubject,
      text: `${row.emailMessage}\n\nOpen Compass: ${url}`,
      html: buildProjectAccessWelcomeHtml({ message: row.emailMessage, actionUrl: url,
        actionLabel: row.status === "accepted" ? "Open Compass" : "Set Up Compass Access", projectLabel: context.label }),
    })
    const status = delivery.status === "sent" ? "sent"
      : delivery.status === "unknown" ? "unknown"
        : delivery.status === "rate_limited" && attempts < MAX_ATTEMPTS ? "retrying" : "failed"
    const nextAttemptAt = status === "retrying"
      ? emailRetryAt({ error: delivery.error, retryAfter: null, now: new Date(), attempt: attempts }) : null
    await finishInvitationEmail(db, { invitationId: row.id, token, emailStatus: status, emailNextAttemptAt: nextAttemptAt,
      emailProvider: delivery.provider, emailProviderMessageId: delivery.providerMessageId,
      emailError: delivery.error, emailSentAt: status === "sent" ? new Date().toISOString() : null,
      updatedAt: new Date().toISOString(),
    })
    if (status === "sent" || status === "failed" || status === "unknown") {
      await recordActivityEvent({ db, organizationId: row.organizationId, projectId: row.projectId, actor: context.actor,
        category: "email", action: `project.welcome_email_${status}`, entityType: "project_access_invitation", entityId: row.id,
        summary: status === "sent" ? `Sent Compass welcome email to ${row.email}.`
          : status === "unknown" ? `Welcome email delivery to ${row.email} needs review before resending.`
            : `Welcome email to ${row.email} failed; staff follow-up is required.`,
      })
    }
    if (status === "failed" || status === "unknown") await notifyDeliveryProblem(db, row, status)
    return { status, nextAttemptAt }
  } catch {
    const status = dispatched ? "unknown" : "retrying"
    const nextAttemptAt = dispatched ? null : new Date(Date.now() + 300_000).toISOString()
    if (claimed) await finishInvitationEmail(db, { invitationId: row.id, token, emailStatus: status, emailNextAttemptAt: nextAttemptAt,
      emailError: dispatched ? "Email delivery is uncertain. Check the sending mailbox before resending." : "Could not verify the account invitation. Will retry shortly.",
      updatedAt: new Date().toISOString(),
    })
    if (claimed && dispatched) await notifyDeliveryProblem(db, row, status)
    return { status, nextAttemptAt }
  } finally {
    await releaseMailbox(db, mailbox, token, new Date().toISOString())
  }
}

export async function retryInvitationEmails(db: Db, env: unknown): Promise<{
  readonly processed: number
  readonly needsReview: number
}> {
  const now = new Date().toISOString()
  // Expired claims may have sent successfully. Surface them; never reset to queued.
  const stale = await markStaleInvitationEmailsUnknown(db, { now,
    emailError: "Email delivery could not be confirmed after an interrupted send. Check the sending mailbox before resending.",
    claimedBefore: new Date(Date.now() - 300_000).toISOString() })
  for (const invitation of stale) await notifyDeliveryProblem(db, invitation, "unknown")
  // One email per minute, with a shared mailbox slot for simultaneous user sends.
  const due = await db.select({ id: projectAccessInvitations.id }).from(projectAccessInvitations)
    .where(and(inArray(projectAccessInvitations.emailStatus, ["queued", "retrying"]), lte(projectAccessInvitations.emailNextAttemptAt, now)))
    .orderBy(asc(projectAccessInvitations.emailNextAttemptAt)).limit(1)
  for (const row of due) await deliverInvitationEmail({ db, env, invitationId: row.id })
  return { processed: due.length, needsReview: stale.length }
}
