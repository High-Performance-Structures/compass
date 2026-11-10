import "server-only"

/**
 * Telling people about access requests, following the email standard
 * (docs/development/email-workflows.md):
 * - a new request notifies the company's admins (event type
 *   "access_request.submitted": the bell right away, email and push in the
 *   next notification digest when the company uses one);
 * - an approval or a decline emails the person through `sendTrackedEmail`
 *   from the admin who decided, and the send is logged in Activity.
 * Telling people never undoes the decision; a failed email is reported back
 * to the admin so they can follow up.
 */
import { recordActivityEvent, type ActivityActor } from "@/lib/activity-log"
import { sendTrackedEmail } from "@/lib/email/tracked-send"
import { ACCESS_REQUESTS_HREF } from "@/lib/email/tracked-record-email"
import { createSystemNotificationEvent, notificationLink } from "@/lib/notifications/create-event"
import type { Db } from "@/lib/server/action-context"
import { userRoleLabel } from "@/lib/user-roles"

import { accessRequestDeciders } from "./queries"
import { ACCESS_REQUEST_KIND_LABELS } from "./rules"
import type { ApprovedAccessRequest, DecidedAccessRequest, SubmittedAccessRequest } from "./service"

/** Where the person sees their requests and opens an approved company. */
const REQUEST_ACCESS_HREF = "/dashboard/request-access"

export async function notifyAccessRequestDeciders(db: Db, request: SubmittedAccessRequest): Promise<void> {
  try {
    const recipients = await accessRequestDeciders(db, request.organizationId)
    if (recipients.length === 0) return
    const who = ACCESS_REQUEST_KIND_LABELS[request.kind].toLowerCase()
    const company = request.companyName ? ` from ${request.companyName}` : ""
    await createSystemNotificationEvent({
      organizationId: request.organizationId,
      projectId: null,
      eventType: "access_request.submitted",
      sourceType: "organization_access_request",
      sourceId: request.requestId,
      title: `Access request: ${request.requesterName}`,
      body: `${request.requesterName}${company} asked for access to Compass as a ${who}. Link them to their directory record, then approve or decline.`,
      href: ACCESS_REQUESTS_HREF,
      priority: "normal",
      audience: "internal",
      recipients,
      delivery: { inApp: true, email: true, push: true },
    })
  } catch (error) {
    console.error("[access-requests] admin notification failed", error)
  }
}

function greeting(request: DecidedAccessRequest): string {
  const name = request.requesterFirstName?.trim() || request.requesterName.split(/\s+/)[0] || ""
  return name && !name.includes("@") ? `Hi ${name},` : "Hello,"
}

function listJobs(projects: readonly string[]): string {
  const shown = projects.slice(0, 10).map((label) => `- ${label}`)
  const more = projects.length > shown.length ? [`- and ${projects.length - shown.length} more`] : []
  return [...shown, ...more].join("\n")
}

export function approvalEmailText(env: unknown, request: ApprovedAccessRequest): { readonly subject: string; readonly text: string } {
  const org = request.organizationName
  const access = request.kind === "employee"
    ? `You've been added to ${org} as ${userRoleLabel(request.role)}.`
    : request.projects.length > 0
      ? `You can now see ${request.projects.length === 1 ? "this job" : `these ${request.projects.length} jobs`}:\n\n${listJobs(request.projects)}`
      : `Your jobs will appear in Compass as soon as ${org} adds you to them.`
  return {
    subject: `Your Compass access to ${org} is approved`,
    text: [
      greeting(request),
      "",
      `${org} approved your request to use Compass. ${access}`,
      "",
      `Sign in at ${notificationLink(env, REQUEST_ACCESS_HREF)} and choose Open ${org}. If you belong to more than one company in Compass, you can switch from the company menu at the top left.`,
      "",
      `Thank you,`,
      org,
    ].join("\n"),
  }
}

export function declineEmailText(request: DecidedAccessRequest): { readonly subject: string; readonly text: string } {
  const org = request.organizationName
  return {
    subject: `Your Compass access request to ${org}`,
    text: [
      greeting(request),
      "",
      `Thank you for your interest in working with ${org} in Compass. We weren't able to approve your access request at this time.`,
      "",
      `If you think this is a mistake, just reply to this email and we'll take another look.`,
      "",
      `Thank you,`,
      org,
    ].join("\n"),
  }
}

/** Emails the person the decision and logs the send. Returns a warning for the admin when it didn't go out. */
export async function emailAccessRequestDecision(input: {
  readonly env: unknown
  readonly db: Db
  readonly actor: ActivityActor & { readonly id: string; readonly email: string }
  readonly request: DecidedAccessRequest
  readonly decision: "approved" | "declined"
  readonly message: { readonly subject: string; readonly text: string }
}): Promise<string | null> {
  const { request } = input
  let error: string | null = null
  try {
    const delivery = await sendTrackedEmail({
      env: input.env,
      db: input.db,
      organizationId: request.organizationId,
      projectId: null,
      kind: "access_request",
      recordId: request.requestId,
      recordLabel: "Access request",
      createdBy: input.actor.id,
      to: [request.requesterEmail],
      subject: input.message.subject,
      text: input.message.text,
      replyName: `${request.organizationName} - access request`,
      alsoReplyTo: [input.actor.email],
    })
    if (delivery.status !== "sent") error = delivery.error ?? "The email wasn't sent."
  } catch (sendError) {
    error = sendError instanceof Error ? sendError.message : "The email wasn't sent."
  }
  if (error) return `${input.decision === "approved" ? "Approved" : "Declined"}, but the email to ${request.requesterEmail} wasn't sent: ${error}`
  await recordActivityEvent({
    db: input.db,
    organizationId: request.organizationId,
    actor: input.actor,
    category: "email",
    action: "access_request_emailed",
    entityType: "organization_access_request",
    entityId: request.requestId,
    summary: `Emailed ${request.requesterName} (${request.requesterEmail}) that their access request was ${input.decision}.`,
  })
  return null
}
