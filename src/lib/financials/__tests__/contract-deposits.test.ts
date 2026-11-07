import { describe, expect, it } from "vitest"

import {
  currentPaymentDueAfterDeposit,
  depositAppliedToDraw,
  drawAmountBeforeDeposit,
  unappliedDeposit,
} from "@/lib/financials/contract-deposits"

describe("contract deposits on pay applications", () => {
  it("applies the whole deposit to a first draw that can absorb it", () => {
    const draw = drawAmountBeforeDeposit({ totalEarnedLessRetainage: 120_000, previousCertificates: 0 })
    const applied = depositAppliedToDraw({ mode: "auto", requested: 0, availableDeposit: 40_282.95, drawBeforeDeposit: draw })
    expect(applied).toBe(40_282.95)
    expect(currentPaymentDueAfterDeposit({ totalEarnedLessRetainage: 120_000, previousCertificates: 0, depositApplied: applied })).toBe(79_717.05)
  })

  it("never applies more than the draw, leaving the rest for the next one", () => {
    const applied = depositAppliedToDraw({ mode: "auto", requested: 0, availableDeposit: 50_000, drawBeforeDeposit: 30_000 })
    expect(applied).toBe(30_000)
    expect(unappliedDeposit({ receivedCents: 5_000_000, appliedDollars: applied })).toBe(20_000)
  })

  it("keeps a manual amount within the available deposit and the draw", () => {
    expect(depositAppliedToDraw({ mode: "manual", requested: 10_000, availableDeposit: 50_000, drawBeforeDeposit: 30_000 })).toBe(10_000)
    expect(depositAppliedToDraw({ mode: "manual", requested: 60_000, availableDeposit: 50_000, drawBeforeDeposit: 80_000 })).toBe(50_000)
    expect(depositAppliedToDraw({ mode: "manual", requested: -5, availableDeposit: 50_000, drawBeforeDeposit: 80_000 })).toBe(0)
  })

  it("a later draw is not reduced again once the deposit is used up", () => {
    // Draw 2: previous certificates are draw 1's earned less retainage.
    expect(currentPaymentDueAfterDeposit({ totalEarnedLessRetainage: 200_000, previousCertificates: 120_000, depositApplied: 0 })).toBe(80_000)
  })

  it("lets a draw that credits back over-billed work come out negative and take no deposit", () => {
    const draw = drawAmountBeforeDeposit({ totalEarnedLessRetainage: 9_000, previousCertificates: 9_900 })
    expect(draw).toBe(0)
    expect(depositAppliedToDraw({ mode: "auto", requested: 0, availableDeposit: 5_000, drawBeforeDeposit: draw })).toBe(0)
    expect(currentPaymentDueAfterDeposit({ totalEarnedLessRetainage: 9_000, previousCertificates: 9_900, depositApplied: 0 })).toBe(-900)
  })
})
