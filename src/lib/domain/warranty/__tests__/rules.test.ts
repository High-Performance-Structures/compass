import { describe, expect, it } from "vitest"

import {
  staffClaimTimestamps,
  vendorClaimTimestamps,
  warrantyActorName,
  warrantyClaimNumber,
} from "../rules"

const NOW = "2026-10-31T12:00:00.000Z"
const EARLIER = "2026-10-01T12:00:00.000Z"
const blank = { acknowledgedAt: null, workStartedAt: null, resolvedAt: null }

describe("warrantyClaimNumber", () => {
  it("numbers claims after the project, padded to three digits", () => {
    expect(warrantyClaimNumber("O-58-3674", 0)).toBe("O-58-3674-W-001")
    expect(warrantyClaimNumber("O-58-3674", 41)).toBe("O-58-3674-W-042")
    expect(warrantyClaimNumber("O-58-3674", 999)).toBe("O-58-3674-W-1000")
  })

  it("falls back to a generic prefix for jobs without a number", () => {
    expect(warrantyClaimNumber(null, 2)).toBe("WARRANTY-003")
    expect(warrantyClaimNumber("", 0)).toBe("WARRANTY-001")
  })
})

describe("warrantyActorName", () => {
  it("uses the trimmed display name, else the email", () => {
    expect(warrantyActorName({ displayName: "  Pat Lee ", email: "pat@example.test" })).toBe("Pat Lee")
    expect(warrantyActorName({ displayName: "   ", email: "pat@example.test" })).toBe("pat@example.test")
    expect(warrantyActorName({ displayName: null, email: "pat@example.test" })).toBe("pat@example.test")
  })
})

describe("staffClaimTimestamps", () => {
  it("clears every stamp when a claim goes back to submitted", () => {
    expect(
      staffClaimTimestamps("submitted", { acknowledgedAt: EARLIER, workStartedAt: EARLIER, resolvedAt: EARLIER }, NOW)
    ).toEqual({ acknowledgedAt: null, workStartedAt: EARLIER, resolvedAt: null })
  })

  it("stamps acknowledgement and work start once", () => {
    expect(staffClaimTimestamps("in_progress", blank, NOW)).toEqual({
      acknowledgedAt: NOW,
      workStartedAt: NOW,
      resolvedAt: null,
    })
    expect(
      staffClaimTimestamps("in_progress", { acknowledgedAt: EARLIER, workStartedAt: EARLIER, resolvedAt: null }, NOW)
    ).toEqual({ acknowledgedAt: EARLIER, workStartedAt: EARLIER, resolvedAt: null })
  })

  it("keeps the first resolution time for resolved and closed claims", () => {
    expect(staffClaimTimestamps("resolved", blank, NOW).resolvedAt).toBe(NOW)
    expect(staffClaimTimestamps("closed", { ...blank, resolvedAt: EARLIER }, NOW).resolvedAt).toBe(EARLIER)
    expect(staffClaimTimestamps("acknowledged", { ...blank, resolvedAt: EARLIER }, NOW).resolvedAt).toBeNull()
  })
})

describe("vendorClaimTimestamps", () => {
  it("acknowledges on any vendor update", () => {
    expect(vendorClaimTimestamps("visit_scheduled", blank, NOW)).toEqual({
      acknowledgedAt: NOW,
      workStartedAt: null,
      resolvedAt: null,
    })
  })

  it("treats resolved as work started and resolved", () => {
    expect(vendorClaimTimestamps("resolved", blank, NOW)).toEqual({
      acknowledgedAt: NOW,
      workStartedAt: NOW,
      resolvedAt: NOW,
    })
  })

  it("clears the resolution when the vendor reopens the work", () => {
    expect(
      vendorClaimTimestamps("in_progress", { acknowledgedAt: EARLIER, workStartedAt: EARLIER, resolvedAt: EARLIER }, NOW)
    ).toEqual({ acknowledgedAt: EARLIER, workStartedAt: EARLIER, resolvedAt: null })
  })
})
