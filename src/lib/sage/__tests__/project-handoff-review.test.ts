import { describe, expect, it } from "vitest"

import { isGooglePhaseHandoffAwaitingClientReview } from "@/lib/sage/project-handoff-review"

const REVIEWABLE_HANDOFF = {
  sourceSystem: "google_project_manager",
  sourceRecordType: "sage_project_handoff",
  status: "needs_review",
  syncDirection: "write",
  sageWriteStatus: "not_ready",
  syncStatus: "needs_review",
} as const

describe("isGooglePhaseHandoffAwaitingClientReview", () => {
  it("allows only a blocked Google Project Manager handoff", () => {
    expect(isGooglePhaseHandoffAwaitingClientReview(REVIEWABLE_HANDOFF)).toBe(true)
  })

  it("does not rewrite Compass intake handoffs", () => {
    expect(
      isGooglePhaseHandoffAwaitingClientReview({
        ...REVIEWABLE_HANDOFF,
        sourceSystem: "compass_project_intake",
      }),
    ).toBe(false)
  })

  it("does not reopen a handoff that is already ready or queued", () => {
    expect(
      isGooglePhaseHandoffAwaitingClientReview({
        ...REVIEWABLE_HANDOFF,
        sageWriteStatus: "needs_review",
        syncStatus: "pending_sage",
      }),
    ).toBe(false)
    expect(
      isGooglePhaseHandoffAwaitingClientReview({
        ...REVIEWABLE_HANDOFF,
        sageWriteStatus: "queued",
        syncStatus: "queued_sage",
      }),
    ).toBe(false)
  })

  it("does not offer another review after the client was confirmed", () => {
    expect(
      isGooglePhaseHandoffAwaitingClientReview({
        ...REVIEWABLE_HANDOFF,
        status: "open",
        sageWriteStatus: "needs_review",
        syncStatus: "pending_sage",
      }),
    ).toBe(false)
  })
})
