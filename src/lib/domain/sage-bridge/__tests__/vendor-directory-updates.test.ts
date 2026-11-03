import { describe, expect, it } from "vitest"

import {
  compassCategoryForSageType,
  formatVendorAddress,
  planSageVendorUpdate,
  sageVendorUpdateSummary,
  type SageSyncedVendor,
  type SageVendorEntry,
} from "@/lib/domain/sage-bridge/vendor-directory-updates"

const CATEGORIES = ["Subcontractor", "Supplier", "Consultant", "Miscellaneous Vendor"]

function vendor(overrides: Partial<SageSyncedVendor> = {}): SageSyncedVendor {
  return {
    id: "vendor-1",
    name: "Colorado Crete LLC",
    category: "Miscellaneous Vendor",
    ownerName: null,
    addressLine1: "1 Main St",
    addressLine2: null,
    city: "Denver",
    state: "CO",
    postalCode: "80202",
    phone: "719-555-0100",
    primaryEmail: "office@crete.example",
    address: "1 Main St, Denver, CO 80202",
    ...overrides,
  }
}

function entry(overrides: Partial<SageVendorEntry["details"]> = {}, top: Partial<Omit<SageVendorEntry, "details">> = {}): SageVendorEntry {
  return {
    name: "Colorado Crete LLC",
    email: "office@crete.example",
    details: {
      ownerName: null,
      addressLine1: "1 Main St",
      addressLine2: null,
      city: "Denver",
      state: "CO",
      postalCode: "80202",
      phone: "719-555-0100",
      vendorType: null,
      ...overrides,
    },
    ...top,
  }
}

describe("planSageVendorUpdate", () => {
  it("changes nothing when Compass already matches Sage", () => {
    expect(planSageVendorUpdate(vendor(), entry(), {}, CATEGORIES)).toBeNull()
  })

  it("takes Sage's name, owner, phone and email", () => {
    const update = planSageVendorUpdate(
      vendor(),
      entry({ ownerName: "David Morales", phone: "719-555-0199" }, { name: "Colorado Crete, Inc.", email: "ap@crete.example" }),
      {},
      CATEGORIES
    )
    expect(update?.patch).toEqual({
      name: "Colorado Crete, Inc.",
      ownerName: "David Morales",
      phone: "719-555-0199",
      primaryEmail: "ap@crete.example",
    })
    expect(update && sageVendorUpdateSummary(update)).toBe("Updated from Sage: name, owner, phone, email")
  })

  it("keeps Compass's value where Sage is blank", () => {
    expect(planSageVendorUpdate(vendor(), entry({ phone: null, addressLine1: "  " }, { email: null }), {}, CATEGORIES)).toBeNull()
  })

  it("rewrites the address text when a part of it changes", () => {
    const update = planSageVendorUpdate(vendor(), entry({ addressLine1: "9 Pine Rd", addressLine2: "Unit B" }), {}, CATEGORIES)
    expect(update?.patch).toEqual({ addressLine1: "9 Pine Rd", addressLine2: "Unit B", address: "9 Pine Rd, Unit B, Denver, CO 80202" })
  })

  it("follows Sage's vendor type to the Compass category of the same name", () => {
    const update = planSageVendorUpdate(vendor(), entry({ vendorType: "subcontractor" }), {}, CATEGORIES)
    expect(update?.changes).toEqual([{ field: "category", before: "Miscellaneous Vendor", after: "Subcontractor" }])
  })

  it("uses the company's mapping for a Sage type with another name", () => {
    const update = planSageVendorUpdate(vendor(), entry({ vendorType: "Material Supplier" }), { "Material Supplier": "Supplier" }, CATEGORIES)
    expect(update?.patch).toEqual({ category: "Supplier" })
  })

  it("keeps Compass's category when Sage has no type or an unmapped one", () => {
    expect(planSageVendorUpdate(vendor(), entry({ vendorType: null }), {}, CATEGORIES)).toBeNull()
    expect(planSageVendorUpdate(vendor(), entry({ vendorType: "Fuel and Vehicle" }), {}, CATEGORIES)).toBeNull()
  })
})

describe("compassCategoryForSageType", () => {
  it("matches the mapping without regard to case", () => {
    expect(compassCategoryForSageType("professional services", { "Professional Services": "Consultant" }, CATEGORIES)).toBe("Consultant")
  })

  it("prefers the mapping over a same-named category", () => {
    expect(compassCategoryForSageType("Supplier", { Supplier: "Subcontractor" }, CATEGORIES)).toBe("Subcontractor")
  })
})

describe("formatVendorAddress", () => {
  it("joins the parts that are present", () => {
    expect(formatVendorAddress({ addressLine1: "1 Main St", addressLine2: null, city: null, state: "CO", postalCode: null })).toBe("1 Main St, CO")
    expect(formatVendorAddress({ addressLine1: null, addressLine2: null, city: null, state: null, postalCode: null })).toBeNull()
  })
})
