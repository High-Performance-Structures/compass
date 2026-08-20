import { describe, expect, it } from "vitest"

import {
  contactIdentityChanged,
  requestedDirectoryIdentityKeys,
} from "@/lib/contact-identity-ownership"
import { updateProfileSchema } from "@/lib/validations/profile"

describe("contact identity ownership", () => {
  it("ignores formatting-only email and whitespace changes", () => {
    expect(
      contactIdentityChanged(
        {
          email: "Person@Example.com",
          phone: " 970-555-0100 ",
          address: " 10 Main Street ",
        },
        {
          email: " person@example.com ",
          phone: "970-555-0100",
          address: "10 Main Street",
        }
      )
    ).toBe(false)
  })

  it("detects phone, email, and address changes", () => {
    const current = {
      email: "person@example.com",
      phone: "970-555-0100",
      address: "10 Main Street",
    }

    expect(
      contactIdentityChanged(current, { ...current, email: "new@example.com" })
    ).toBe(true)
    expect(
      contactIdentityChanged(current, { ...current, phone: "970-555-0199" })
    ).toBe(true)
    expect(
      contactIdentityChanged(current, { ...current, address: "20 Main Street" })
    ).toBe(true)
  })

  it("filters active identities for directories larger than D1's parameter limit", () => {
    const entityIds = Array.from(
      { length: 540 },
      (_, index) => `directory-${index}`
    )

    const result = requestedDirectoryIdentityKeys({
      entityIds,
      rows: [
        { entityType: "customer", entityId: "directory-10" },
        { entityType: "vendor", entityId: "directory-539" },
        { entityType: "vendor_contact", entityId: "directory-42" },
        { entityType: "vendor", entityId: "outside-directory" },
        { entityType: "customer", entityId: null },
      ],
    })

    expect(Array.from(result)).toEqual([
      "customer:directory-10",
      "vendor:directory-539",
      "vendor_contact:directory-42",
    ])
  })
})

describe("profile identity validation", () => {
  it("normalizes the email and permits blank optional contact fields", () => {
    const result = updateProfileSchema.safeParse({
      firstName: " Brian ",
      lastName: " Sack ",
      email: " BRIAN@EXAMPLE.COM ",
      phone: " ",
      address: " ",
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data).toEqual({
      firstName: "Brian",
      lastName: "Sack",
      email: "brian@example.com",
      phone: "",
      address: "",
    })
  })

  it("rejects an invalid account email", () => {
    const result = updateProfileSchema.safeParse({
      firstName: "Brian",
      lastName: "Sack",
      email: "not-an-email",
      phone: "555-0100",
      address: "10 Test St",
    })

    expect(result.success).toBe(false)
  })
})
