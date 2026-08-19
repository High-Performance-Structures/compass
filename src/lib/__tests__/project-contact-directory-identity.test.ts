import { describe, expect, it } from "vitest"

import { resolveProjectContactIdentity } from "@/lib/project-contact-directory-identity"

describe("resolveProjectContactIdentity", () => {
  it("uses linked directory identity as the canonical contact information", () => {
    expect(
      resolveProjectContactIdentity(
        {
          email: "old@example.com",
          phone: "303-555-0100",
          address: "Old address",
        },
        {
          email: " current@example.com ",
          phone: "303-555-0199",
          address: "Current address",
        }
      )
    ).toEqual({
      email: "current@example.com",
      phone: "303-555-0199",
      address: "Current address",
    })
  })

  it("preserves project snapshots when a linked directory field is blank", () => {
    expect(
      resolveProjectContactIdentity(
        {
          email: "project@example.com",
          phone: "303-555-0100",
          address: null,
        },
        { email: "", phone: null, address: "  " }
      )
    ).toEqual({
      email: "project@example.com",
      phone: "303-555-0100",
      address: null,
    })
  })
})
