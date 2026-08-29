/** Capabilities are intentionally action-specific: a read grant never implies a write. */
export const PARTICIPANT_CAPABILITIES = {
  messageView: "message.view",
  messageReply: "message.reply",
  purchaseOrderView: "purchase_order.view",
  purchaseOrderRespond: "purchase_order.respond",
  todoView: "todo.view",
  todoComment: "todo.comment",
  todoComplete: "todo.complete",
  rfiView: "rfi.view",
  rfiRespond: "rfi.respond",
  rfiApprove: "rfi.approve",
  rfqView: "rfq.view",
  rfqRespond: "rfq.respond",
  rfqApprove: "rfq.approve",
  scheduleView: "schedule.view",
  scheduleRespond: "schedule.respond",
} as const

export type ParticipantCapability =
  (typeof PARTICIPANT_CAPABILITIES)[keyof typeof PARTICIPANT_CAPABILITIES]

export type ParticipantAccessRecord = {
  readonly reviewStatus: string
  readonly active: boolean
  readonly identityStatus: string
  readonly membershipStatus: string
  readonly capabilitiesJson: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function capabilitySet(capabilitiesJson: string | null): ReadonlySet<string> {
  if (capabilitiesJson === null || capabilitiesJson.trim().length === 0) {
    return new Set<string>()
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(capabilitiesJson)
  } catch {
    return new Set<string>()
  }

  if (Array.isArray(parsed)) {
    return new Set(
      parsed.filter(
        (capability): capability is string =>
          typeof capability === "string" && capability.trim().length > 0,
      ),
    )
  }

  if (isRecord(parsed)) {
    return new Set(
      Object.entries(parsed).flatMap(([capability, granted]) =>
        granted === true ? [capability] : [],
      ),
    )
  }

  return new Set<string>()
}

/** Every gate is required; an absent, unknown, or conflicting state denies access. */
export function isReviewedActiveParticipant(
  participant: ParticipantAccessRecord,
): boolean {
  return (
    participant.reviewStatus === "reviewed" &&
    participant.active &&
    participant.identityStatus === "matched" &&
    participant.membershipStatus === "active"
  )
}

export function hasParticipantCapability(
  participant: ParticipantAccessRecord,
  capability: string,
): boolean {
  if (!isReviewedActiveParticipant(participant)) return false
  // Exact membership is deliberate: wildcards and parent capabilities cannot escalate.
  return capabilitySet(participant.capabilitiesJson).has(capability)
}

export function canParticipantPerform(
  participant: ParticipantAccessRecord,
  capability: ParticipantCapability,
): boolean {
  return hasParticipantCapability(participant, capability)
}

export function canViewMessage(participant: ParticipantAccessRecord): boolean {
  return canParticipantPerform(participant, PARTICIPANT_CAPABILITIES.messageView)
}

export function canReplyToMessage(participant: ParticipantAccessRecord): boolean {
  return canParticipantPerform(participant, PARTICIPANT_CAPABILITIES.messageReply)
}

export function canViewPurchaseOrder(
  participant: ParticipantAccessRecord,
): boolean {
  return canParticipantPerform(
    participant,
    PARTICIPANT_CAPABILITIES.purchaseOrderView,
  )
}

export function canRespondToPurchaseOrder(
  participant: ParticipantAccessRecord,
): boolean {
  return canParticipantPerform(
    participant,
    PARTICIPANT_CAPABILITIES.purchaseOrderRespond,
  )
}

export function canViewTodo(participant: ParticipantAccessRecord): boolean {
  return canParticipantPerform(participant, PARTICIPANT_CAPABILITIES.todoView)
}

export function canCommentOnTodo(participant: ParticipantAccessRecord): boolean {
  return canParticipantPerform(participant, PARTICIPANT_CAPABILITIES.todoComment)
}

export function canCompleteTodo(participant: ParticipantAccessRecord): boolean {
  return canParticipantPerform(participant, PARTICIPANT_CAPABILITIES.todoComplete)
}

export function canViewRfi(participant: ParticipantAccessRecord): boolean {
  return canParticipantPerform(participant, PARTICIPANT_CAPABILITIES.rfiView)
}

export function canRespondToRfi(participant: ParticipantAccessRecord): boolean {
  return canParticipantPerform(participant, PARTICIPANT_CAPABILITIES.rfiRespond)
}

export function canApproveRfi(participant: ParticipantAccessRecord): boolean {
  return canParticipantPerform(participant, PARTICIPANT_CAPABILITIES.rfiApprove)
}

export function canViewRfq(participant: ParticipantAccessRecord): boolean {
  return canParticipantPerform(participant, PARTICIPANT_CAPABILITIES.rfqView)
}

export function canRespondToRfq(participant: ParticipantAccessRecord): boolean {
  return canParticipantPerform(participant, PARTICIPANT_CAPABILITIES.rfqRespond)
}

export function canApproveRfq(participant: ParticipantAccessRecord): boolean {
  return canParticipantPerform(participant, PARTICIPANT_CAPABILITIES.rfqApprove)
}

export function canViewSchedule(participant: ParticipantAccessRecord): boolean {
  return canParticipantPerform(participant, PARTICIPANT_CAPABILITIES.scheduleView)
}

export function canRespondToSchedule(
  participant: ParticipantAccessRecord,
): boolean {
  return canParticipantPerform(
    participant,
    PARTICIPANT_CAPABILITIES.scheduleRespond,
  )
}
