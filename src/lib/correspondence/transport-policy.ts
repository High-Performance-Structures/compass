/**
 * Provider adapters resolve the evidence below before this policy runs. Keeping
 * the decision pure makes it possible to apply the same access boundary to
 * polling, webhooks, and future transport providers.
 */
export type CorrespondenceTransport = "email" | "sms"

export type CorrespondenceInboundTarget = {
  readonly organizationId: string
  readonly projectId: string
  readonly conversationId: string
}

export type CorrespondenceInboundInput = {
  readonly transport: CorrespondenceTransport
  readonly providerEventId: string
  /** The adapter authenticated the provider callback or provider API response. */
  readonly providerAuthenticated: boolean
  /**
   * The caller must claim this key in durable storage before message creation.
   * A duplicate never runs the downstream correspondence write a second time.
   */
  readonly deduplication: "claimed" | "duplicate"
  readonly target: CorrespondenceInboundTarget | null
  readonly sender: {
    readonly identifier: string
    readonly authorization:
      | "authorized_participant"
      | "unknown"
      | "forwarded"
  }
  readonly isAutomatedResponse: boolean
  readonly isDeliveryLoop: boolean
  readonly attachments: "ready" | "held"
  readonly email: {
    readonly isReply: boolean
    readonly token: "matched" | "missing" | "invalid"
    readonly replyHeaders: "matched" | "missing" | "conflicting"
  } | null
}

export type CorrespondenceInboundDecision =
  | {
      readonly kind: "accepted"
      readonly target: CorrespondenceInboundTarget
      /** Accepted means durable correspondence persistence may now begin. */
      readonly persistence: "accepted"
    }
  | {
      readonly kind: "held"
      readonly reason:
        | "attachment_review"
        | "forwarded_sender"
        | "missing_reply_evidence"
        | "sender_not_authorized"
        | "unproven_project"
    }
  | {
      readonly kind: "suppressed"
      readonly reason: "automated_response" | "delivery_loop" | "duplicate"
    }
  | {
      readonly kind: "rejected"
      readonly reason: "provider_not_authenticated" | "missing_provider_event_id"
    }

function hasTarget(target: CorrespondenceInboundTarget | null): target is CorrespondenceInboundTarget {
  return Boolean(
    target &&
      target.organizationId.trim() &&
      target.projectId.trim() &&
      target.conversationId.trim()
  )
}

/**
 * Decides whether one provider event can enter an existing correspondence.
 * A token or a forwarding recipient never creates access for a new sender.
 */
export function decideCorrespondenceInbound(
  input: CorrespondenceInboundInput
): CorrespondenceInboundDecision {
  if (input.providerEventId.trim().length === 0) {
    return { kind: "rejected", reason: "missing_provider_event_id" }
  }
  if (!input.providerAuthenticated) {
    return { kind: "rejected", reason: "provider_not_authenticated" }
  }
  if (input.deduplication === "duplicate") {
    return { kind: "suppressed", reason: "duplicate" }
  }
  if (input.isDeliveryLoop) {
    return { kind: "suppressed", reason: "delivery_loop" }
  }
  if (input.isAutomatedResponse) {
    return { kind: "suppressed", reason: "automated_response" }
  }
  if (!hasTarget(input.target)) {
    return { kind: "held", reason: "unproven_project" }
  }
  if (input.sender.authorization === "forwarded") {
    return { kind: "held", reason: "forwarded_sender" }
  }
  if (input.sender.authorization !== "authorized_participant") {
    return { kind: "held", reason: "sender_not_authorized" }
  }
  if (input.transport === "email") {
    const email = input.email
    if (
      !email ||
      !email.isReply ||
      email.token !== "matched" ||
      email.replyHeaders !== "matched"
    ) {
      return { kind: "held", reason: "missing_reply_evidence" }
    }
  }
  if (input.attachments === "held") {
    return { kind: "held", reason: "attachment_review" }
  }
  return { kind: "accepted", target: input.target, persistence: "accepted" }
}

/**
 * These are transport facts, not read receipts. `accepted` is a provider API
 * acknowledgement; only a provider delivery event can advance to `delivered`.
 */
export type CorrespondenceDeliveryState =
  | "queued"
  | "accepted"
  | "delivered"
  | "failed"

export type CorrespondenceDeliveryEvidence =
  | "outbox_persisted"
  | "provider_accepted"
  | "provider_delivered"
  | "provider_failed"

export type CorrespondenceDeliveryTransition =
  | { readonly kind: "advanced"; readonly state: CorrespondenceDeliveryState }
  | {
      readonly kind: "ignored"
      readonly state: CorrespondenceDeliveryState
      readonly reason: "stale_evidence" | "terminal_state"
    }

export function transitionCorrespondenceDelivery(
  current: CorrespondenceDeliveryState | null,
  evidence: CorrespondenceDeliveryEvidence
): CorrespondenceDeliveryTransition {
  if (current === "delivered") {
    return { kind: "ignored", state: current, reason: "terminal_state" }
  }
  // Delivery callbacks can arrive before (or after) a separate acceptance
  // callback. Delivery is the strongest provider fact and must not be lost.
  if (evidence === "provider_delivered") {
    return { kind: "advanced", state: "delivered" }
  }
  if (current === "failed") {
    return { kind: "ignored", state: current, reason: "terminal_state" }
  }
  if (evidence === "outbox_persisted") {
    if (current === "accepted") {
      return { kind: "ignored", state: current, reason: "stale_evidence" }
    }
    return { kind: "advanced", state: "queued" }
  }
  if (evidence === "provider_accepted") {
    return { kind: "advanced", state: "accepted" }
  }
  if (evidence === "provider_failed") {
    return { kind: "advanced", state: "failed" }
  }
  return { kind: "advanced", state: "delivered" }
}
