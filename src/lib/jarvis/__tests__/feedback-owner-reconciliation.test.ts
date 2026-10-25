import { describe, expect, it } from "vitest"

import {
  resolveHistoricalFeedbackOwner,
  type FeedbackOwnerAccount,
  type FeedbackOwnerSourceEvent,
} from "@/lib/jarvis/feedback-owner-reconciliation"

const organizationId = "org-1"
const userId = "user-1"
const email = "requester@example.com"

function account(
  overrides: Partial<FeedbackOwnerAccount> = {},
): FeedbackOwnerAccount {
  return {
    id: userId,
    email,
    googleEmail: null,
    isActive: true,
    organizationId,
    organizationIsActive: true,
    membershipExists: true,
    ...overrides,
  }
}

function sourceEvent(
  overrides: Partial<FeedbackOwnerSourceEvent> = {},
): FeedbackOwnerSourceEvent {
  return {
    id: "event-1",
    organizationId,
    feedbackDeskItemId: "item-1",
    direction: "outbound",
    source: "ask-jarvis",
    eventType: "agent.prompt",
    payload: JSON.stringify({
      user: {
        id: userId,
        email,
      },
    }),
    ...overrides,
  }
}

describe("historical Feedback Desk ownership reconciliation", () => {
  it("repairs an ownerless item from three consistent protected source events", () => {
    const result = resolveHistoricalFeedbackOwner({
      item: {
        id: "item-1",
        organizationId,
        reporterEmail: null,
        metadata: null,
      },
      sourceEvents: [
        sourceEvent(),
        sourceEvent({ id: "event-2" }),
        sourceEvent({ id: "event-3" }),
      ],
      account: account(),
    })

    expect(result).toEqual({
      kind: "repair",
      userId,
      reporterEmail: email,
      metadata: JSON.stringify({ externalActorId: userId }),
      sourceEventCount: 3,
    })
  })

  it("fails closed when protected source events disagree", () => {
    const result = resolveHistoricalFeedbackOwner({
      item: {
        id: "item-1",
        organizationId,
        reporterEmail: null,
        metadata: null,
      },
      sourceEvents: [
        sourceEvent(),
        sourceEvent({
          id: "event-2",
          payload: JSON.stringify({
            user: { id: "user-2", email: "other@example.com" },
          }),
        }),
      ],
      account: account(),
    })

    expect(result).toEqual({ kind: "reject", reason: "source_disagreement" })
  })

  it.each([
    ["inactive_account", account({ isActive: false })],
    ["missing_account", null],
    ["missing_membership", account({ membershipExists: false })],
    ["cross_org_membership", account({ organizationId: "org-2" })],
    ["inactive_organization", account({ organizationIsActive: false })],
  ] as const)("fails closed for %s", (reason, candidate) => {
    const result = resolveHistoricalFeedbackOwner({
      item: {
        id: "item-1",
        organizationId,
        reporterEmail: null,
        metadata: null,
      },
      sourceEvents: [sourceEvent()],
      account: candidate,
    })

    expect(result).toEqual({ kind: "reject", reason })
  })

  it("fails closed when the item already resolves to another identity", () => {
    const result = resolveHistoricalFeedbackOwner({
      item: {
        id: "item-1",
        organizationId,
        reporterEmail: "other@example.com",
        metadata: JSON.stringify({ externalActorId: userId }),
      },
      sourceEvents: [sourceEvent()],
      account: account(),
    })

    expect(result).toEqual({
      kind: "reject",
      reason: "existing_identity_mismatch",
    })
  })

  it("is idempotent for an already-correct requester identity", () => {
    const result = resolveHistoricalFeedbackOwner({
      item: {
        id: "item-1",
        organizationId,
        reporterEmail: email,
        metadata: JSON.stringify({ externalActorId: userId }),
      },
      sourceEvents: [sourceEvent()],
      account: account(),
    })

    expect(result).toEqual({ kind: "noop" })
  })
})
