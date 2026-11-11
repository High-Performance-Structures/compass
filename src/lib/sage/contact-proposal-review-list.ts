/**
 * What the Sage contact review list shows for each change request, in plain
 * words. The list holds only requests someone still has to act on, plus a
 * small "Sending to Sage…" line for approved ones on their way. Finished
 * requests (written, rejected, replaced) leave the list; their history stays
 * in Activity and the request's own events.
 */

/** Statuses the review list loads. */
export const SAGE_REVIEW_LIST_STATUSES = ["pending", "conflict", "failed", "approved", "running"] as const

export type SageReviewListStatus = (typeof SAGE_REVIEW_LIST_STATUSES)[number]

export type SageReviewState =
  /** Waiting for someone to approve or reject. */
  | { readonly stage: "decide"; readonly label: "Waiting for approval" }
  /** Sage did not take it as approved; reapply or reject. */
  | { readonly stage: "fix"; readonly label: "Needs attention" }
  /** Approved; Compass is checking Sage and the writer sends it. */
  | { readonly stage: "sending"; readonly label: "Sending to Sage…" }

export function isSageReviewListStatus(status: string): status is SageReviewListStatus {
  return SAGE_REVIEW_LIST_STATUSES.some((known) => known === status)
}

/** The list state for a status, or null when the request is finished and leaves the list. */
export function sageReviewState(status: string): SageReviewState | null {
  if (status === "pending") return { stage: "decide", label: "Waiting for approval" }
  if (status === "conflict" || status === "failed") return { stage: "fix", label: "Needs attention" }
  if (status === "approved" || status === "running") return { stage: "sending", label: "Sending to Sage…" }
  return null
}

const STAGE_ORDER: Readonly<Record<SageReviewState["stage"], number>> = { decide: 0, fix: 1, sending: 2 }

/** Requests needing a decision first, then problems, then those on their way; newest first within each. */
export function sortForSageReview<T extends { readonly state: SageReviewState; readonly requestedAt: string }>(
  items: readonly T[]
): T[] {
  return [...items].sort((left, right) =>
    STAGE_ORDER[left.state.stage] - STAGE_ORDER[right.state.stage] ||
    right.requestedAt.localeCompare(left.requestedAt))
}

const KIND_LABELS: Readonly<Record<string, string>> = {
  client_company: "Client", client_person: "Client contact",
  vendor_company: "Vendor", vendor_person: "Vendor contact", employee: "Employee",
}

export function sageContactKindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? "Contact"
}

/** Messages older Compass versions stored, in the words staff should see. */
const LEGACY_MESSAGES: Readonly<Record<string, string>> = {
  "Sage snapshot changed or expired before bridge claim":
    "Compass's read of Sage was too old when the Sage writer picked this up, so nothing was written. Reapply to check Sage again and send it.",
  "Sage read-back differs from approved changes":
    "The Sage writer ran, but Sage does not show the requested values. Check the record in Sage, then reapply or reject.",
  "Sage contact changed since the approved snapshot; no write attempted.":
    "Sage changed this record after Compass read it, so nothing was written. Reapply to check Sage again.",
  "Approved before-value differs from Sage; no write attempted.":
    "Sage now holds a different value than when this was requested, so nothing was written. Reapply to send it over Sage's current value, or reject.",
}

/** The problem text for a request that needs attention, in plain English. */
export function plainSageProblem(errorMessage: string | null): string | null {
  if (!errorMessage) return null
  return LEGACY_MESSAGES[errorMessage] ?? errorMessage
}

/** "Avery Office", else the email, for "Requested … by <name>". */
export function sageRequesterName(person: {
  readonly displayName: string | null
  readonly firstName: string | null
  readonly lastName: string | null
  readonly email: string | null
} | null): string {
  if (!person) return "a former user"
  const full = [person.firstName, person.lastName].filter((part) => part?.trim()).join(" ")
  return person.displayName?.trim() || full || person.email || "a former user"
}
