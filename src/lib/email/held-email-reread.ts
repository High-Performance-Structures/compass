import "server-only"

/**
 * Held emails read again from Gmail, read-only, with today's parser.
 *
 * Emails imported before Compass read the Cc and Delivered-To lines were
 * stored without the job's Compass address (jarvis+project-<id>@…) when that
 * address wasn't on the To line, and without Gmail's verdict on the sender.
 * Reading the message again recovers both, so the held-email backlog can
 * decide the job from the address and apply sender verification exactly as
 * live intake does. The message is fetched once per email and reused for its
 * files (heldEmailCandidate).
 */
import type { inboundEmails } from "@/db/schema"
import { saveRecoveredHeldEmailFields } from "@/lib/domain/correspondence/email-store"
import { COMPASS_GMAIL_READONLY_SCOPE, getCompassGmailAccessToken } from "@/lib/email/compass-email"
import { fetchGmailJson, GmailRateLimitError } from "@/lib/email/gmail-fetch"
import { candidateFromMessage, isGmailMessage, type GmailMessage } from "@/lib/email/gmail-message-parser"
import { projectIdFromInboundAddress } from "@/lib/email/project-address"
import { replyMailboxEmail } from "@/lib/email/reply-tracking"
import { isSenderAuthentication, type SenderAuthentication } from "@/lib/email/sender-authentication"
import type { Db } from "@/lib/server/action-context"

type StoredEmail = typeof inboundEmails.$inferSelect

/** A held email's Gmail message and the token that read it (reused for its files). */
export type HeldGmailMessage = { readonly message: GmailMessage; readonly accessToken: string }

/**
 * Reads a held email's message from the Compass mailbox. Null when Gmail
 * can't be reached or no longer has it. A Gmail rate limit is thrown
 * (GmailRateLimitError) so a batch stops instead of hitting Gmail again.
 * `tokens` caches one access token per company across a batch.
 */
export async function fetchHeldGmailMessage(input: {
  readonly db: Db
  readonly env: unknown
  readonly email: Pick<StoredEmail, "organizationId" | "gmailMessageId">
  readonly tokens?: Map<string, Promise<string | null>>
}): Promise<HeldGmailMessage | null> {
  const { organizationId, gmailMessageId } = input.email
  try {
    const token = input.tokens?.get(organizationId) ?? getCompassGmailAccessToken({
      env: input.env,
      db: input.db,
      organizationId,
      scopes: [COMPASS_GMAIL_READONLY_SCOPE],
      sender: replyMailboxEmail(input.env),
    }).then((access) => (access.success ? access.accessToken : null))
    input.tokens?.set(organizationId, token)
    const accessToken = await token
    if (!accessToken) return null
    const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(gmailMessageId)}`)
    url.searchParams.set("format", "full")
    const message = await fetchGmailJson({ url: url.toString(), accessToken })
    if (!isGmailMessage(message) || message.id !== gmailMessageId) return null
    return { message, accessToken }
  } catch (error) {
    if (error instanceof GmailRateLimitError) throw error
    console.error("[held-email-reread] could not read the email from Gmail", error)
    return null
  }
}

export type RecoveredHeldEmailFields = {
  readonly toAddress: string | null
  readonly senderAuthentication: SenderAuthentication | null
  /** The job's Compass address was missing from the stored row and found in Gmail. */
  readonly projectAddressRecovered: boolean
}

/**
 * Pure: the To address and sender verdict today's parser reads from the
 * message. The stored To address is kept unless it lacks a job address and
 * the message has one (on To, Cc, X-Original-To or Delivered-To), so an
 * email already addressed to a job never moves to another.
 */
export function recoveredHeldEmailFields(
  stored: Pick<StoredEmail, "toAddress" | "senderAuthentication">,
  message: GmailMessage,
): RecoveredHeldEmailFields {
  const parsed = candidateFromMessage(message)
  const projectAddressRecovered = projectIdFromInboundAddress(stored.toAddress) === null && projectIdFromInboundAddress(parsed.toAddress) !== null
  return {
    toAddress: projectAddressRecovered ? parsed.toAddress : stored.toAddress,
    senderAuthentication: parsed.senderAuthentication ?? (isSenderAuthentication(stored.senderAuthentication) ? stored.senderAuthentication : null),
    projectAddressRecovered,
  }
}

/**
 * Saves the recovered fields on a row still held, so the Message Desk shows
 * them (guarded in saveRecoveredHeldEmailFields). Returns the row to route
 * with: the recovered fields, whether or not the save won a race.
 */
export async function applyRecoveredHeldEmailFields(db: Db, email: StoredEmail, recovered: RecoveredHeldEmailFields): Promise<StoredEmail> {
  const fillVerdict = email.senderAuthentication === null && recovered.senderAuthentication !== null
  if (!recovered.projectAddressRecovered && !fillVerdict) return email
  const changes = {
    ...(recovered.projectAddressRecovered ? { toAddress: recovered.toAddress } : {}),
    ...(fillVerdict && recovered.senderAuthentication ? { senderAuthentication: recovered.senderAuthentication } : {}),
  }
  await saveRecoveredHeldEmailFields(db, email, changes)
  return { ...email, ...changes }
}
