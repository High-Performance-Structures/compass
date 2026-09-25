import { describe, expect, it } from "vitest"

import {
  existingPhaseHandoffUpdatePolicy,
  resolveProjectHandoffClient,
  shouldPreserveReviewedPhaseHandoff,
} from "@/lib/google/project-manager-handoff"

describe("resolveProjectHandoffClient", () => {
  it("inherits the project-family client instead of using a historical contact", () => {
    expect(
      resolveProjectHandoffClient({
        isPhase: true,
        submittedContactName: "Phil Chase",
        submittedCompanyName: null,
        existingClientName: null,
        baseProjectClientName: "TCSS / GCSSC",
      }),
    ).toEqual({
      clientName: "TCSS / GCSSC",
      requiresReview: true,
    })
  })

  it("prefers an explicitly submitted company but still requires review", () => {
    expect(
      resolveProjectHandoffClient({
        isPhase: true,
        submittedContactName: "Former Contact",
        submittedCompanyName: "Teller County Shooting Society",
        existingClientName: "Old Snapshot",
        baseProjectClientName: "TCSS / GCSSC",
      }),
    ).toEqual({
      clientName: "Teller County Shooting Society",
      requiresReview: true,
    })
  })

  it("preserves an existing phase client when no family client is available", () => {
    expect(
      resolveProjectHandoffClient({
        isPhase: true,
        submittedContactName: "Historical Contact",
        submittedCompanyName: null,
        existingClientName: "Existing Client",
        baseProjectClientName: null,
      }),
    ).toEqual({
      clientName: "Existing Client",
      requiresReview: true,
    })
  })

  it("keeps legacy non-phase handoffs unchanged", () => {
    expect(
      resolveProjectHandoffClient({
        isPhase: false,
        submittedContactName: "Current Client",
        submittedCompanyName: null,
        existingClientName: "Previous Client",
        baseProjectClientName: null,
      }),
    ).toEqual({
      clientName: "Current Client",
      requiresReview: false,
    })
  })
})

describe("shouldPreserveReviewedPhaseHandoff", () => {
  it("preserves a confirmed handoff and every post-queue state", () => {
    expect(
      shouldPreserveReviewedPhaseHandoff({
        status: "open",
        syncStatus: "pending_sage",
      }),
    ).toBe(true)
    for (const syncStatus of ["queued_sage", "syncing", "failed", "synced"]) {
      expect(
        shouldPreserveReviewedPhaseHandoff({
          status: "needs_review",
          syncStatus,
        }),
      ).toBe(true)
    }
  })

  it("re-blocks a legacy phase handoff that was never explicitly confirmed", () => {
    expect(
      shouldPreserveReviewedPhaseHandoff({
        status: "needs_review",
        syncStatus: "pending_sage",
      }),
    ).toBe(false)
  })
})

describe("existingPhaseHandoffUpdatePolicy", () => {
  it("keeps a duplicate callback from reopening completed Sage work", () => {
    expect(
      existingPhaseHandoffUpdatePolicy({
        status: "open",
        syncStatus: "synced",
        existingPayloadJson: '{"revision":1}',
        incomingPayloadJson: '{"revision":1}',
      }),
    ).toEqual({
      preserveClientDecision: true,
      preserveSyncState: true,
      rejectWhileInFlight: false,
    })
  })

  it("makes changed payloads queueable again after completion or failure", () => {
    for (const syncStatus of ["synced", "failed"]) {
      expect(
        existingPhaseHandoffUpdatePolicy({
          status: "open",
          syncStatus,
          existingPayloadJson: '{"revision":1}',
          incomingPayloadJson: '{"revision":2}',
        }),
      ).toEqual({
        preserveClientDecision: true,
        preserveSyncState: false,
        rejectWhileInFlight: false,
      })
    }
  })

  it("rejects a changed payload while the previous handoff is in flight", () => {
    for (const syncStatus of ["queued_sage", "syncing"]) {
      expect(
        existingPhaseHandoffUpdatePolicy({
          status: "open",
          syncStatus,
          existingPayloadJson: '{"revision":1}',
          incomingPayloadJson: '{"revision":2}',
        }),
      ).toEqual({
        preserveClientDecision: true,
        preserveSyncState: true,
        rejectWhileInFlight: true,
      })
    }
  })

  it("does not preserve legacy pending state before explicit review", () => {
    expect(
      existingPhaseHandoffUpdatePolicy({
        status: "needs_review",
        syncStatus: "pending_sage",
        existingPayloadJson: '{"revision":1}',
        incomingPayloadJson: '{"revision":1}',
      }),
    ).toEqual({
      preserveClientDecision: false,
      preserveSyncState: false,
      rejectWhileInFlight: false,
    })
  })
})
