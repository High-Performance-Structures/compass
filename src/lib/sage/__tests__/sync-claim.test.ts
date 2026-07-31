import { describe, expect, it } from "vitest"

import {
  SAGE_SYNC_CLAIM_LEASE_MILLISECONDS,
  validateSageSyncClaim,
} from "@/lib/sage/sync-claim"

const NOW = Date.parse("2026-07-30T20:00:00.000Z")
const CLAIM_TOKEN = "8cae3eb4-757d-419d-9f88-21719ac08e1d"

function run(
  overrides: Partial<{
    readonly status: string
    readonly claimToken: string | null
    readonly claimedAt: string | null
    readonly snapshotId: string | null
  }> = {}
) {
  return {
    status: "running",
    claimToken: CLAIM_TOKEN,
    claimedAt: new Date(NOW - 1_000).toISOString(),
    snapshotId: null,
    ...overrides,
  }
}

describe("Sage bridge sync claims", () => {
  it("accepts a current running claim", () => {
    expect(validateSageSyncClaim(run(), CLAIM_TOKEN, NOW)).toEqual({
      success: true,
      terminalReplay: false,
    })
  })

  it("rejects mismatched, unclaimed, future, and expired claims", () => {
    expect(
      validateSageSyncClaim(run(), crypto.randomUUID(), NOW)
    ).toEqual({
      success: false,
      error: "Sage sync claim does not match this run.",
    })
    expect(
      validateSageSyncClaim(
        run({ status: "queued", claimToken: null, claimedAt: null }),
        CLAIM_TOKEN,
        NOW
      )
    ).toEqual({
      success: false,
      error: "Sage sync claim does not match this run.",
    })
    expect(
      validateSageSyncClaim(
        run({ claimedAt: new Date(NOW + 1_000).toISOString() }),
        CLAIM_TOKEN,
        NOW
      )
    ).toEqual({
      success: false,
      error: "Sage sync claim is missing or expired.",
    })
    expect(
      validateSageSyncClaim(
        run({
          claimedAt: new Date(
            NOW - SAGE_SYNC_CLAIM_LEASE_MILLISECONDS - 1
          ).toISOString(),
        }),
        CLAIM_TOKEN,
        NOW
      )
    ).toEqual({
      success: false,
      error: "Sage sync claim is missing or expired.",
    })
  })

  it("permits an idempotent terminal replay only with the same claim", () => {
    expect(
      validateSageSyncClaim(
        run({
          status: "needs_review",
          claimedAt: null,
          snapshotId: "snapshot-1",
        }),
        CLAIM_TOKEN,
        NOW
      )
    ).toEqual({ success: true, terminalReplay: true })
  })
})
