import "server-only"

/**
 * Job emails Compass held for a person to check (`inbound_emails` rows still
 * `needs_review`), as the Staff Message Desk shows and posts them.
 *
 * Posting reuses the automatic route, routeInboundProjectMessage, so a posted
 * email lands in the job's Messages exactly as an automatic one would, with
 * its files when Gmail still has them. Two things differ because a staff
 * member is vouching for the email: the sender need not be a contact, and
 * when no one on the job can be notified the reviewer receives it.
 */
import { and, count, desc, eq, inArray } from "drizzle-orm"

import { activityEvents, inboundEmails, projects } from "@/db/schema"
import { actionFailure, type ActionResult } from "@/lib/action-result"
import { recordActivityEvent } from "@/lib/activity-log"
import type { AuthUser } from "@/lib/auth"
import { chunkD1Values } from "@/lib/d1-query"
import { claimInboundEmailForReview, markInboundEmailPosted, releaseInboundEmailClaim } from "@/lib/domain/correspondence/email-store"
import { COMPASS_GMAIL_READONLY_SCOPE, getCompassGmailAccessToken } from "@/lib/email/compass-email"
import { fetchGmailJson, hydrateCandidateAttachments } from "@/lib/email/gmail-inbound"
import { candidateFromMessage, isGmailMessage, stripHtml, type InboundCandidate } from "@/lib/email/gmail-message-parser"
import { heldEmailReason, heldMessageReasonLabel, type HeldEmailReasonView } from "@/lib/email/held-email-reasons"
import { inboundRecordKind, matchInboundProject } from "@/lib/email/inbound-routing"
import { projectEmailTitle } from "@/lib/email/project-address"
import { candidateBody } from "@/lib/email/project-inbound-routing"
import { routeInboundProjectMessage } from "@/lib/email/project-message-routing"
import { replyMailboxEmail } from "@/lib/email/reply-tracking"
import type { Db } from "@/lib/server/action-context"

const NEEDS_REVIEW = "needs_review"
const PREVIEW_LENGTH = 240
const BODY_LENGTH = 20_000

export type HeldJobEmailProject = {
  readonly id: string
  readonly projectNumber: string | null
  readonly name: string
}

export type HeldJobEmail = {
  readonly id: string
  readonly receivedAt: string
  readonly fromName: string | null
  readonly fromAddress: string
  readonly toAddress: string | null
  readonly subject: string
  readonly preview: string
  readonly body: string
  /** The job the email was addressed to, if any. */
  readonly project: HeldJobEmailProject | null
  /** The job the picker starts on: the addressed job, else a job named in the email. */
  readonly suggestedProjectId: string | null
  readonly reason: HeldEmailReasonView
  /** True when the subject carries an RFI tag, so "Make RFI" applies. */
  readonly isRfi: boolean
}

export type HeldJobEmailQueue = {
  readonly items: readonly HeldJobEmail[]
  readonly projects: readonly HeldJobEmailProject[]
}

/** The Activity row each hold writes (project-inbound-routing: `project-email-review-<gmail id>`). */
function holdActivityId(gmailMessageId: string): string {
  return `project-email-review-${gmailMessageId}`
}

function emailBodyText(email: {
  readonly textBody: string | null
  readonly htmlBody: string | null
  readonly snippet: string | null
}): string {
  return (
    email.textBody?.trim() ||
    (email.htmlBody ? stripHtml(email.htmlBody) : "") ||
    email.snippet?.trim() ||
    "(No message body.)"
  ).trim()
}

function preview(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim()
  return flat.length > PREVIEW_LENGTH ? `${flat.slice(0, PREVIEW_LENGTH - 1)}…` : flat
}

/** Every held email in the company, newest first, with why it was held. */
export async function listHeldJobEmails(db: Db, organizationId: string): Promise<HeldJobEmailQueue> {
  const [projectRows, emailRows] = await Promise.all([
    db
      .select({ id: projects.id, projectNumber: projects.projectNumber, name: projects.name })
      .from(projects)
      .where(eq(projects.organizationId, organizationId))
      .orderBy(projects.projectNumber, projects.name),
    db
      .select()
      .from(inboundEmails)
      .where(and(eq(inboundEmails.organizationId, organizationId), eq(inboundEmails.matchedStatus, NEEDS_REVIEW)))
      .orderBy(desc(inboundEmails.receivedAt)),
  ])
  const activityIds = emailRows.map((email) => holdActivityId(email.gmailMessageId))
  const activityRows = (
    await Promise.all(
      chunkD1Values(activityIds).map((ids) =>
        db
          .select({ id: activityEvents.id, metadata: activityEvents.metadata })
          .from(activityEvents)
          .where(and(eq(activityEvents.organizationId, organizationId), inArray(activityEvents.id, ids)))
      )
    )
  ).flat()
  const activityById = new Map(activityRows.map((row) => [row.id, row]))
  const projectById = new Map(projectRows.map((project) => [project.id, project]))

  return {
    projects: projectRows,
    items: emailRows.map((email) => {
      const body = emailBodyText(email)
      const activity = activityById.get(holdActivityId(email.gmailMessageId))
      return {
        id: email.id,
        receivedAt: email.receivedAt,
        fromName: email.fromName,
        fromAddress: email.fromAddress,
        toAddress: email.toAddress,
        subject: email.subject,
        preview: preview(body),
        body: body.slice(0, BODY_LENGTH),
        project: email.projectId ? projectById.get(email.projectId) ?? null : null,
        suggestedProjectId: email.projectId ?? matchInboundProject(email, projectRows)?.id ?? null,
        reason: heldEmailReason({
          hasActivity: activity !== undefined,
          activityMetadata: activity?.metadata ?? null,
          projectId: email.projectId,
          text: `${email.subject}\n${body}`,
        }),
        isRfi: inboundRecordKind(email.subject) === "rfi",
      }
    }),
  }
}

/** How many emails are held in the company (the Message Desk sidebar count). */
export async function countHeldJobEmails(db: Db, organizationId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(inboundEmails)
    .where(and(eq(inboundEmails.organizationId, organizationId), eq(inboundEmails.matchedStatus, NEEDS_REVIEW)))
  return row?.value ?? 0
}

type StoredEmail = typeof inboundEmails.$inferSelect

function storedCandidate(email: StoredEmail): InboundCandidate {
  return {
    gmailMessageId: email.gmailMessageId,
    gmailThreadId: email.gmailThreadId,
    messageIdHeader: email.messageIdHeader,
    inReplyToHeader: email.inReplyToHeader,
    referencesHeader: email.referencesHeader,
    token: email.token,
    fromAddress: email.fromAddress,
    fromName: email.fromName,
    toAddress: email.toAddress,
    subject: email.subject,
    textBody: email.textBody,
    htmlBody: email.htmlBody,
    snippet: email.snippet,
    receivedAt: email.receivedAt,
    attachments: [],
  }
}

/**
 * The held email as it was received. Compass keeps the text but not the
 * files, so the files are fetched from Gmail again. `filesFetched` is false
 * when Gmail could not be reached; the email is then posted without them.
 */
async function heldEmailCandidate(input: {
  readonly db: Db
  readonly env: unknown
  readonly organizationId: string
  readonly email: StoredEmail
}): Promise<{ readonly candidate: InboundCandidate; readonly filesFetched: boolean }> {
  const stored = storedCandidate(input.email)
  try {
    const access = await getCompassGmailAccessToken({
      env: input.env,
      db: input.db,
      organizationId: input.organizationId,
      scopes: [COMPASS_GMAIL_READONLY_SCOPE],
      sender: replyMailboxEmail(input.env),
    })
    if (!access.success) return { candidate: stored, filesFetched: false }
    const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(input.email.gmailMessageId)}`)
    url.searchParams.set("format", "full")
    const message = await fetchGmailJson({ url: url.toString(), accessToken: access.accessToken })
    if (!isGmailMessage(message)) return { candidate: stored, filesFetched: false }
    const { attachments } = candidateFromMessage(message)
    if (attachments.length === 0) return { candidate: stored, filesFetched: true }
    return {
      candidate: await hydrateCandidateAttachments({ candidate: { ...stored, attachments }, accessToken: access.accessToken }),
      filesFetched: true,
    }
  } catch (error) {
    console.error("[held-job-emails] could not fetch the email's files from Gmail", error)
    return { candidate: stored, filesFetched: false }
  }
}

function personName(user: Pick<AuthUser, "displayName" | "firstName" | "lastName" | "email">): string {
  return user.displayName?.trim() || [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || user.email
}

export type PostedHeldJobEmail = {
  readonly projectId: string
  readonly messageId: string
  /** The email had files that could not be posted with it. */
  readonly filesLeftOut: boolean
  /** Gmail couldn't be reached, so any files weren't copied (there may have been none). */
  readonly filesUnchecked: boolean
}

/**
 * Posts one held email into a job's Messages on a staff member's word. The
 * caller has checked that `reviewer` may review held emails.
 */
export async function postHeldJobEmail(input: {
  readonly db: Db
  readonly env: unknown
  readonly organizationId: string
  readonly reviewer: AuthUser
  readonly emailId: string
  readonly projectId: string
}): Promise<ActionResult<PostedHeldJobEmail>> {
  const { db, organizationId } = input
  const [email] = await db
    .select()
    .from(inboundEmails)
    .where(
      and(
        eq(inboundEmails.id, input.emailId),
        eq(inboundEmails.organizationId, organizationId),
        eq(inboundEmails.matchedStatus, NEEDS_REVIEW)
      )
    )
    .limit(1)
  if (!email) return actionFailure("This email is no longer waiting for review.")
  const [project] = await db
    .select({ id: projects.id, projectNumber: projects.projectNumber, name: projects.name })
    .from(projects)
    .where(and(eq(projects.id, input.projectId), eq(projects.organizationId, organizationId)))
    .limit(1)
  if (!project) return actionFailure("Job not found.")

  // Take the email first so a second reviewer can't post or dismiss it meanwhile.
  if (!(await claimInboundEmailForReview(db, email.id, organizationId))) {
    return actionFailure("Someone else is already handling this email.")
  }
  try {
    const posted = await postClaimedEmail({ ...input, email, project })
    if (!posted.success) await releaseInboundEmailClaim(db, email.id)
    return posted
  } catch (error) {
    await releaseInboundEmailClaim(db, email.id)
    throw error
  }
}

async function postClaimedEmail(input: {
  readonly db: Db
  readonly env: unknown
  readonly organizationId: string
  readonly reviewer: AuthUser
  readonly email: typeof inboundEmails.$inferSelect
  readonly project: { readonly id: string; readonly projectNumber: string | null; readonly name: string }
}): Promise<ActionResult<PostedHeldJobEmail>> {
  const { db, organizationId, reviewer, email, project } = input
  const { candidate, filesFetched } = await heldEmailCandidate({
    db,
    env: input.env,
    organizationId,
    email,
  })
  const post = (attachments: InboundCandidate["attachments"]): ReturnType<typeof routeInboundProjectMessage> => {
    const posted = { ...candidate, attachments }
    return routeInboundProjectMessage({
      db,
      env: input.env,
      organizationId,
      projectId: project.id,
      candidate: posted,
      body: candidateBody(posted),
      source: "email",
      now: new Date().toISOString(),
      fallbackRecipientUserId: reviewer.id,
    })
  }
  let routed = await post(candidate.attachments)
  // Files are "left out" only when there were files; Gmail being unreachable is "unchecked".
  let filesLeftOut = false
  const filesUnchecked = !filesFetched
  // The reviewer asked for the email itself; files that can't be saved don't block it.
  if (routed.status === "held" && routed.reason === "attachment_failed" && candidate.attachments.length > 0) {
    routed = await post([])
    filesLeftOut = true
  }
  if (routed.status === "held") return actionFailure(`${heldMessageReasonLabel(routed.reason)}.`)

  await markInboundEmailPosted(db, email.id, { projectId: project.id, postedMessageId: routed.id })
  const sender = email.fromName?.trim() || email.fromAddress
  const title = projectEmailTitle(email.subject) || email.subject
  await recordActivityEvent({
    db,
    id: `project-email-reviewed-${email.gmailMessageId}`,
    organizationId,
    projectId: project.id,
    actor: {
      id: reviewer.id,
      email: reviewer.email,
      displayName: reviewer.displayName,
      firstName: reviewer.firstName,
      lastName: reviewer.lastName,
      role: reviewer.role,
    },
    category: "email",
    action: "project_email.routed",
    entityType: "project_correspondence",
    entityId: routed.id,
    summary: `${personName(reviewer)} reviewed a held email from ${sender} and posted it to job messages: “${title}”.${filesLeftOut ? " Its attached files couldn't be saved and were not included." : filesUnchecked ? " Gmail couldn't be reached to copy any attached files." : ""}`,
    metadata: {
      destination: "message",
      manualReview: true,
      routedBy: reviewer.id,
      filesLeftOut,
      filesUnchecked,
    },
  })
  return { success: true, data: { projectId: project.id, messageId: routed.id, filesLeftOut, filesUnchecked } }
}
