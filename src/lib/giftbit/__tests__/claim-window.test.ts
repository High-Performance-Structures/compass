import { describe, expect, it } from "vitest"

import {
  formatGiftbitClaimExpiry,
  giftbitClaimExpiryDate,
} from "../claim-window"

describe("Giftbit claim window", () => {
  it("leaves a full Pacific-day margin inside Giftbit's one-year maximum", () => {
    expect(giftbitClaimExpiryDate("2026-09-06T06:00:00.000Z")).toBe("2027-09-04")
  })

  it("formats the claim date without local-time drift", () => {
    expect(formatGiftbitClaimExpiry("2027-09-05")).toBe("September 5, 2027")
  })

  it("rejects an invalid release date", () => {
    expect(() => giftbitClaimExpiryDate("not-a-date")).toThrow(
      "A valid release date is required",
    )
  })
})
