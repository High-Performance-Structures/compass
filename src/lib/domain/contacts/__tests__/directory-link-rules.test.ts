import { describe, expect, it } from "vitest"

import { proposeDirectoryLink } from "../link-matching"
import { directoryVendorPick, nextVendorLink, preferLinkedText, vendorPickFor } from "../rules"

describe("directoryVendorPick", () => {
  it("names the vendor of a directory option and the project contact of a project option", () => {
    expect(directoryVendorPick({ source: "directory", projectContactId: null, directoryContactId: "v-1" })).toEqual({
      projectContactId: null,
      vendorId: "v-1",
    })
    expect(directoryVendorPick({ source: "project", projectContactId: "pc-1", directoryContactId: null })).toEqual({
      projectContactId: "pc-1",
      vendorId: null,
    })
  })

  it("names nothing for staff, typed names or no choice", () => {
    expect(directoryVendorPick({ source: "project", projectContactId: null, directoryContactId: null })).toBeNull()
    expect(directoryVendorPick(undefined)).toBeNull()
    expect(directoryVendorPick(null)).toBeNull()
    expect(vendorPickFor(null)).toBeNull()
    expect(vendorPickFor("v-1")).toEqual({ projectContactId: null, vendorId: "v-1" })
  })
})

describe("preferLinkedText", () => {
  it("prefers the linked record and falls back to the stored text", () => {
    expect(preferLinkedText("Acme Framing, LLC", "Acme")).toBe("Acme Framing, LLC")
    expect(preferLinkedText(null, "Acme")).toBe("Acme")
    expect(preferLinkedText("  ", "Acme")).toBe("Acme")
    expect(preferLinkedText(undefined, null)).toBeNull()
  })
})

describe("nextVendorLink", () => {
  const existing = { existingVendorId: "v-1", existingName: "Acme Framing" }

  it("takes a new pick", () => {
    expect(nextVendorLink({ ...existing, pickedVendorId: "v-2", nextName: "Peak Supply" })).toBe("v-2")
  })

  it("keeps the link while the company text is unchanged", () => {
    expect(nextVendorLink({ ...existing, pickedVendorId: null, nextName: " acme  FRAMING " })).toBe("v-1")
  })

  it("drops the link when the company is retyped or cleared", () => {
    expect(nextVendorLink({ ...existing, pickedVendorId: null, nextName: "Someone Else" })).toBeNull()
    expect(nextVendorLink({ ...existing, pickedVendorId: null, nextName: null })).toBeNull()
    expect(nextVendorLink({ existingVendorId: null, existingName: "Acme", pickedVendorId: null, nextName: "Acme" })).toBeNull()
  })
})

describe("link matching", () => {
  it("treats the same record found twice as one match", () => {
    const vendor = { kind: "vendor", id: "v-1", organizationId: "org", name: "Acme", company: "Acme", email: "a@acme.test" } as const
    const proposal = proposeDirectoryLink(
      { id: "s", organizationId: "org", name: "x", company: null, email: "a@acme.test", kinds: ["vendor"], compareCompany: false },
      [vendor, { ...vendor }]
    )
    expect(proposal).toEqual({ outcome: "exact", rule: "email", candidate: vendor })
  })
})
