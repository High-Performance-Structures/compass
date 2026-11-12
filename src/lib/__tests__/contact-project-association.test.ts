import { describe, expect, it } from "vitest"

import { vendorJobContactType } from "@/lib/contact-project-association"
import { VENDOR_TYPES_SETTINGS_GROUP } from "@/lib/feature-settings/vendor-types-settings"

const types = VENDOR_TYPES_SETTINGS_GROUP.defaults.types

describe("vendorJobContactType", () => {
  it("follows each listed vendor type's job role, whatever its case", () => {
    expect(vendorJobContactType("Subcontractor", types)).toBe("subcontractor")
    expect(vendorJobContactType("material supplier", types)).toBe("supplier")
    expect(vendorJobContactType("Professional Services", types)).toBe("subcontractor")
    expect(vendorJobContactType("Equipment and Rental", types)).toBeNull()
    expect(vendorJobContactType("Government Agency", types)).toBeNull()
  })

  it("lets the company's setting override a name", () => {
    expect(vendorJobContactType("Material Supplier", [{ name: "Material Supplier", jobRole: "none", paperwork: "w9", hidden: false }])).toBeNull()
  })

  it("keeps the older reading for names not on the list", () => {
    expect(vendorJobContactType("Supplier", types)).toBe("supplier")
    expect(vendorJobContactType("Miscellaneous Vendor", types)).toBe("supplier")
    expect(vendorJobContactType("Consultant", types)).toBe("subcontractor")
    expect(vendorJobContactType("Internal", types)).toBe("internal")
    expect(vendorJobContactType("Bank / Lender", types)).toBeNull()
  })
})
