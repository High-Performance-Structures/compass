import "server-only"

/**
 * One-time pass over emails held before the "hold only when the job is
 * unknown" rule: each held email whose job is known (its Compass address, or
 * exactly one of the company's job numbers in it) is posted to that job's
 * Messages quietly (no notifications, already read) and marked posted.
 * Emails whose job is still unknown stay held.
 *
 * Idempotent: a posted email leaves `needs_review`, the message id comes from
 * the Gmail id, and each email is claimed before it is posted. Runs a page at
 * a time (`limit`, then `after` = the returned `nextAfter`) to stay well
 * inside a request's D1 and network budget.
 */
import { and, asc, eq, gt, or, type SQL } from "drizzle-orm"

import { inboundEmails, projects } from "@/db/schema"
import { recordActivityEvents } from "@/lib/activity-log"
import { claimInboundEmailForReview, markInboundEmailPosted, releaseInboundEmailClaim } from "@/lib/domain/correspondence/email-store"
import { heldEmailCandidate } from "@/lib/email/held-job-emails"
import { exactJobNumberMatches } from "@/lib/email/inbound-routing"
import { projectEmailTitle, projectIdFromInboundAddress } from "@/lib/email/project-address"
import { candidateBody } from "@/lib/email/project-inbound-routing"
import { routeInboundProjectMessage } from "@/lib/email/project-message-routing"
import type { Db } from "@/lib/server/action-context"

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 50
/** Added when Gmail couldn't be reached to copy the email's files. */
const FILES_UNCHECKED_NOTE = "(Compass couldn't check this email for attached files. Any files are still in the original email.)"

export type HeldEmailBacklogSummary = {
  readonly scanned: number
  readonly posted: number
  /** The job is still unknown (no address, no job number or several), or posting was held. */
  readonly stillHeld: number
  /** Tracked replies, emails someone else is handling, and failures. */
  readonly skipped: number
  readonly errors: readonly string[]
  /** Pass as `after` for the next page; null when this was the last page. */
  readonly nextAfter: string | null
}

type JobRow = { readonly id: string; readonly projectNumber: string | null; readonly name: string }

function cursorCondition(after: string | null | undefined): SQL | undefined {
  if (!after) return undefined
  const separator = after.indexOf("|")
  if (separator < 0) return undefined
  const receivedAt = after.slice(0, separator)
  const id = after.slice(separator + 1)
  return or(gt(inboundEmails.receivedAt, receivedAt), and(eq(inboundEmails.receivedAt, receivedAt), gt(inboundEmails.id, id)))
}

/** The held email's job under the new rule: its address, else exactly one job number (no office fallback). */
function knownJob(email: typeof inboundEmails.$inferSelect, jobs: readonly JobRow[]): string | null {
  const addressed = projectIdFromInboundAddress(email.toAddress)
  if (addressed) return jobs.some((job) => job.id === addressed) ? addressed : null
  const matches = exactJobNumberMatches(email, jobs)
  return matches.length === 1 && matches[0] ? matches[0].id : null
}

export async function postHeldEmailBacklog(input: {
  readonly db: Db
  readonly env: unknown
  /** One company; omitted for every company (the maintenance route). */
  readonly organizationId?: string | null
  readonly limit?: number | null
  readonly after?: string | null
}): Promise<HeldEmailBacklogSummary> {
  const { db } = input
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT)
  const rows = await db
    .select()
    .from(inboundEmails)
    .where(and(
      eq(inboundEmails.matchedStatus, "needs_review"),
      input.organizationId ? eq(inboundEmails.organizationId, input.organizationId) : undefined,
      cursorCondition(input.after),
    ))
    .orderBy(asc(inboundEmails.receivedAt), asc(inboundEmails.id))
    .limit(limit)

  // Each company's jobs, read once per page.
  const jobsByOrganization = new Map<string, readonly JobRow[]>()
  await Promise.all([...new Set(rows.map((row) => row.organizationId))].map(async (organizationId) => {
    jobsByOrganization.set(organizationId, await db
      .select({ id: projects.id, projectNumber: projects.projectNumber, name: projects.name })
      .from(projects)
      .where(eq(projects.organizationId, organizationId)))
  }))

  let posted = 0
  let stillHeld = 0
  let skipped = 0
  const errors: string[] = []
  const activity: Parameters<typeof recordActivityEvents>[1][number][] = []
  const now = new Date().toISOString()
  // One email at a time: each posts files to Drive and fetches from Gmail, which are rate limited.
  for (const email of rows) {
    // A tracked reply belongs to its record's thread, not this pass.
    if (email.replyThreadId) {
      skipped += 1
      continue
    }
    const projectId = knownJob(email, jobsByOrganization.get(email.organizationId) ?? [])
    if (!projectId) {
      stillHeld += 1
      continue
    }
    if (!(await claimInboundEmailForReview(db, email.id, email.organizationId))) {
      skipped += 1
      continue
    }
    try {
      const { candidate, filesFetched } = await heldEmailCandidate({ db, env: input.env, organizationId: email.organizationId, email })
      const body = candidateBody(candidate)
      const routed = await routeInboundProjectMessage({
        db,
        env: input.env,
        organizationId: email.organizationId,
        projectId,
        candidate,
        body: filesFetched ? body : `${body}\n\n${FILES_UNCHECKED_NOTE}`,
        source: "email",
        now,
        postWhenJobKnown: true,
        quiet: true,
      })
      if (routed.status === "held") {
        await releaseInboundEmailClaim(db, email.id)
        stillHeld += 1
        continue
      }
      await markInboundEmailPosted(db, email.id, { projectId, postedMessageId: routed.id })
      posted += 1
      activity.push({
        id: `project-email-backlog-${email.gmailMessageId}`,
        organizationId: email.organizationId,
        projectId,
        actor: { id: null, email: email.fromAddress, displayName: email.fromName, firstName: null, lastName: null, role: "project_email" },
        category: "email",
        action: "project_email.routed",
        entityType: "project_correspondence",
        entityId: routed.id,
        summary: `Posted a held email from ${email.fromName?.trim() || email.fromAddress} to job messages once its job was known: “${projectEmailTitle(email.subject) || email.subject}”.`,
        metadata: { destination: "message", backlog: true, quiet: true, filesLeftOut: routed.filesLeftOut, filesUnchecked: !filesFetched },
      })
    } catch (error) {
      await releaseInboundEmailClaim(db, email.id)
      skipped += 1
      errors.push(`${email.id}: ${error instanceof Error ? error.message : "posting failed"}`)
    }
  }
  if (activity.length > 0) await recordActivityEvents(db, activity)

  const last = rows.at(-1)
  return {
    scanned: rows.length,
    posted,
    stillHeld,
    skipped,
    errors,
    nextAfter: rows.length === limit && last ? `${last.receivedAt}|${last.id}` : null,
  }
}
