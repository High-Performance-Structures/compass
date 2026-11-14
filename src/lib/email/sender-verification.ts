import "server-only"

import type { getDb } from "@/db"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import type { EmailSenderVerificationMode } from "@/lib/feature-settings/email-sender-verification-settings"
import { stripHtml, type InboundCandidate } from "@/lib/email/gmail-message-parser"

/*
 * Email sender verification (Settings > Workflows): a job email from a staff
 * member's or contact's address is trusted only when Gmail confirmed it came
 * from that address's domain, if the company enforces it. "Record only"
 * notes the result in Activity and changes nothing, so a company can check
 * its staff and regular vendors pass before enforcing.
 */

type Db = ReturnType<typeof getDb>

export const UNVERIFIED_SENDER_NOTE =
  "Note from Compass: Gmail couldn't confirm this email came from the sender's address, so its subject tags and @names were ignored."

export type SenderVerificationResult = {
  /** Subject tags create records and @names notify. */
  readonly senderAuthorized: boolean
  /** The email to post: with a note when an unverified known sender's tags were ignored. */
  readonly candidate: InboundCandidate
  /** For the routing Activity event. */
  readonly metadata: {
    readonly senderRecognized: boolean
    readonly senderAuthentication: string
    readonly senderVerification: EmailSenderVerificationMode
  }
}

function withUnverifiedSenderNote(candidate: InboundCandidate): InboundCandidate {
  const body = candidate.textBody?.trim() || (candidate.htmlBody ? stripHtml(candidate.htmlBody) : "") || candidate.snippet?.trim() || "(No message body.)"
  return { ...candidate, textBody: `${body}\n\n${UNVERIFIED_SENDER_NOTE}` }
}

/**
 * `recognized`: the From address is a staff member's or one of the job's
 * contacts'. Emails stored before Compass read Gmail's verdict count as
 * unverified once the company enforces.
 */
export async function applySenderVerification(input: {
  readonly db: Db
  readonly organizationId: string
  readonly candidate: InboundCandidate
  readonly recognized: boolean
}): Promise<SenderVerificationResult> {
  const { mode } = await readFeatureSettings(input.db, input.organizationId, "email-sender-verification")
  const authentication = input.candidate.senderAuthentication ?? "unknown"
  const metadata = { senderRecognized: input.recognized, senderAuthentication: authentication, senderVerification: mode }
  if (!input.recognized) return { senderAuthorized: false, candidate: input.candidate, metadata }
  if (mode !== "enforce" || authentication === "pass") return { senderAuthorized: true, candidate: input.candidate, metadata }
  return { senderAuthorized: false, candidate: withUnverifiedSenderNote(input.candidate), metadata }
}
