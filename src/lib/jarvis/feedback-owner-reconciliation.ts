type FeedbackOwnerRejectionReason =
  | "missing_source_evidence"
  | "source_scope_mismatch"
  | "source_missing_identity"
  | "source_disagreement"
  | "missing_account"
  | "inactive_account"
  | "missing_membership"
  | "cross_org_membership"
  | "inactive_organization"
  | "account_identity_mismatch"
  | "invalid_metadata"
  | "existing_identity_mismatch"

export type FeedbackOwnerSourceEvent = Readonly<{
  id: string
  organizationId: string | null
  feedbackDeskItemId: string | null
  direction: string
  source: string
  eventType: string
  payload: string
}>

export type FeedbackOwnerAccount = Readonly<{
  id: string
  email: string
  googleEmail: string | null
  isActive: boolean
  organizationId: string | null
  organizationIsActive: boolean
  membershipExists: boolean
}>

type FeedbackOwnerItem = Readonly<{
  id: string
  organizationId: string | null
  reporterEmail: string | null
  metadata: string | null
}>

export type HistoricalFeedbackOwnerResolution =
  | Readonly<{
      kind: "repair"
      userId: string
      reporterEmail: string
      metadata: string
      sourceEventCount: number
    }>
  | Readonly<{ kind: "noop" }>
  | Readonly<{
      kind: "reject"
      reason: FeedbackOwnerRejectionReason
    }>

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null
}

function stringValue(
  record: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = record?.[key]
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}

function normalizedEmail(value: string | null): string | null {
  const normalized = value?.trim().toLowerCase() ?? ""
  return normalized.length > 0 ? normalized : null
}

function parseMetadata(
  metadata: string | null,
): Record<string, unknown> | null {
  if (metadata === null) return {}
  try {
    return objectValue(JSON.parse(metadata))
  } catch {
    return null
  }
}

export function feedbackOwnerIdentityFromPayload(
  payload: string,
): Readonly<{ userId: string; email: string }> | null {
  try {
    const user = objectValue(objectValue(JSON.parse(payload))?.user)
    const userId = stringValue(user, "id")
    const email = normalizedEmail(stringValue(user, "email"))
    return userId && email ? { userId, email } : null
  } catch {
    return null
  }
}

function reject(
  reason: FeedbackOwnerRejectionReason,
): HistoricalFeedbackOwnerResolution {
  return { kind: "reject", reason }
}

export function resolveHistoricalFeedbackOwner(input: Readonly<{
  item: FeedbackOwnerItem
  sourceEvents: readonly FeedbackOwnerSourceEvent[]
  account: FeedbackOwnerAccount | null
}>): HistoricalFeedbackOwnerResolution {
  const { item, sourceEvents, account } = input
  if (!item.organizationId || sourceEvents.length === 0) {
    return reject("missing_source_evidence")
  }
  if (sourceEvents.some((event) =>
    event.organizationId !== item.organizationId ||
    event.direction !== "outbound" ||
    event.source !== "ask-jarvis" ||
    event.eventType !== "agent.prompt" ||
    (event.feedbackDeskItemId !== null && event.feedbackDeskItemId !== item.id)
  )) {
    return reject("source_scope_mismatch")
  }

  const identities = sourceEvents.map((event) =>
    feedbackOwnerIdentityFromPayload(event.payload),
  )
  if (identities.some((identity) => identity === null)) {
    return reject("source_missing_identity")
  }
  const firstIdentity = identities[0]
  if (!firstIdentity || identities.some((identity) =>
    identity?.userId !== firstIdentity.userId || identity.email !== firstIdentity.email
  )) {
    return reject("source_disagreement")
  }

  if (!account) return reject("missing_account")
  if (!account.isActive) return reject("inactive_account")
  if (!account.membershipExists) return reject("missing_membership")
  if (
    account.organizationId !== item.organizationId ||
    !account.organizationIsActive
  ) {
    return reject(
      account.organizationId === item.organizationId
        ? "inactive_organization"
        : "cross_org_membership",
    )
  }

  const accountEmail = normalizedEmail(account.email)
  const googleEmail = normalizedEmail(account.googleEmail)
  if (
    account.id !== firstIdentity.userId ||
    !accountEmail ||
    (firstIdentity.email !== accountEmail && firstIdentity.email !== googleEmail)
  ) {
    return reject("account_identity_mismatch")
  }

  const metadata = parseMetadata(item.metadata)
  if (!metadata) return reject("invalid_metadata")
  const existingActorId = stringValue(metadata, "externalActorId")
  const existingEmail = normalizedEmail(item.reporterEmail)
  const emailMatches = existingEmail === null ||
    existingEmail === accountEmail ||
    existingEmail === googleEmail
  if (
    (existingActorId !== null && existingActorId !== account.id) ||
    !emailMatches
  ) {
    return reject("existing_identity_mismatch")
  }
  if (existingActorId === account.id && existingEmail !== null) {
    return { kind: "noop" }
  }

  return {
    kind: "repair",
    userId: account.id,
    reporterEmail: accountEmail,
    metadata: JSON.stringify({ ...metadata, externalActorId: account.id }),
    sourceEventCount: sourceEvents.length,
  }
}
