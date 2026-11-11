import { describe, expect, it } from "vitest"

import {
  importedContactId,
  importedContactSource,
  importedVendorContactId,
  isFullPersonText,
  participantKey,
} from "../bt-participant-identity"

/*
 * The keys and ids the retired Buildertrend importer stored. Pinned values:
 * they must stay byte-for-byte the same so review finds the rows it made.
 */

describe("bt participant identity", () => {
  it("keeps the importer's deterministic ids", () => {
    expect(importedContactId("p-1", "person:vendor_contact:vc-1")).toBe("bt-contact-cf196687612be40bc92cce59de9a8dc4")
    expect(importedVendorContactId("org-1", "new:email:a@b.co")).toBe("bt-vendor-contact-7b1ee04f61b60c30c2bd1ecede79449a")
  })

  it("keys a participant by id, else email, else name", () => {
    expect(participantKey({ namespace: "to", participantId: "42", email: "a@b.co", displayName: "A B" })).toBe("to:42")
    expect(participantKey({ namespace: "to", participantId: null, email: " A@B.co ", displayName: "A B" })).toBe("to:email:a@b.co")
    expect(participantKey({ namespace: "cc", participantId: null, email: null, displayName: "  Ann   Lee " })).toBe("cc:name:ann lee")
    expect(participantKey({ namespace: "cc", participantId: null, email: null, displayName: null })).toBe("cc:name:unknown")
  })

  it("tells one whole person from a fragment or a list", () => {
    expect(isFullPersonText("ann@example.com")).toBe(true)
    expect(isFullPersonText("Ann Lee")).toBe(true)
    expect(isFullPersonText("Ann")).toBe(false)
    expect(isFullPersonText("Ann Lee, Bo Diaz")).toBe(false)
    expect(isFullPersonText(null)).toBe(false)
  })

  it("records former employees archived and keyed by identity", () => {
    expect(importedContactSource({ kind: "former_staff", key: "to:name:x y", identity: "internal:ic-1" })).toEqual({
      contactType: "internal", sourceEntityType: "buildertrend_former_employee", sourceEntityId: "internal:ic-1", active: false,
    })
    expect(importedContactSource({ kind: "vendor", key: "to:name:x y", identity: "person:vendor_contact:vc-1" })).toEqual({
      contactType: "subcontractor", sourceEntityType: "buildertrend_participant", sourceEntityId: "to:name:x y", active: true,
    })
  })
})
