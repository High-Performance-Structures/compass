/**
 * Why Compass held a job email for a person to check, in plain words for the
 * Staff Message Desk. Pure: no database or network.
 *
 * Every hold writes one `project_email.needs_review` Activity row whose
 * metadata says what went wrong. Newer rows carry `heldReason` (set by
 * routeInboundProjectMessage); older rows only carry `senderAuthorized`,
 * `subjectTagged` or `destination`, so the reason is read from those.
 */
import { isRecord } from "@/lib/shared/guards"

import { inboundMessageMentionsSomeone } from "./project-message-mentions"

/** Why a job message could not be posted on its own (routeInboundProjectMessage). */
const HELD_MESSAGE_REASONS = ["messaging_off", "mention_unmatched", "no_recipients", "attachment_failed"] as const
export type HeldMessageReason = (typeof HELD_MESSAGE_REASONS)[number]

const HELD_EMAIL_REASONS = [
  ...HELD_MESSAGE_REASONS,
  "sender_unrecognized",
  "no_destination",
  "no_job",
  "message_not_posted",
  "other",
] as const
type HeldEmailReason = (typeof HELD_EMAIL_REASONS)[number]

const HELD_EMAIL_REASON_LABEL: Readonly<Record<HeldEmailReason, string>> = {
  messaging_off: "Job messages aren't turned on for this job",
  mention_unmatched: "An @name couldn't be matched",
  no_recipients: "No one to notify on this job",
  attachment_failed: "An attachment couldn't be saved",
  sender_unrecognized: "Sender isn't a contact on this job",
  no_destination: "No subject tag to say where it goes",
  no_job: "Compass couldn't tell which job it's for",
  message_not_posted: "Couldn't post to job messages: no one to notify, or an attachment couldn't be saved",
  other: "Compass couldn't post it on its own",
}

export function heldMessageReasonLabel(reason: HeldMessageReason): string {
  return HELD_EMAIL_REASON_LABEL[reason]
}

function isHeldMessageReason(value: unknown): value is HeldMessageReason {
  return HELD_MESSAGE_REASONS.some((reason) => reason === value)
}

function parsedMetadata(value: string | null): Readonly<Record<string, unknown>> {
  if (!value) return {}
  try {
    const parsed: unknown = JSON.parse(value)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export type HeldEmailReasonView = { readonly code: HeldEmailReason; readonly label: string }

function view(code: HeldEmailReason): HeldEmailReasonView {
  return { code, label: HELD_EMAIL_REASON_LABEL[code] }
}

/**
 * The reason to show for one held email.
 * - `activityMetadata`: the hold's Activity metadata JSON, or null when no
 *   Activity row was written (an email that matched no job).
 * - `text`: the email's subject and body, used for older holds that only
 *   said "message routing failed", to tell an unmatched @name apart.
 */
export function heldEmailReason(input: {
  readonly hasActivity: boolean
  readonly activityMetadata: string | null
  readonly projectId: string | null
  readonly text: string
}): HeldEmailReasonView {
  if (!input.hasActivity) return view(input.projectId ? "other" : "no_job")
  const metadata = parsedMetadata(input.activityMetadata)
  if (isHeldMessageReason(metadata.heldReason)) return view(metadata.heldReason)
  if (metadata.senderAuthorized === false) return view("sender_unrecognized")
  if (metadata.subjectTagged === false) return view("no_destination")
  if (metadata.destination === "message") {
    return view(inboundMessageMentionsSomeone(input.text) ? "mention_unmatched" : "message_not_posted")
  }
  return view("other")
}
