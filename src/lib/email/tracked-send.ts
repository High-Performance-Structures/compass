import "server-only"

import type { getDb } from "@/db"
import { sendCompassEmail, type CompassEmailDeliveryResult } from "@/lib/email/compass-email"
import type { CompassEmailAttachment } from "@/lib/email/mime-message"
import { appendReplyTokenHtml, appendReplyTokenText, createEmailReplyThread, replyMailboxEmail } from "@/lib/email/reply-tracking"
import { trackedRecordReplyTo, type TrackedRecordKind } from "@/lib/email/tracked-record-email"
import { resolveStaffEmailSender } from "@/lib/email/staff-sender"

/**
 * The one way Compass emails people outside the company about a record or a
 * job. It opens a reply thread for the record, sends from the staff member
 * (or the given department mailbox) with the tracked address first in Reply-To, and adds the
 * reply note to the message. Replies then come back through the inbox sync:
 * they land on the record, notify the sender and project staff, and are
 * logged in Activity. See docs/development/email-workflows.md.
 */
export async function sendTrackedEmail(input: {
  readonly env: unknown
  readonly db: ReturnType<typeof getDb>
  readonly organizationId: string
  readonly projectId: string
  readonly kind: TrackedRecordKind
  /** The record (or, for job-level emails, the project) replies belong to. */
  readonly recordId: string
  /** Shown in notifications and Activity, e.g. "RFQ-004" or a template name. */
  readonly recordLabel: string | null
  readonly createdBy: string
  readonly to: readonly string[]
  readonly cc?: readonly string[]
  readonly subject: string
  readonly text: string
  readonly html?: string
  readonly attachments?: readonly CompassEmailAttachment[]
  /** Department mailbox override. Otherwise resolve the staff member's mailbox. */
  readonly sender?: { readonly address: string; readonly name: string | null }
  /** Name on the tracked reply address, e.g. "Cassandra - RFQ-004". */
  readonly replyName: string
  /** Also listed in Reply-To so they still get replies directly. */
  readonly alsoReplyTo: readonly (string | null | undefined)[]
}): Promise<CompassEmailDeliveryResult> {
  const resolved = await resolveStaffEmailSender({
    env: input.env, db: input.db, organizationId: input.organizationId, userId: input.createdBy, departmentSender: input.sender,
  })
  if (!resolved.success) return { status: "failed", provider: "gmail", providerMessageId: null, error: resolved.error }
  const sender = resolved.sender
  const replyMailbox = replyMailboxEmail(input.env).toLowerCase()
  const thread = await createEmailReplyThread({
    env: input.env,
    db: input.db,
    organizationId: input.organizationId,
    projectId: input.projectId,
    sourceType: input.kind,
    sourceId: input.recordId,
    sourceNumber: input.recordLabel,
    subject: input.subject,
    createdBy: input.createdBy,
  })
  return sendCompassEmail({
    env: input.env,
    db: input.db,
    organizationId: input.organizationId,
    to: input.to,
    cc: input.cc ?? [],
    replyTo: trackedRecordReplyTo({
      replyToAddress: thread.replyToAddress,
      displayName: input.replyName,
      alsoTo: [
        ...(resolved.delivery === "gmail" ? [sender.address] : []),
        ...input.alsoReplyTo,
      ].filter((address) => {
        const email = address?.trim().toLowerCase()
        return email !== replyMailbox && !(resolved.delivery === "system" && email === sender.address.toLowerCase())
      }),
    }),
    headers: [{ name: "X-Compass-Reply-Token", value: thread.token }],
    subject: input.subject,
    text: appendReplyTokenText({ body: input.text, token: thread.token }),
    html: input.html === undefined ? undefined : appendReplyTokenHtml({ html: input.html, token: thread.token }),
    attachments: input.attachments,
    sender: resolved.delivery === "gmail" ? sender : undefined,
    fromName: resolved.delivery === "system" ? sender.name ?? undefined : undefined,
  })
}
