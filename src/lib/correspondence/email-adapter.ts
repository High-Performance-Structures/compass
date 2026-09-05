import { and, eq, isNull, sql } from "drizzle-orm"

import type { getDb } from "@/db"
import { organizationMembers, projectMembers, users } from "@/db/schema"
import {
  correspondence,
  correspondenceMessages,
  correspondenceParticipants,
  correspondenceRecipients,
  correspondenceWriteGuards,
} from "@/db/schema-correspondence"
import {
  correspondenceEmailDeliveries,
  correspondenceEmailEvents,
  correspondenceEmailThreads,
} from "@/db/schema-correspondence-email"
import type { InboundCandidate } from "@/lib/email/gmail-message-parser"
import { isReplyMessage } from "@/lib/email/reply-detection"
import { USER_ROLES, isInternalStaffRole } from "@/lib/user-roles"

import { decideCorrespondenceInbound } from "./transport-policy"

type Db = ReturnType<typeof getDb>

export type CorrespondenceEmailSender = (input: {
  readonly to: string
  readonly subject: string
  readonly text: string
  readonly replyTo: string
  readonly headers: readonly { readonly name: string; readonly value: string }[]
}) => Promise<
  | { readonly kind: "accepted"; readonly providerMessageId: string | null }
  | { readonly kind: "failed"; readonly error: string }
  | { readonly kind: "unknown"; readonly error: string }
>

export type CorrespondenceEmailResult =
  | { readonly kind: "disabled" }
  | { readonly kind: "queued"; readonly deliveryId: string }
  | { readonly kind: "accepted"; readonly deliveryId: string }
  | { readonly kind: "failed" | "unknown"; readonly deliveryId: string; readonly error: string }
  | { readonly kind: "already_handled"; readonly deliveryId: string }

export type CorrespondenceInboundEmailResult =
  | { readonly kind: "posted"; readonly messageId: string }
  | { readonly kind: "held" | "suppressed" | "rejected" | "duplicate" }

function configuredString(environment: unknown, key: string): string | null {
  if (!isRecord(environment)) return null
  const value = environment[key]
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function isCorrespondenceEmailEnabled(
  projectId: string,
  environment: unknown
): boolean {
  const value = configuredString(
    environment,
    "COMPASS_CORRESPONDENCE_EMAIL_PROJECT_IDS"
  )
  return value !== null && value.split(",").some((id) => id.trim() === projectId)
}

function replyMailboxParts(environment: unknown): {
  readonly local: string
  readonly domain: string
} | null {
  const mailbox = configuredString(environment, "COMPASS_REPLY_MAILBOX")
  if (!mailbox) return null
  const address = mailbox.match(/<([^<>]+)>/)?.[1] ?? mailbox
  const separator = address.lastIndexOf("@")
  if (separator <= 0 || separator === address.length - 1) return null
  return {
    local: address.slice(0, separator).trim(),
    domain: address.slice(separator + 1).trim().toLowerCase(),
  }
}

function createReplyToken(): string {
  return `cmp-${crypto.randomUUID().replace(/-/g, "").slice(0, 18)}`
}

function anchorMessageId(token: string, domain: string): string {
  return `<${token}@${domain}>`
}

function outgoingMessageId(messageId: string, domain: string): string {
  return `<cmp-message-${messageId}@${domain}>`
}

function normalizedAddress(value: string): string {
  return value.trim().toLowerCase()
}

function rfcMessageIds(value: string | null): readonly string[] {
  if (!value) return []
  return value.match(/<[^<>\s]+>/g) ?? []
}

function headerMatchesAnchor(
  candidate: InboundCandidate,
  replyMessageIds: readonly string[]
): "matched" | "missing" | "conflicting" {
  const headerIds = [
    ...rfcMessageIds(candidate.inReplyToHeader),
    ...rfcMessageIds(candidate.referencesHeader),
  ]
  if (headerIds.length === 0) return "missing"
  return headerIds.some((id) => replyMessageIds.includes(id))
    ? "matched"
    : "conflicting"
}

function mailboxDomain(anchor: string): string | null {
  const match = anchor.match(/^<[^<>@\s]+@([^<>@\s]+)>$/)
  return match ? match[1] : null
}

async function replyMessageIds(input: {
  readonly db: Db
  readonly conversationId: string
  readonly anchorMessageId: string
}): Promise<readonly string[]> {
  const domain = mailboxDomain(input.anchorMessageId)
  if (!domain) return [input.anchorMessageId]
  const sent = await input.db
    .select({ messageId: correspondenceEmailDeliveries.messageId })
    .from(correspondenceEmailDeliveries)
    .where(
      and(
        eq(correspondenceEmailDeliveries.conversationId, input.conversationId),
        eq(correspondenceEmailDeliveries.provider, "gmail"),
        eq(correspondenceEmailDeliveries.status, "accepted")
      )
    )
  return [
    input.anchorMessageId,
    ...[...new Set(sent.map((row) => outgoingMessageId(row.messageId, domain)))],
  ]
}

type CurrentParticipant = {
  readonly userId: string
  readonly name: string
  readonly email: string
  readonly role: "staff" | "owner" | "sub_vendor"
}

async function currentEmailParticipants(input: {
  readonly db: Db
  readonly organizationId: string
  readonly projectId: string
  readonly conversationId: string
}): Promise<readonly CurrentParticipant[]> {
  const rows = await input.db
    .select({
      userId: correspondenceParticipants.userId,
      name: correspondenceParticipants.name,
      email: correspondenceParticipants.email,
      role: correspondenceParticipants.role,
      active: users.isActive,
      organizationRole: organizationMembers.role,
      projectRole: projectMembers.role,
    })
    .from(correspondenceParticipants)
    .innerJoin(users, eq(users.id, correspondenceParticipants.userId))
    .innerJoin(
      organizationMembers,
      and(
        eq(organizationMembers.userId, users.id),
        eq(organizationMembers.organizationId, input.organizationId)
      )
    )
    .leftJoin(
      projectMembers,
      and(
        eq(projectMembers.userId, users.id),
        eq(projectMembers.projectId, input.projectId)
      )
    )
    .where(
      and(
        eq(correspondenceParticipants.conversationId, input.conversationId),
        isNull(correspondenceParticipants.revokedAt)
      )
    )
  return rows.flatMap((row): CurrentParticipant[] => {
    if (!row.active) return []
    const role = row.role
    const allowed =
      (role === "staff" && isInternalStaffRole(row.organizationRole)) ||
      (role === "owner" && ["owner", "client"].includes(row.projectRole ?? "")) ||
      (role === "sub_vendor" &&
        ["subcontractor", "supplier"].includes(row.projectRole ?? ""))
    return allowed
      ? [{ userId: row.userId, name: row.name, email: row.email, role }]
      : []
  })
}

async function emailThread(input: {
  readonly db: Db
  readonly environment: unknown
  readonly organizationId: string
  readonly projectId: string
  readonly conversationId: string
}): Promise<typeof correspondenceEmailThreads.$inferSelect> {
  const existing = await input.db
    .select()
    .from(correspondenceEmailThreads)
    .where(eq(correspondenceEmailThreads.conversationId, input.conversationId))
    .get()
    .then((row) => row ?? null)
  if (existing) return existing
  const mailbox = replyMailboxParts(input.environment)
  if (!mailbox) throw new Error("Correspondence email reply mailbox is not configured.")
  const token = createReplyToken()
  const createdAt = new Date().toISOString()
  await input.db
    .insert(correspondenceEmailThreads)
    .values({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      projectId: input.projectId,
      conversationId: input.conversationId,
      replyToken: token,
      replyToAddress: `Compass <${mailbox.local}+${token}@${mailbox.domain}>`,
      anchorMessageId: anchorMessageId(token, mailbox.domain),
      createdAt,
    })
    .onConflictDoNothing()
  const thread = await input.db
    .select()
    .from(correspondenceEmailThreads)
    .where(eq(correspondenceEmailThreads.conversationId, input.conversationId))
    .get()
    .then((row) => row ?? null)
  if (!thread) throw new Error("Unable to establish correspondence email thread.")
  return thread
}

export async function queueCorrespondenceEmail(input: {
  readonly db: Db
  readonly environment: unknown
  readonly organizationId: string
  readonly projectId: string
  readonly conversationId: string
  readonly messageId: string
  readonly recipientUserId: string
}): Promise<CorrespondenceEmailResult> {
  if (!isCorrespondenceEmailEnabled(input.projectId, input.environment)) {
    return { kind: "disabled" }
  }
  const [conversation, message] = await Promise.all([
    input.db
      .select({ id: correspondence.id })
      .from(correspondence)
      .where(
        and(
          eq(correspondence.id, input.conversationId),
          eq(correspondence.organizationId, input.organizationId),
          eq(correspondence.projectId, input.projectId)
        )
      )
      .get(),
    input.db
      .select({ id: correspondenceMessages.id })
      .from(correspondenceMessages)
      .innerJoin(
        correspondenceRecipients,
        and(
          eq(correspondenceRecipients.messageId, correspondenceMessages.id),
          eq(correspondenceRecipients.userId, input.recipientUserId)
        )
      )
      .where(
        and(
          eq(correspondenceMessages.id, input.messageId),
          eq(correspondenceMessages.conversationId, input.conversationId),
          eq(correspondenceMessages.source, "compass"),
          isNull(correspondenceMessages.retractedAt)
        )
      )
      .get(),
  ])
  if (!conversation || !message) throw new Error("Correspondence message is unavailable.")
  const people = await currentEmailParticipants(input)
  const recipient = people.find((person) => person.userId === input.recipientUserId)
  if (!recipient) throw new Error("Email recipient is not a current participant.")
  await emailThread(input)
  const now = new Date().toISOString()
  const id = crypto.randomUUID()
  const rows = await input.db
    .insert(correspondenceEmailDeliveries)
    .values({
      id,
      organizationId: input.organizationId,
      projectId: input.projectId,
      conversationId: input.conversationId,
      messageId: input.messageId,
      recipientUserId: recipient.userId,
      recipientEmail: normalizedAddress(recipient.email),
      provider: "gmail",
      status: "queued",
      providerMessageId: null,
      attemptCount: 0,
      queuedAt: now,
      acceptedAt: null,
      failedAt: null,
      error: null,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: correspondenceEmailDeliveries.id })
  if (rows[0]) return { kind: "queued", deliveryId: rows[0].id }
  const existing = await input.db
    .select({ id: correspondenceEmailDeliveries.id })
    .from(correspondenceEmailDeliveries)
    .where(
      and(
        eq(correspondenceEmailDeliveries.messageId, input.messageId),
        eq(correspondenceEmailDeliveries.recipientUserId, input.recipientUserId),
        eq(correspondenceEmailDeliveries.provider, "gmail")
      )
    )
    .get()
    .then((row) => row ?? null)
  if (!existing) throw new Error("Unable to queue correspondence email.")
  return { kind: "already_handled", deliveryId: existing.id }
}

async function dispatchEligibility(input: {
  readonly db: Db
  readonly delivery: {
    readonly organizationId: string
    readonly projectId: string
    readonly conversationId: string
    readonly messageId: string
    readonly recipientUserId: string
    readonly recipientEmail: string
  }
}): Promise<CurrentParticipant | null> {
  const grant = await input.db
    .select({ id: correspondenceMessages.id })
    .from(correspondenceMessages)
    .innerJoin(
      correspondence,
      and(
        eq(correspondence.id, correspondenceMessages.conversationId),
        eq(correspondence.organizationId, input.delivery.organizationId),
        eq(correspondence.projectId, input.delivery.projectId)
      )
    )
    .innerJoin(
      correspondenceRecipients,
      and(
        eq(correspondenceRecipients.messageId, correspondenceMessages.id),
        eq(correspondenceRecipients.userId, input.delivery.recipientUserId)
      )
    )
    .where(
      and(
        eq(correspondenceMessages.id, input.delivery.messageId),
        eq(correspondenceMessages.conversationId, input.delivery.conversationId),
        eq(correspondenceMessages.source, "compass"),
        isNull(correspondenceMessages.retractedAt)
      )
    )
    .get()
  if (!grant) return null
  const people = await currentEmailParticipants({
    db: input.db,
    organizationId: input.delivery.organizationId,
    projectId: input.delivery.projectId,
    conversationId: input.delivery.conversationId,
  })
  return (
    people.find(
      (person) =>
        person.userId === input.delivery.recipientUserId &&
        normalizedAddress(person.email) ===
          normalizedAddress(input.delivery.recipientEmail)
    ) ?? null
  )
}

async function failDispatch(input: {
  readonly db: Db
  readonly deliveryId: string
  readonly error: string
}): Promise<void> {
  const now = new Date().toISOString()
  await input.db
    .update(correspondenceEmailDeliveries)
    .set({ status: "failed", failedAt: now, error: input.error, updatedAt: now })
    .where(
      and(
        eq(correspondenceEmailDeliveries.id, input.deliveryId),
        eq(correspondenceEmailDeliveries.status, "dispatching")
      )
    )
}

export async function dispatchCorrespondenceEmail(input: {
  readonly db: Db
  readonly environment: unknown
  readonly deliveryId: string
  readonly sender: CorrespondenceEmailSender
}): Promise<CorrespondenceEmailResult> {
  const delivery = await input.db
    .select({
      id: correspondenceEmailDeliveries.id,
      organizationId: correspondenceEmailDeliveries.organizationId,
      projectId: correspondenceEmailDeliveries.projectId,
      conversationId: correspondenceEmailDeliveries.conversationId,
      messageId: correspondenceEmailDeliveries.messageId,
      recipientUserId: correspondenceEmailDeliveries.recipientUserId,
      recipientEmail: correspondenceEmailDeliveries.recipientEmail,
      status: correspondenceEmailDeliveries.status,
      attemptCount: correspondenceEmailDeliveries.attemptCount,
      subject: correspondence.subject,
      body: correspondenceMessages.body,
    })
    .from(correspondenceEmailDeliveries)
    .innerJoin(correspondence, eq(correspondence.id, correspondenceEmailDeliveries.conversationId))
    .innerJoin(correspondenceMessages, eq(correspondenceMessages.id, correspondenceEmailDeliveries.messageId))
    .where(eq(correspondenceEmailDeliveries.id, input.deliveryId))
    .get()
    .then((row) => row ?? null)
  if (!delivery) throw new Error("Correspondence email delivery is unavailable.")
  if (!isCorrespondenceEmailEnabled(delivery.projectId, input.environment)) {
    return { kind: "disabled" }
  }
  // Another worker owns an in-flight attempt. A separate stale-recovery job,
  // not a competing caller, may eventually classify an abandoned attempt.
  if (delivery.status === "dispatching") {
    return { kind: "already_handled", deliveryId: delivery.id }
  }
  if (delivery.status !== "queued") return { kind: "already_handled", deliveryId: delivery.id }
  const initialRecipient = await dispatchEligibility({ db: input.db, delivery })
  if (!initialRecipient) {
    const error = "Email recipient no longer has access to this Compass message."
    const now = new Date().toISOString()
    await input.db
      .update(correspondenceEmailDeliveries)
      .set({ status: "failed", failedAt: now, error, updatedAt: now })
      .where(
        and(
          eq(correspondenceEmailDeliveries.id, delivery.id),
          eq(correspondenceEmailDeliveries.status, "queued")
        )
      )
    return { kind: "failed", deliveryId: delivery.id, error }
  }
  const claimed = await input.db
    .update(correspondenceEmailDeliveries)
    .set({
      status: "dispatching",
      attemptCount: delivery.attemptCount + 1,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(correspondenceEmailDeliveries.id, delivery.id),
        eq(correspondenceEmailDeliveries.status, "queued")
      )
    )
    .returning({ id: correspondenceEmailDeliveries.id })
  if (!claimed[0]) return { kind: "already_handled", deliveryId: delivery.id }
  // Recheck after the claim and directly before the provider call. The queue may
  // outlive a revocation, retraction, or recipient-audience change.
  if (!(await dispatchEligibility({ db: input.db, delivery }))) {
    const error = "Email recipient no longer has access to this Compass message."
    await failDispatch({ db: input.db, deliveryId: delivery.id, error })
    return { kind: "failed", deliveryId: delivery.id, error }
  }
  let thread: typeof correspondenceEmailThreads.$inferSelect
  let mailbox: { readonly local: string; readonly domain: string }
  try {
    thread = await emailThread({
      db: input.db,
      environment: input.environment,
      organizationId: delivery.organizationId,
      projectId: delivery.projectId,
      conversationId: delivery.conversationId,
    })
    const resolvedMailbox = replyMailboxParts(input.environment)
    if (!resolvedMailbox) {
      throw new Error("Correspondence email reply mailbox is not configured.")
    }
    mailbox = resolvedMailbox
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to prepare correspondence email."
    await input.db.update(correspondenceEmailDeliveries).set({ status: "failed", failedAt: new Date().toISOString(), error: message.slice(0, 500), updatedAt: new Date().toISOString() }).where(eq(correspondenceEmailDeliveries.id, delivery.id))
    return { kind: "failed", deliveryId: delivery.id, error: message }
  }
  let result: Awaited<ReturnType<CorrespondenceEmailSender>>
  try {
    result = await input.sender({
      to: delivery.recipientEmail,
      subject: delivery.subject,
      text: delivery.body,
      replyTo: thread.replyToAddress,
      headers: [
        { name: "Message-ID", value: outgoingMessageId(delivery.messageId, mailbox.domain) },
        { name: "In-Reply-To", value: thread.anchorMessageId },
        { name: "References", value: thread.anchorMessageId },
        { name: "X-Compass-Reply-Token", value: thread.replyToken },
      ],
    })
  } catch (error) {
    result = {
      kind: "unknown",
      error: error instanceof Error ? error.message : "Email dispatch outcome is unknown.",
    }
  }
  const now = new Date().toISOString()
  if (result.kind === "accepted") {
    await input.db.update(correspondenceEmailDeliveries).set({ status: "accepted", providerMessageId: result.providerMessageId, acceptedAt: now, error: null, updatedAt: now }).where(eq(correspondenceEmailDeliveries.id, delivery.id))
    return { kind: "accepted", deliveryId: delivery.id }
  }
  await input.db.update(correspondenceEmailDeliveries).set({ status: result.kind, failedAt: result.kind === "failed" ? now : null, error: result.error.slice(0, 500), updatedAt: now }).where(eq(correspondenceEmailDeliveries.id, delivery.id))
  return { kind: result.kind, deliveryId: delivery.id, error: result.error }
}

function inboundWriteGuard(input: {
  readonly db: Db
  readonly id: string
  readonly organizationId: string
  readonly projectId: string
  readonly conversationId: string
  readonly people: readonly CurrentParticipant[]
}) {
  const peopleJson = JSON.stringify(
    input.people.map((person) => ({ userId: person.userId, role: person.role }))
  )
  const staffRoles = JSON.stringify(USER_ROLES.filter(isInternalStaffRole))
  return input.db.insert(correspondenceWriteGuards).values({
    id: input.id,
    // The CHECK constraint on this table aborts the complete D1 batch when a
    // participant is revoked or loses project access between preflight and write.
    allowed: sql`CASE WHEN
      EXISTS(SELECT 1 FROM project_correspondence c
        WHERE c.id=${input.conversationId}
          AND c.organization_id=${input.organizationId}
          AND c.project_id=${input.projectId})
      AND NOT EXISTS(SELECT 1 FROM json_each(${peopleJson}) person WHERE NOT EXISTS(
        SELECT 1 FROM correspondence_participants cp
          JOIN users u ON u.id=cp.user_id
          JOIN organization_members om ON om.user_id=u.id AND om.organization_id=${input.organizationId}
          LEFT JOIN project_members pm ON pm.user_id=u.id AND pm.project_id=${input.projectId}
        WHERE cp.conversation_id=${input.conversationId}
          AND cp.user_id=json_extract(person.value,'$.userId')
          AND cp.revoked_at IS NULL
          AND u.is_active=1
          AND CASE json_extract(person.value,'$.role')
            WHEN 'staff' THEN om.role IN (SELECT value FROM json_each(${staffRoles}))
            WHEN 'owner' THEN pm.role IN ('owner','client')
            WHEN 'sub_vendor' THEN pm.role IN ('subcontractor','supplier')
            ELSE 0 END
      ))
      THEN 1 ELSE 0 END`,
  })
}

function clearInboundWriteGuard(input: {
  readonly db: Db
  readonly id: string
}) {
  return input.db
    .delete(correspondenceWriteGuards)
    .where(eq(correspondenceWriteGuards.id, input.id))
}

function eventStatus(decision: ReturnType<typeof decideCorrespondenceInbound>): "held" | "suppressed" | "rejected" {
  return decision.kind === "held" ? "held" : decision.kind === "suppressed" ? "suppressed" : "rejected"
}

export async function receiveCorrespondenceEmail(input: {
  readonly db: Db
  readonly environment: unknown
  readonly organizationId: string
  readonly candidate: InboundCandidate
  readonly providerAuthenticated: boolean
  /** Gmail polling currently supplies header-only identity, which must hold. */
  readonly senderEvidence: "verified_participant" | "header_only"
  readonly isAutomatedResponse: boolean
  readonly isDeliveryLoop: boolean
  readonly attachments: "ready" | "held"
}): Promise<CorrespondenceInboundEmailResult> {
  const existing = await input.db.select({ id: correspondenceEmailEvents.id }).from(correspondenceEmailEvents)
    .where(and(eq(correspondenceEmailEvents.provider, "gmail"), eq(correspondenceEmailEvents.providerEventId, input.candidate.gmailMessageId))).get().then((row) => row ?? null)
  if (existing) return { kind: "duplicate" }
  const thread = input.candidate.token
    ? await input.db.select().from(correspondenceEmailThreads).where(and(eq(correspondenceEmailThreads.replyToken, input.candidate.token), eq(correspondenceEmailThreads.organizationId, input.organizationId))).get().then((row) => row ?? null)
    : null
  const enabled = thread !== null && isCorrespondenceEmailEnabled(thread.projectId, input.environment)
  const people = thread && enabled ? await currentEmailParticipants({ db: input.db, organizationId: input.organizationId, projectId: thread.projectId, conversationId: thread.conversationId }) : []
  const sender = people.find((person) => normalizedAddress(person.email) === normalizedAddress(input.candidate.fromAddress))
  const expectedReplyIds = thread && enabled
    ? await replyMessageIds({ db: input.db, conversationId: thread.conversationId, anchorMessageId: thread.anchorMessageId })
    : []
  const decision = decideCorrespondenceInbound({
    transport: "email",
    providerEventId: input.candidate.gmailMessageId,
    providerAuthenticated: input.providerAuthenticated,
    deduplication: "claimed",
    target: thread && enabled ? { organizationId: input.organizationId, projectId: thread.projectId, conversationId: thread.conversationId } : null,
    sender: {
      identifier: input.candidate.fromAddress,
      authorization: sender && input.senderEvidence === "verified_participant" ? "authorized_participant" : "unknown",
    },
    isAutomatedResponse: input.isAutomatedResponse,
    isDeliveryLoop: input.isDeliveryLoop,
    attachments: input.attachments,
    email: {
      isReply: isReplyMessage(input.candidate),
      token: thread ? "matched" : input.candidate.token ? "invalid" : "missing",
      replyHeaders: thread ? headerMatchesAnchor(input.candidate, expectedReplyIds) : "missing",
    },
  })
  const now = new Date().toISOString()
  if (decision.kind !== "accepted" || !thread || !sender) {
    const status = decision.kind === "accepted" ? "held" : eventStatus(decision)
    const holdReason = decision.kind === "accepted" ? "sender_not_authorized" : decision.reason
    const inserted = await input.db.insert(correspondenceEmailEvents).values({ id: crypto.randomUUID(), provider: "gmail", providerEventId: input.candidate.gmailMessageId, organizationId: input.organizationId, projectId: thread?.projectId ?? null, conversationId: thread?.conversationId ?? null, messageId: null, senderAddress: normalizedAddress(input.candidate.fromAddress), status, holdReason, createdAt: now, updatedAt: now }).onConflictDoNothing().returning({ id: correspondenceEmailEvents.id })
    return inserted[0]
      ? { kind: decision.kind === "accepted" ? "held" : decision.kind }
      : { kind: "duplicate" }
  }
  const messageId = crypto.randomUUID()
  const guardId = crypto.randomUUID()
  try {
    await input.db.batch([
      inboundWriteGuard({ db: input.db, id: guardId, organizationId: input.organizationId, projectId: thread.projectId, conversationId: thread.conversationId, people }),
      input.db.insert(correspondenceEmailEvents).values({ id: crypto.randomUUID(), provider: "gmail", providerEventId: input.candidate.gmailMessageId, organizationId: input.organizationId, projectId: thread.projectId, conversationId: thread.conversationId, messageId, senderAddress: normalizedAddress(input.candidate.fromAddress), status: "posted", holdReason: null, createdAt: now, updatedAt: now }),
      input.db.insert(correspondenceMessages).values({ id: messageId, conversationId: thread.conversationId, authorUserId: sender.userId, authorName: sender.name, source: "email", sourceKey: `gmail:${input.candidate.gmailMessageId}`, body: input.candidate.textBody ?? input.candidate.snippet ?? "(No message body.)", sentAt: input.candidate.receivedAt, editedAt: null, retractedAt: null, requestHash: `gmail:${input.candidate.gmailMessageId}` }),
      ...people.map((person) => input.db.insert(correspondenceRecipients).values({ id: crypto.randomUUID(), messageId, userId: person.userId, name: person.name, kind: person.userId === sender.userId ? "author" : "to", openedAt: null, baseline: false })),
      clearInboundWriteGuard({ db: input.db, id: guardId }),
    ])
    return { kind: "posted", messageId }
  } catch {
    const duplicate = await input.db.select({ id: correspondenceEmailEvents.id }).from(correspondenceEmailEvents)
      .where(and(eq(correspondenceEmailEvents.provider, "gmail"), eq(correspondenceEmailEvents.providerEventId, input.candidate.gmailMessageId))).get().then((row) => row ?? null)
    if (duplicate) return { kind: "duplicate" }
    // A guard failure means the current audience changed. Record the event as
    // held rather than posting it to a now-invalid recipient snapshot.
    const held = await input.db
      .insert(correspondenceEmailEvents)
      .values({
        id: crypto.randomUUID(),
        provider: "gmail",
        providerEventId: input.candidate.gmailMessageId,
        organizationId: input.organizationId,
        projectId: thread.projectId,
        conversationId: thread.conversationId,
        messageId: null,
        senderAddress: normalizedAddress(input.candidate.fromAddress),
        status: "held",
        holdReason: "audience_changed",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: correspondenceEmailEvents.id })
    if (held[0]) return { kind: "held" }
    return { kind: "duplicate" }
  }
}
