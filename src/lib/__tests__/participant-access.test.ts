import { describe, expect, it } from "vitest"
import {
  canApproveRfi,
  canApproveRfq,
  canCommentOnTodo,
  canCompleteTodo,
  canParticipantPerform,
  canReplyToMessage,
  canRespondToPurchaseOrder,
  canRespondToRfi,
  canRespondToRfq,
  canRespondToSchedule,
  canViewMessage,
  canViewPurchaseOrder,
  canViewRfi,
  canViewRfq,
  canViewSchedule,
  canViewTodo,
  isReviewedActiveParticipant,
  PARTICIPANT_CAPABILITIES,
  type ParticipantAccessRecord,
} from "@/lib/participant-access"

function participant(
  capabilities: readonly string[],
  overrides: Partial<ParticipantAccessRecord> = {},
): ParticipantAccessRecord {
  return {
    reviewStatus: "reviewed",
    active: true,
    identityStatus: "matched",
    membershipStatus: "active",
    capabilitiesJson: JSON.stringify(capabilities),
    ...overrides,
  }
}

describe("normalized participant access", () => {
  it("supports message view and reply independently", () => {
    const record = participant([
      PARTICIPANT_CAPABILITIES.messageView,
      PARTICIPANT_CAPABILITIES.messageReply,
    ])
    expect(canViewMessage(record)).toBe(true)
    expect(canReplyToMessage(record)).toBe(true)
    expect(canParticipantPerform(participant(["message.view"]), "message.reply")).toBe(false)
  })

  it("supports PO view and respond independently", () => {
    const record = participant([
      PARTICIPANT_CAPABILITIES.purchaseOrderView,
      PARTICIPANT_CAPABILITIES.purchaseOrderRespond,
    ])
    expect(canViewPurchaseOrder(record)).toBe(true)
    expect(canRespondToPurchaseOrder(record)).toBe(true)
    expect(canRespondToPurchaseOrder(participant(["purchase_order.view"]))).toBe(false)
  })

  it("supports ToDo view, comment, and complete as separate grants", () => {
    const record = participant([
      PARTICIPANT_CAPABILITIES.todoView,
      PARTICIPANT_CAPABILITIES.todoComment,
      PARTICIPANT_CAPABILITIES.todoComplete,
    ])
    expect(canViewTodo(record)).toBe(true)
    expect(canCommentOnTodo(record)).toBe(true)
    expect(canCompleteTodo(record)).toBe(true)
    expect(canCompleteTodo(participant([PARTICIPANT_CAPABILITIES.todoView]))).toBe(false)
  })

  it("supports RFI and RFQ view/respond/approve grants without escalation", () => {
    const record = participant([
      PARTICIPANT_CAPABILITIES.rfiView,
      PARTICIPANT_CAPABILITIES.rfiRespond,
      PARTICIPANT_CAPABILITIES.rfiApprove,
      PARTICIPANT_CAPABILITIES.rfqView,
      PARTICIPANT_CAPABILITIES.rfqRespond,
      PARTICIPANT_CAPABILITIES.rfqApprove,
    ])
    expect(canViewRfi(record)).toBe(true)
    expect(canRespondToRfi(record)).toBe(true)
    expect(canApproveRfi(record)).toBe(true)
    expect(canViewRfq(record)).toBe(true)
    expect(canRespondToRfq(record)).toBe(true)
    expect(canApproveRfq(record)).toBe(true)
    expect(canParticipantPerform(participant(["rfi.view"]), "rfi.approve")).toBe(false)
    expect(canParticipantPerform(participant(["*"]), "rfq.approve")).toBe(false)
  })

  it("supports schedule access for multiple independent assignees", () => {
    const first = participant([
      PARTICIPANT_CAPABILITIES.scheduleView,
      PARTICIPANT_CAPABILITIES.scheduleRespond,
    ])
    const second = participant([
      PARTICIPANT_CAPABILITIES.scheduleView,
      PARTICIPANT_CAPABILITIES.scheduleRespond,
    ])
    expect(canViewSchedule(first)).toBe(true)
    expect(canViewSchedule(second)).toBe(true)
    expect(canRespondToSchedule(first)).toBe(true)
    expect(canRespondToSchedule(second)).toBe(true)
    expect(first).not.toBe(second)
  })

  it.each([
    ["inactive", { active: false }],
    ["unreviewed", { reviewStatus: "unreviewed" }],
    ["identity conflict", { identityStatus: "conflict" }],
    ["unmatched identity", { identityStatus: "unmatched" }],
    ["inactive membership", { membershipStatus: "inactive" }],
  ] satisfies readonly [string, Partial<ParticipantAccessRecord>][]) (
    "denies %s participants even with a capability grant",
    (_label, overrides) => {
      const record = participant([PARTICIPANT_CAPABILITIES.messageView], overrides)
      expect(isReviewedActiveParticipant(record)).toBe(false)
      expect(canViewMessage(record)).toBe(false)
    },
  )

  it("keeps internal and external reviewed participants symmetric", () => {
    const internal = participant([PARTICIPANT_CAPABILITIES.rfiRespond])
    const external = participant([PARTICIPANT_CAPABILITIES.rfiRespond])
    expect(canRespondToRfi(internal)).toBe(canRespondToRfi(external))
  })

  it("fails closed for malformed or object grants that are not explicitly true", () => {
    expect(canViewMessage(participant([], { capabilitiesJson: "not-json" }))).toBe(false)
    expect(
      canViewMessage(
        participant([], { capabilitiesJson: JSON.stringify({ "message.view": "yes" }) }),
      ),
    ).toBe(false)
    expect(
      canViewMessage(
        participant([], { capabilitiesJson: JSON.stringify({ "message.view": true }) }),
      ),
    ).toBe(true)
  })
})
