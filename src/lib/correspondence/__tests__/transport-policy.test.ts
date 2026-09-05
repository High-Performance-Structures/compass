import { describe, expect, it } from "vitest"

import {
  decideCorrespondenceInbound,
  transitionCorrespondenceDelivery,
  type CorrespondenceInboundInput,
} from "@/lib/correspondence/transport-policy"

function inbound(
  overrides: Partial<CorrespondenceInboundInput> = {}
): CorrespondenceInboundInput {
  return {
    transport: "email",
    providerEventId: "gmail-message-1",
    providerAuthenticated: true,
    deduplication: "claimed",
    target: {
      organizationId: "organization-1",
      projectId: "project-1",
      conversationId: "conversation-1",
    },
    sender: {
      identifier: "owner@example.com",
      authorization: "authorized_participant",
    },
    isAutomatedResponse: false,
    isDeliveryLoop: false,
    attachments: "ready",
    email: {
      isReply: true,
      token: "matched",
      replyHeaders: "matched",
    },
    ...overrides,
  }
}

describe("correspondence inbound transport policy", () => {
  it("accepts only a provider-authenticated, deduplicated, authorized email reply", () => {
    expect(decideCorrespondenceInbound(inbound())).toEqual({
      kind: "accepted",
      target: {
        organizationId: "organization-1",
        projectId: "project-1",
        conversationId: "conversation-1",
      },
      persistence: "accepted",
    })
  })

  it("rejects unauthenticated provider input before sender or routing checks", () => {
    expect(
      decideCorrespondenceInbound(inbound({ providerAuthenticated: false }))
    ).toEqual({ kind: "rejected", reason: "provider_not_authenticated" })
  })

  it("suppresses duplicate provider callbacks after their durable claim", () => {
    expect(
      decideCorrespondenceInbound(inbound({ deduplication: "duplicate" }))
    ).toEqual({ kind: "suppressed", reason: "duplicate" })
  })

  it("holds an unknown or forwarded sender even with a valid reply token", () => {
    expect(
      decideCorrespondenceInbound(
        inbound({
          sender: { identifier: "new@example.com", authorization: "unknown" },
        })
      )
    ).toEqual({ kind: "held", reason: "sender_not_authorized" })
    expect(
      decideCorrespondenceInbound(
        inbound({
          sender: { identifier: "new@example.com", authorization: "forwarded" },
        })
      )
    ).toEqual({ kind: "held", reason: "forwarded_sender" })
  })

  it("holds email that lacks a jointly verified reply token and header chain", () => {
    expect(
      decideCorrespondenceInbound(
        inbound({
          email: { isReply: true, token: "matched", replyHeaders: "missing" },
        })
      )
    ).toEqual({ kind: "held", reason: "missing_reply_evidence" })
    expect(
      decideCorrespondenceInbound(
        inbound({
          email: { isReply: true, token: "invalid", replyHeaders: "matched" },
        })
      )
    ).toEqual({ kind: "held", reason: "missing_reply_evidence" })
  })

  it("holds input without a proven project/conversation and suppresses loops", () => {
    expect(decideCorrespondenceInbound(inbound({ target: null }))).toEqual({
      kind: "held",
      reason: "unproven_project",
    })
    expect(
      decideCorrespondenceInbound(inbound({ isDeliveryLoop: true }))
    ).toEqual({ kind: "suppressed", reason: "delivery_loop" })
    expect(
      decideCorrespondenceInbound(inbound({ isAutomatedResponse: true }))
    ).toEqual({ kind: "suppressed", reason: "automated_response" })
  })

  it("holds attachments until their transport policy has cleared them", () => {
    expect(
      decideCorrespondenceInbound(inbound({ attachments: "held" }))
    ).toEqual({ kind: "held", reason: "attachment_review" })
  })
})

describe("correspondence delivery evidence", () => {
  it("keeps queued, accepted, and delivered as distinct provider facts", () => {
    expect(transitionCorrespondenceDelivery(null, "outbox_persisted")).toEqual({
      kind: "advanced",
      state: "queued",
    })
    expect(transitionCorrespondenceDelivery("queued", "provider_accepted")).toEqual({
      kind: "advanced",
      state: "accepted",
    })
    expect(transitionCorrespondenceDelivery("accepted", "provider_delivered")).toEqual({
      kind: "advanced",
      state: "delivered",
    })
  })

  it("accepts a delivery callback that arrives before its acceptance callback", () => {
    expect(
      transitionCorrespondenceDelivery("queued", "provider_delivered")
    ).toEqual({
      kind: "advanced",
      state: "delivered",
    })
  })

  it("does not regress accepted delivery when a late outbox callback arrives", () => {
    expect(
      transitionCorrespondenceDelivery("accepted", "outbox_persisted")
    ).toEqual({ kind: "ignored", state: "accepted", reason: "stale_evidence" })
  })

  it("preserves a delivered fact when callbacks arrive out of order", () => {
    expect(
      transitionCorrespondenceDelivery("delivered", "provider_failed")
    ).toEqual({ kind: "ignored", state: "delivered", reason: "terminal_state" })
  })
})
