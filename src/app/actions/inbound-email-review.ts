"use server"

/**
 * Held job emails on the Staff Message Desk: emails to a job's Compass inbox
 * that Compass held for a person to check (`inbound_emails` still
 * `needs_review`). Staff post them to the job's Messages, make an RFI from an
 * RFI-tagged one, or dismiss them.
 */
import { and, eq, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { inboundEmails, projectRfis, projects } from "@/db/schema"
import { insertRfi } from "@/lib/domain/rfis/store"
import { actionFailure, errorMessage, type ActionDone, type ActionResult } from "@/lib/action-result"
import { recordActivityEvent } from "@/lib/activity-log"
import { stripHtml } from "@/lib/email/gmail-message-parser"
import {
  countHeldJobEmails,
  listHeldJobEmails,
  postHeldJobEmail,
  type HeldJobEmailQueue,
} from "@/lib/email/held-job-emails"
import { inboundRecordKind, inboundRecordSubject } from "@/lib/email/inbound-routing"
import { notifyRfiCreated } from "@/lib/notifications/events"
import { canFeature } from "@/lib/permission-enforcement"
import { canReviewHeldJobEmails } from "@/lib/staff-message-desk"
import type { Db } from "@/lib/server/action-context"
import { claimInboundEmailForReview, dismissInboundEmailForReview, markInboundEmailPosted, releaseInboundEmailClaim } from "@/lib/domain/correspondence/email-store"
import { orgContext, type OrgContext } from "@/lib/server/action-context"

const MESSAGE_DESK_PATH = "/dashboard/office-maintenance/message-desk"

function bodyText(input: {
  readonly textBody: string | null
  readonly htmlBody: string | null
  readonly snippet: string | null
}): string {
  return (
    input.textBody ??
    (input.htmlBody ? stripHtml(input.htmlBody) : null) ??
    input.snippet ??
    "(No message body.)"
  ).trim()
}

function rfiNumberFor(
  projectNumber: string | null,
  existingCount: number,
  id: string
): string {
  const sequence = String(existingCount + 1).padStart(3, "0")
  const prefix = projectNumber?.trim() ?? ""
  return prefix.length > 0
    ? `${prefix}-RFI-${sequence}`
    : `RFI-${sequence}-${id.slice(0, 6).toUpperCase()}`
}

async function reviewContext(mutation: boolean): Promise<ActionResult<OrgContext>> {
  const context = await orgContext({ mutation })
  if (!context.success) return context
  if (!canReviewHeldJobEmails(context.data.user)) {
    return actionFailure("Reviewing held job emails needs project manager or project administration access.")
  }
  return context
}

/** Every held job email in the company, with the jobs to post them to. */
export async function getHeldJobEmails(): Promise<ActionResult<HeldJobEmailQueue>> {
  try {
    const context = await reviewContext(false)
    if (!context.success) return context
    return { success: true, data: await listHeldJobEmails(context.data.db, context.data.organizationId) }
  } catch (error) {
    return actionFailure(errorMessage(error, "Couldn't load held job emails."))
  }
}

/** Held job emails for the sidebar count; 0 for anyone who can't review them. */
export async function countReviewableHeldJobEmails(): Promise<number> {
  try {
    const context = await reviewContext(false)
    if (!context.success) return 0
    return await countHeldJobEmails(context.data.db, context.data.organizationId)
  } catch {
    return 0
  }
}

/**
 * Posts a held email into a job's Messages, as the automatic route would
 * have. The reviewer vouches for it, so an unrecognized sender doesn't block
 * it, and the reviewer receives it when no one on the job can be notified.
 */
export async function postHeldJobEmailToJob(input: {
  readonly emailId: string
  readonly projectId: string
}): Promise<ActionResult<{ readonly projectId: string; readonly filesLeftOut: boolean; readonly filesUnchecked: boolean }>> {
  try {
    const context = await reviewContext(true)
    if (!context.success) return context
    const { db, env, organizationId, user } = context.data
    const posted = await postHeldJobEmail({
      db,
      env,
      organizationId,
      reviewer: user,
      emailId: input.emailId,
      projectId: input.projectId,
    })
    if (!posted.success) return posted
    revalidatePath(MESSAGE_DESK_PATH)
    revalidatePath(`/dashboard/projects/${posted.data.projectId}/messages`)
    return { success: true, data: { projectId: posted.data.projectId, filesLeftOut: posted.data.filesLeftOut, filesUnchecked: posted.data.filesUnchecked } }
  } catch (error) {
    return actionFailure(errorMessage(error, "Couldn't post the email to job messages."))
  }
}

/** Makes an RFI on the chosen job from a held email with an RFI subject tag. */
export async function routeInboundEmailToRfi(input: {
  readonly emailId: string
  readonly projectId: string
}): Promise<ActionDone> {
  // Set once this action has taken the email; released if anything below fails.
  let claimed: { readonly db: Db; readonly emailId: string } | null = null
  try {
    const context = await reviewContext(true)
    if (!context.success) return context
    const { db, organizationId, user } = context.data
    if (!(await canFeature(user, "rfis", "create"))) return actionFailure("You don't have permission to create RFIs.")

    const [email] = await db
      .select()
      .from(inboundEmails)
      .where(
        and(
          eq(inboundEmails.id, input.emailId),
          eq(inboundEmails.organizationId, organizationId),
          eq(inboundEmails.matchedStatus, "needs_review")
        )
      )
      .limit(1)
    if (!email) return actionFailure("This email is no longer waiting for review.")
    if (inboundRecordKind(email.subject) !== "rfi") {
      return actionFailure("This email does not have an RFI subject tag.")
    }

    const [project] = await db
      .select({
        id: projects.id,
        name: projects.name,
        projectNumber: projects.projectNumber,
      })
      .from(projects)
      .where(
        and(
          eq(projects.id, input.projectId),
          eq(projects.organizationId, organizationId)
        )
      )
      .limit(1)
    if (!project) return actionFailure("Job not found.")
    if (!(await claimInboundEmailForReview(db, email.id, organizationId))) {
      return actionFailure("Someone else is already handling this email.")
    }
    claimed = { db, emailId: email.id }

    const [existing] = await db
      .select({ id: projectRfis.id, rfiNumber: projectRfis.rfiNumber })
      .from(projectRfis)
      .where(
        and(
          eq(projectRfis.sourceSystem, "email"),
          eq(projectRfis.sourceRecordId, email.gmailMessageId)
        )
      )
      .limit(1)

    let rfi = existing
    if (!rfi) {
      const count = await db
        .select({ count: sql<number>`count(*)` })
        .from(projectRfis)
        .where(eq(projectRfis.projectId, project.id))
        .then((rows) => rows[0]?.count ?? 0)
      const now = new Date().toISOString()
      const id = crypto.randomUUID()
      const rfiNumber = rfiNumberFor(project.projectNumber, count, id)
      await insertRfi(db, {
        id,
        projectId: project.id,
        sourceSystem: "email",
        sourceRecordId: email.gmailMessageId,
        rfiNumber,
        subject: inboundRecordSubject(email.subject),
        question: bodyText(email),
        answer: null,
        status: "new",
        priority: "normal",
        audience: "internal",
        requesterName: email.fromName ?? email.fromAddress,
        assignedToName: null,
        companyName: null,
        dueDate: null,
        submittedAt: email.receivedAt,
        answeredAt: null,
        createdAt: now,
        updatedAt: now,
      })
      rfi = { id, rfiNumber }

      await recordActivityEvent({
        db,
        id: `project-email-routed-${email.gmailMessageId}`,
        organizationId,
        projectId: project.id,
        actor: {
          id: null,
          email: email.fromAddress,
          displayName: email.fromName,
          firstName: null,
          lastName: null,
          role: "project_email",
        },
        category: "email",
        action: "project_email.routed",
        entityType: "rfi",
        entityId: id,
        summary: `Routed project email from ${email.fromName ?? email.fromAddress} to RFI: “${inboundRecordSubject(email.subject)}”.`,
        metadata: {
          destination: "rfi",
          manualReview: true,
          routedBy: user.id,
        },
        createdAt: email.receivedAt,
      })

      try {
        await notifyRfiCreated({
          organizationId,
          projectId: project.id,
          rfiId: id,
          rfiNumber,
          subject: inboundRecordSubject(email.subject),
          assignedToName: null,
          createdBy: user,
        })
      } catch (error) {
        console.error("[inbound-email-review] notification error", error)
      }
    }

    await markInboundEmailPosted(db, email.id, { projectId: project.id, postedMessageId: rfi.id })

    revalidatePath(MESSAGE_DESK_PATH)
    revalidatePath(`/dashboard/projects/${project.id}/rfis`)
    revalidatePath("/dashboard/rfis")
    return { success: true }
  } catch (error) {
    if (claimed) await releaseInboundEmailClaim(claimed.db, claimed.emailId).catch(() => undefined)
    return actionFailure(errorMessage(error, "Couldn't make an RFI from the email."))
  }
}

/** Takes a held email off the list without posting it anywhere. */
export async function dismissInboundEmail(input: { readonly emailId: string }): Promise<ActionDone> {
  try {
    const context = await reviewContext(true)
    if (!context.success) return context
    if (!(await dismissInboundEmailForReview(context.data.db, input.emailId, context.data.organizationId))) {
      return actionFailure("This email is no longer waiting for review.")
    }
    revalidatePath(MESSAGE_DESK_PATH)
    return { success: true }
  } catch (error) {
    return actionFailure(errorMessage(error, "Couldn't dismiss the email."))
  }
}
