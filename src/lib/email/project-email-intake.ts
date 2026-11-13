import "server-only"

/**
 * Which job an inbound email is for. Product rule: email goes to its job's
 * inbox automatically unless Compass can't tell which job it is.
 *
 * The job is known, in order, from:
 *   1. a tracked reply thread with a job (handled before this, in gmail-inbound);
 *   2. the job's Compass address (jarvis+project-<id>@…);
 *   3. a subject tag plus the job named in the email (unchanged tagged routing);
 *   4. exactly one of the company's job numbers in the To address, subject or
 *      body. None or several leave the job unknown and the email is held.
 */
import { eq } from "drizzle-orm"

import type { getDb } from "@/db"
import { projects } from "@/db/schema"
import { recordActivityEvent } from "@/lib/activity-log"
import type { InboundCandidate } from "@/lib/email/gmail-message-parser"
import { exactJobNumberMatches, matchInboundProject, type InboundRoutingCandidate, type InboundRoutingProject } from "@/lib/email/inbound-routing"
import { projectEmailDestination, projectIdFromInboundAddress } from "@/lib/email/project-address"
import { routeKnownJobEmail, type ProjectInboundRouteResult } from "@/lib/email/project-inbound-routing"

type Db = ReturnType<typeof getDb>

type InboundEmailJob =
  | { readonly kind: "known"; readonly projectId: string }
  | { readonly kind: "unknown" }
  | { readonly kind: "several"; readonly projectIds: readonly string[] }

/** Pure: the job an email is for, from its address or the one job number it names. */
function inboundEmailJob(input: {
  readonly candidate: InboundRoutingCandidate
  readonly projects: readonly InboundRoutingProject[]
  /** Job numbers in the text count only when no tracked reply thread claims the email. */
  readonly matchJobNumbers: boolean
}): InboundEmailJob {
  const addressed = projectIdFromInboundAddress(input.candidate.toAddress)
  if (addressed) return { kind: "known", projectId: addressed }
  // Subject-tagged email keeps today's match, including the office job for "office" emails.
  if (projectEmailDestination(input.candidate.subject)) {
    const tagged = matchInboundProject(input.candidate, input.projects)
    if (tagged) return { kind: "known", projectId: tagged.id }
  }
  if (!input.matchJobNumbers) return { kind: "unknown" }
  const matches = exactJobNumberMatches(input.candidate, input.projects)
  if (matches.length === 1 && matches[0]) return { kind: "known", projectId: matches[0].id }
  return matches.length > 1 ? { kind: "several", projectIds: matches.map((project) => project.id) } : { kind: "unknown" }
}

export async function routeProjectInboundEmail(input: {
  readonly env: unknown
  readonly db: Db
  readonly organizationId: string
  readonly candidate: InboundCandidate
  /** False when a tracked reply thread will handle the email. */
  readonly matchJobNumbers?: boolean
}): Promise<ProjectInboundRouteResult> {
  const addressed = projectIdFromInboundAddress(input.candidate.toAddress)
  const projectRows = addressed
    ? []
    : await input.db
        .select({ id: projects.id, projectNumber: projects.projectNumber, name: projects.name })
        .from(projects)
        .where(eq(projects.organizationId, input.organizationId))
  const job = inboundEmailJob({ candidate: input.candidate, projects: projectRows, matchJobNumbers: input.matchJobNumbers ?? false })
  if (job.kind === "unknown") return { kind: "not_project_email" }
  if (job.kind === "several") {
    await recordActivityEvent({
      db: input.db,
      id: `project-email-review-${input.candidate.gmailMessageId}`,
      organizationId: input.organizationId,
      projectId: null,
      actor: {
        id: null,
        email: input.candidate.fromAddress,
        displayName: input.candidate.fromName,
        firstName: null,
        lastName: null,
        role: "project_email",
      },
      category: "email",
      action: "project_email.needs_review",
      entityType: "project_email",
      entityId: input.candidate.gmailMessageId,
      summary: `Email from ${input.candidate.fromName?.trim() || input.candidate.fromAddress} names ${job.projectIds.length} jobs, so it is awaiting review.`,
      metadata: { heldReason: "several_jobs", jobCount: job.projectIds.length },
      createdAt: input.candidate.receivedAt,
    })
    return { kind: "needs_review", projectId: null }
  }
  return routeKnownJobEmail({ ...input, projectId: job.projectId })
}
