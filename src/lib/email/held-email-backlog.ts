import "server-only"

/**
 * One-time pass over emails held before the "hold only when the job is
 * unknown" rule: each held email whose job is known (its Compass address, or
 * exactly one of the company's job numbers in it) is posted to that job's
 * Messages quietly (no notifications, already read) and marked posted.
 * Emails whose job is still unknown stay held.
 *
 * Each email is first read again from Gmail (held-email-reread): emails
 * imported before Compass read the Cc and Delivered-To lines were stored
 * without the job's Compass address and without Gmail's sender verdict. The
 * recovered address decides the job, the verdict feeds sender verification,
 * and both are saved on the row. The one read is reused for the files.
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
import { GmailRateLimitError } from "@/lib/email/gmail-fetch"
import { applyRecoveredHeldEmailFields, fetchHeldGmailMessage, recoveredHeldEmailFields, type HeldGmailMessage } from "@/lib/email/held-email-reread"
import { heldEmailCandidate } from "@/lib/email/held-job-emails"
import { exactJobNumberMatches } from "@/lib/email/inbound-routing"
import { projectEmailTitle, projectIdFromInboundAddress } from "@/lib/email/project-address"
import { candidateBody, senderCanEmailProject } from "@/lib/email/project-inbound-routing"
import { applySenderVerification } from "@/lib/email/sender-verification"
import { routeInboundProjectMessage } from "@/lib/email/project-message-routing"
import { isCompassMailboxSender } from "@/lib/email/reply-tracking"
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
  /** Emails whose job address was missing and was read again from Gmail. */
  readonly addressesRecovered: number
  /** Tracked replies, emails someone else is handling, and failures. */
  readonly skipped: number
  readonly errors: readonly string[]
  /**
   * Gmail rate limited the page, which stopped at the email it refused: wait,
   * then repeat with `after` = `nextAfter` (null here means from the start).
   */
  readonly rateLimited: boolean
  /** Pass as `after` for the next page; null when this was the last page (unless rateLimited). */
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

/**
 * The held email's job under the new rule: its address, else exactly one job
 * number (no office fallback). As in live intake, job numbers never route
 * Compass's own mail.
 */
function knownJob(email: typeof inboundEmails.$inferSelect, jobs: readonly JobRow[], env: unknown): string | null {
  const addressed = projectIdFromInboundAddress(email.toAddress)
  if (addressed) return jobs.some((job) => job.id === addressed) ? addressed : null
  if (isCompassMailboxSender(env, email.fromAddress)) return null
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
  let addressesRecovered = 0
  const errors: string[] = []
  const tokens = new Map<string, string>()
  // The last email this page finished with; a Gmail rate limit stops the page there.
  let resumeAfter: string | null = input.after ?? null
  let rateLimited = false
  const activity: Parameters<typeof recordActivityEvents>[1][number][] = []
  const now = new Date().toISOString()
  // One email at a time: each posts files to Drive and fetches from Gmail, which are rate limited.
  for (const storedEmail of rows) {
    // A tracked reply belongs to its record's thread, not this pass.
    if (storedEmail.replyThreadId) {
      skipped += 1
      resumeAfter = `${storedEmail.receivedAt}|${storedEmail.id}`
      continue
    }
    let fetched: HeldGmailMessage | null
    try {
      fetched = await fetchHeldGmailMessage({ db, env: input.env, email: storedEmail, tokens })
    } catch (error) {
      if (!(error instanceof GmailRateLimitError)) throw error
      errors.push(error.message)
      rateLimited = true
      break
    }
    const resumeBefore = resumeAfter
    resumeAfter = `${storedEmail.receivedAt}|${storedEmail.id}`
    const recovered = fetched ? recoveredHeldEmailFields(storedEmail, fetched.message) : null
    const email = recovered ? await applyRecoveredHeldEmailFields(db, storedEmail, recovered) : storedEmail
    if (recovered?.projectAddressRecovered) addressesRecovered += 1
    const projectId = knownJob(email, jobsByOrganization.get(email.organizationId) ?? [], input.env)
    if (!projectId) {
      stillHeld += 1
      continue
    }
    if (!(await claimInboundEmailForReview(db, email.id, email.organizationId))) {
      skipped += 1
      continue
    }
    try {
      const held = await heldEmailCandidate({ db, env: input.env, organizationId: email.organizationId, email, fetched })
      const filesFetched = held.filesFetched
      // As in live intake, an unrecognized or unverified sender's @names pick no one.
      const recognized = await senderCanEmailProject({ env: input.env, db, organizationId: email.organizationId, projectId, senderEmail: email.fromAddress })
      const verified = await applySenderVerification({ db, organizationId: email.organizationId, candidate: held.candidate, recognized })
      const candidate = verified.candidate
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
        ignoreMentions: !verified.senderAuthorized,
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
        metadata: { destination: "message", backlog: true, quiet: true, filesLeftOut: routed.filesLeftOut, filesUnchecked: !filesFetched, ...verified.metadata },
      })
    } catch (error) {
      await releaseInboundEmailClaim(db, email.id)
      if (error instanceof GmailRateLimitError) {
        // Gmail refused this email's files: stop, and start the next page at this email again.
        errors.push(error.message)
        rateLimited = true
        resumeAfter = resumeBefore
        break
      }
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
    addressesRecovered,
    skipped,
    errors,
    rateLimited,
    nextAfter: rateLimited ? resumeAfter : rows.length === limit && last ? `${last.receivedAt}|${last.id}` : null,
  }
}
