import type { CorrespondenceInboxFilter, CorrespondenceSummary } from "@/lib/correspondence/types"

/*
 * A project's Messages inbox on the shared record table: pure helpers for
 * the sheet's cells, sort values and status chips (ui-standards.md
 * "Record lists"). Safe in the browser.
 */

export type ConversationType = "email" | "message"

export type ConversationStatusChip = "Unread" | "Needs reply" | "Saved" | "Archived" | "Closed"

/** Email threads (sent from Compass as project email) vs. portal messages. */
export function conversationType(conversation: CorrespondenceSummary): ConversationType {
  return conversation.kind === "email" ? "email" : "message"
}

export function conversationTypeLabel(conversation: CorrespondenceSummary): string {
  return conversationType(conversation) === "email" ? "Email" : "Message"
}

/** The people in the conversation, as the With column shows them. */
export function conversationWith(conversation: CorrespondenceSummary): string {
  return conversation.people.map((person) => person.name).join(", ")
}

/** The one-line excerpt under the subject; Sent shows what the viewer last sent. */
export function conversationExcerpt(conversation: CorrespondenceSummary, filter: CorrespondenceInboxFilter): string {
  return filter === "sent" ? conversation.lastSentExcerpt ?? conversation.excerpt : conversation.excerpt
}

/** The Last activity timestamp; Sent uses when the viewer last sent. */
export function conversationActivityAt(conversation: CorrespondenceSummary, filter: CorrespondenceInboxFilter): string {
  return filter === "sent" ? conversation.lastSentAt ?? conversation.lastActivityAt : conversation.lastActivityAt
}

/** Last activity as a typed value (epoch ms), so it never sorts by display text. */
export function conversationActivitySortValue(
  conversation: CorrespondenceSummary,
  filter: CorrespondenceInboxFilter,
): number | undefined {
  const time = new Date(conversationActivityAt(conversation, filter)).valueOf()
  return Number.isNaN(time) ? undefined : time
}

/** Status chips in display order. */
export function conversationStatusChips(conversation: CorrespondenceSummary): readonly ConversationStatusChip[] {
  const chips: ConversationStatusChip[] = []
  if (conversation.unread) chips.push("Unread")
  if (conversation.followUp) chips.push("Needs reply")
  if (conversation.saved) chips.push("Saved")
  if (conversation.archived) chips.push("Archived")
  if (conversation.closed) chips.push("Closed")
  return chips
}

/**
 * Status sorts by weight: unread, then needs reply, then saved; conversations
 * with no flags sort last (undefined).
 */
export function conversationStatusSortValue(conversation: CorrespondenceSummary): number | undefined {
  const weight = (conversation.unread ? 4 : 0) + (conversation.followUp ? 2 : 0) + (conversation.saved ? 1 : 0)
  return weight === 0 ? undefined : weight
}
