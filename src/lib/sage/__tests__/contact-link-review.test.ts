import { describe, expect, it } from "vitest"

import { sageContactLinkCandidateError, sageContactReadClaimError, type SageContactLinkLookup } from "@/lib/sage/contact-link-review"

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
