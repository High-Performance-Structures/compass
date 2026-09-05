import { describe, expect, it } from "vitest"

import { resolveSubVendorRfiRecipient } from "@/lib/rfis/sub-vendor-recipient"

const recipients = [
  { userId: "user-1", displayName: "Project Manager" },
  { userId: "user-2", displayName: "Superintendent" },
]

describe("resolveSubVendorRfiRecipient", () => {
  it("uses the requested visible recipient", () => {
    expect(resolveSubVendorRfiRecipient(recipients, "user-2")).toEqual({
      valid: true,
      userId: "user-2",
      displayName: "Superintendent",
    })
  })

  it("defaults to the first visible recipient", () => {
    expect(resolveSubVendorRfiRecipient(recipients, null)).toEqual({
      valid: true,
      userId: "user-1",
      displayName: "Project Manager",
    })
  })

  it("routes to the project team when no contact is exposed", () => {
    expect(resolveSubVendorRfiRecipient([], null)).toEqual({
      valid: true,
      userId: null,
      displayName: "Project team",
    })
  })

  it("rejects a requested recipient who is not visible", () => {
    expect(resolveSubVendorRfiRecipient(recipients, "user-3")).toEqual({
      valid: false,
    })
  })
})
