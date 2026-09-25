export type ProjectHandoffClientResolution = {
  readonly clientName: string | null
  readonly requiresReview: boolean
}

export function shouldPreserveReviewedPhaseHandoff(input: {
  readonly status: string
  readonly syncStatus: string
}): boolean {
  return (
    input.status === "open" ||
    ["queued_sage", "syncing", "failed", "synced"].includes(input.syncStatus)
  )
}

export type ExistingPhaseHandoffUpdatePolicy = {
  readonly preserveClientDecision: boolean
  readonly preserveSyncState: boolean
  readonly rejectWhileInFlight: boolean
}

export function existingPhaseHandoffUpdatePolicy(input: {
  readonly status: string
  readonly syncStatus: string
  readonly existingPayloadJson: string | null
  readonly incomingPayloadJson: string
}): ExistingPhaseHandoffUpdatePolicy {
  const payloadChanged = input.existingPayloadJson !== input.incomingPayloadJson
  const inFlight = ["queued_sage", "syncing"].includes(input.syncStatus)
  const preserveClientDecision = shouldPreserveReviewedPhaseHandoff(input)

  return {
    preserveClientDecision,
    preserveSyncState: preserveClientDecision && (!payloadChanged || inFlight),
    rejectWhileInFlight:
      preserveClientDecision && payloadChanged && inFlight,
  }
}

function cleanOptionalText(value: string | null): string | null {
  const cleaned = value?.trim() ?? ""
  return cleaned.length > 0 ? cleaned : null
}

export function resolveProjectHandoffClient(input: {
  readonly isPhase: boolean
  readonly submittedContactName: string | null
  readonly submittedCompanyName: string | null
  readonly existingClientName: string | null
  readonly baseProjectClientName: string | null
}): ProjectHandoffClientResolution {
  const submittedCompanyName = cleanOptionalText(input.submittedCompanyName)

  if (!input.isPhase) {
    return {
      clientName:
        submittedCompanyName ?? cleanOptionalText(input.submittedContactName),
      requiresReview: false,
    }
  }

  // A phased handoff's client comes from the project family, not from the
  // legacy Google contact-name field. Manual review is still required because
  // these older handoffs do not carry a canonical Compass customer ID.
  return {
    clientName:
      submittedCompanyName ??
      cleanOptionalText(input.baseProjectClientName) ??
      cleanOptionalText(input.existingClientName),
    requiresReview: true,
  }
}
