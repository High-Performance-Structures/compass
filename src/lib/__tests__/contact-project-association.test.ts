import { describe, expect, it } from "vitest"

import { vendorCanBeInvited, vendorJobContactType } from "@/lib/contact-project-association"
import { VENDOR_TYPES_SETTINGS_GROUP } from "@/lib/feature-settings/vendor-types-settings"

const types = VENDOR_TYPES_SETTINGS_GROUP.defaults.types

describe("vendorJobContactType", () => {
  it("lists each type on a job by its job role, whatever its case", () => {
    expect(vendorJobContactType("Subcontractor", types)).toBe("subcontractor")
    expect(vendorJobContactType("material supplier", types)).toBe("supplier")
    expect(vendorJobContactType("Professional Services", types)).toBe("subcontractor")
    expect(vendorJobContactType("Equipment and Rental", types)).toBe("supplier")
  })

  it("still lets a type with no job role be picked for a job (RFIs, RFQs, POs)", () => {
    expect(vendorJobContactType("Government Agency", types)).toBe("subcontractor")
  })

  it("never adds banks or lenders, and keeps the older reading for names not on the list", () => {
    expect(vendorJobContactType("Bank / Lender", types)).toBeNull()
    expect(vendorJobContactType("Supplier", types)).toBe("supplier")
    expect(vendorJobContactType("Miscellaneous Vendor", types)).toBe("supplier")
    expect(vendorJobContactType("Consultant", types)).toBe("subcontractor")
    expect(vendorJobContactType("Internal", types)).toBe("internal")
  })
})

describe("vendorCanBeInvited", () => {
  it("invites types with a job role and not types without one, until their role changes", () => {
    expect(vendorCanBeInvited("Subcontractor", types)).toBe(true)
    expect(vendorCanBeInvited("Equipment and Rental", types)).toBe(true)
    expect(vendorCanBeInvited("Government Agency", types)).toBe(false)
    const changed = types.map((type) => (type.name === "Government Agency" ? { ...type, jobRole: "supplier" as const } : type))
    expect(vendorCanBeInvited("Government Agency", changed)).toBe(true)
    expect(vendorCanBeInvited("Bank / Lender", types)).toBe(false)
    expect(vendorCanBeInvited("Consultant", types)).toBe(true)
  })
})
