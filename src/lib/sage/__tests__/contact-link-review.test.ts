import { describe, expect, it } from "vitest"

import { sageContactLinkCandidateError, sageContactReadClaimError, sageEmployeeNamesMatch, sageIdentityLinkReviewError, sageLinkReadbackRefreshReason, type SageContactLinkLookup } from "@/lib/sage/contact-link-review"

const lookup: SageContactLinkLookup = {
  kind: "client_person",
  entityId: "compass-person-1",
  sageRecordNumber: "2",
  parentSageRecordId: "sage-client-guid",
}

const identity = {
  sageRecordId: null,
  sageRecordNumber: null,
  parentSageRecordId: "sage-client-guid",
  linkedUserId: null,
}

const readback = { ...lookup, sageRecordId: "sage-person-guid" }

describe("reviewed Sage identity linking", () => {
  it("reuses active reads and refreshes only stale or incomplete read-backs", () => {
    const now = Date.parse("2026-09-25T06:45:00.000Z")
    const candidate = { kind: "client_company" as const, status: "awaiting_review",
      completedAt: "2026-09-25T06:40:00.000Z", snapshotValid: true, sageIdentityName: "Amaroo LLC" }
    expect(sageLinkReadbackRefreshReason(candidate, now)).toBeNull()
    expect(sageLinkReadbackRefreshReason({ ...candidate, status: "queued" }, now)).toBeNull()
    expect(sageLinkReadbackRefreshReason({ ...candidate, completedAt: "2026-09-25T06:25:00.000Z" }, now)).toBe("expired")
    expect(sageLinkReadbackRefreshReason({ ...candidate, snapshotValid: false }, now)).toBe("invalid_readback")
    expect(sageLinkReadbackRefreshReason({ ...candidate, sageIdentityName: null }, now)).toBe("missing_identity_name")
    expect(sageLinkReadbackRefreshReason({ ...candidate, kind: "employee", sageIdentityName: null }, now)).toBe("missing_identity_name")
    expect(sageLinkReadbackRefreshReason({ ...candidate, kind: "employee", sageIdentityName: "Sarah Cowman" }, now)).toBeNull()
  })

  it("matches employee names without relying on optional contact details", () => {
    expect(sageEmployeeNamesMatch("Sarah Cowman", "  sarah   COWMAN ")).toBe(true)
    expect(sageEmployeeNamesMatch("Sarah Cowman", "Sarah Coleman")).toBe(false)
    expect(sageEmployeeNamesMatch("Sarah Cowman", null)).toBe(false)
    expect(sageEmployeeNamesMatch("Sarah Cowman", " ")).toBe(false)
  })

  it("permits an authorized reviewer to approve their own employee lookup with an optional note", () => {
    const input: Parameters<typeof sageIdentityLinkReviewError>[0] = { kind: "employee", requesterIsReviewer: true,
      compassName: "Sarah Cowman", sageName: "Sarah Cowman", reviewNote: "" }
    expect(sageIdentityLinkReviewError(input)).toBeNull()
    expect(sageIdentityLinkReviewError({ ...input, sageName: "Another Person" })).toBeNull()
    expect(sageIdentityLinkReviewError({ ...input, sageName: "Another Person", reviewNote: "Verified legal name in Sage" })).toBeNull()
    expect(sageIdentityLinkReviewError({ ...input, sageName: null })).toMatch(/not returned/)
    expect(sageIdentityLinkReviewError({ ...input, kind: "client_company" })).toMatch(/limited/)
    expect(sageIdentityLinkReviewError({ ...input, kind: "client_company", requesterIsReviewer: false, sageName: null }))
      .toMatch(/client name was not returned/)
  })

  it("does not require a written note for an employee name mismatch", () => {
    const input: Parameters<typeof sageIdentityLinkReviewError>[0] = { kind: "employee", requesterIsReviewer: false,
      compassName: "Sarah Cowman", sageName: "Sarah Coleman", reviewNote: "" }
    expect(sageIdentityLinkReviewError(input)).toBeNull()
    expect(sageIdentityLinkReviewError({ ...input, reviewNote: "Verified Sage legal name" })).toBeNull()
  })
  it("accepts a number-only bridge read only for a link candidate", () => {
    const claim = { purpose: "link_candidate", kind: "client_person", sageRecordId: null,
      sageRecordNumber: "2", parentSageRecordId: "sage-client-guid" }
    expect(sageContactReadClaimError(claim)).toBeNull()
    expect(sageContactReadClaimError({ ...claim, purpose: "refresh" })).toMatch(/verified Sage record ID/)
    expect(sageContactReadClaimError({ ...claim, parentSageRecordId: null })).toMatch(/exact number/)
  })

  it("accepts an exact number, parent and stable GUID as a review candidate", () => {
    expect(sageContactLinkCandidateError(identity, lookup, readback)).toBeNull()
  })

  it("never replaces an existing verified Sage link", () => {
    expect(sageContactLinkCandidateError({ ...identity, sageRecordId: "other-guid" }, lookup, readback))
      .toMatch(/already has a verified/)
  })

  it("rejects a different Sage contact line or parent", () => {
    expect(sageContactLinkCandidateError(identity, lookup, { ...readback, sageRecordNumber: "3" }))
      .toMatch(/differs/)
    expect(sageContactLinkCandidateError(identity, lookup, { ...readback, parentSageRecordId: "other-client" }))
      .toMatch(/differs/)
  })

  it("rejects a changed Compass number or parent", () => {
    expect(sageContactLinkCandidateError({ ...identity, sageRecordNumber: "3" }, lookup, readback))
      .toMatch(/number changed/)
    expect(sageContactLinkCandidateError({ ...identity, parentSageRecordId: "other-client" }, lookup, readback))
      .toMatch(/parent changed/)
  })

  it("rejects a blank stable ID and different entity", () => {
    expect(sageContactLinkCandidateError(identity, lookup, { ...readback, sageRecordId: " " }))
      .toMatch(/differs/)
    expect(sageContactLinkCandidateError(identity, lookup, { ...readback, entityId: "other-person" }))
      .toMatch(/differs/)
  })
})
