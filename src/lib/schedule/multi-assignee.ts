export type ScheduleAssigneeResponse = "confirmed" | "declined" | "proposed"

export type ScheduleAssigneeAudience = "internal" | "owner" | "sub_vendor"

export type ScheduleAssigneeProposalInput = {
  readonly response: ScheduleAssigneeResponse
  readonly proposedStartDate?: string | null
  readonly proposedWorkdays?: number | null
  readonly message?: string | null
}

export type ScheduleAssigneeResponseState = {
  readonly responseStatus: ScheduleAssigneeResponse
  readonly dateResponseStatus: "confirmed" | "declined" | "proposed" | "pending"
  readonly durationResponseStatus:
    | "confirmed"
    | "declined"
    | "proposed"
    | "pending"
}

/** Compare publication metadata without exposing or depending on ordering. */
export function sameScheduleAssigneeSet(
  current: readonly string[],
  published: readonly string[],
): boolean {
  if (current.length !== published.length) return false
  const currentIds = [...current].sort()
  const publishedIds = [...published].sort()
  return currentIds.every((participantId, index) => participantId === publishedIds[index])
}

/** Keep responses inside the audience visibility frozen at publication. */
export function isPublishedScheduleVisibleToAssignee(input: {
  readonly audience: ScheduleAssigneeAudience
  readonly ownerVisible: boolean | undefined
  readonly subVendorVisible: boolean | undefined
  readonly hasExplicitPartnerSelection: boolean
}): boolean {
  if (input.audience === "owner") return input.ownerVisible !== false
  if (input.audience === "sub_vendor") {
    return input.hasExplicitPartnerSelection
      ? input.subVendorVisible === true
      : input.ownerVisible !== false
  }
  return true
}

function isValidDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

/** Calculate independent date/duration state without mutating the task. */
export function scheduleAssigneeResponseState(
  input: ScheduleAssigneeProposalInput,
): ScheduleAssigneeResponseState | { readonly error: string } {
  const hasDate = Boolean(input.proposedStartDate?.trim())
  const hasDuration = input.proposedWorkdays !== null &&
    input.proposedWorkdays !== undefined

  if (input.response === "proposed" && !hasDate && !hasDuration) {
    return { error: "Provide a proposed start date or duration." }
  }
  if (hasDate && !isValidDateKey(input.proposedStartDate?.trim() ?? "")) {
    return { error: "Choose a valid proposed start date." }
  }
  if (hasDuration && (!Number.isInteger(input.proposedWorkdays) ||
      Number(input.proposedWorkdays) < 1 || Number(input.proposedWorkdays) > 3650)) {
    return { error: "Proposed workdays must be between 1 and 3650." }
  }
  if (input.message && input.message.length > 2000) {
    return { error: "Response message must be 2000 characters or less." }
  }

  if (input.response === "confirmed" || input.response === "declined") {
    return {
      responseStatus: input.response,
      dateResponseStatus: input.response,
      durationResponseStatus: input.response,
    }
  }
  return {
    responseStatus: "proposed",
    dateResponseStatus: hasDate ? "proposed" : "pending",
    durationResponseStatus: hasDuration ? "proposed" : "pending",
  }
}

export type ImportedScheduleAssignee = {
  readonly sourceParticipantId: string | null
  readonly rawName: string | null
}

export type CanonicalScheduleAssignee = {
  readonly sourceParticipantId: string
  readonly participantId: string
}

export type ScheduleAssigneeResolution = {
  readonly matched: readonly CanonicalScheduleAssignee[]
  readonly unmatchedRawNames: readonly string[]
}

/**
 * Resolve only exact source identities. A display-name match is deliberately
 * not enough: unresolved names stay review data and never become assignments.
 */
export function resolveImportedScheduleAssignees(input: {
  readonly imported: readonly ImportedScheduleAssignee[]
  readonly canonical: readonly CanonicalScheduleAssignee[]
}): ScheduleAssigneeResolution {
  const canonical = new Map(
    input.canonical.map((entry) => [entry.sourceParticipantId, entry]),
  )
  const matched: CanonicalScheduleAssignee[] = []
  const unmatchedRawNames: string[] = []
  const seen = new Set<string>()
  for (const entry of input.imported) {
    const sourceId = entry.sourceParticipantId?.trim() ?? ""
    const resolved = sourceId ? canonical.get(sourceId) : undefined
    if (resolved && !seen.has(resolved.participantId)) {
      matched.push(resolved)
      seen.add(resolved.participantId)
    } else if (!resolved && entry.rawName?.trim()) {
      unmatchedRawNames.push(entry.rawName.trim())
    }
  }
  return { matched, unmatchedRawNames }
}
