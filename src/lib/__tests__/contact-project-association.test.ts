import { describe, expect, it } from "vitest"

import { isDirectoryAssignable, vendorCategoryToContactType } from "@/lib/contact-project-association"

describe("vendor project association rules", () => {
  it("uses the same supplier/subcontractor categories as individual project contacts", () => {
    expect(vendorCategoryToContactType("Supplier")).toBe("supplier")
    expect(vendorCategoryToContactType("Miscellaneous Vendor")).toBe("supplier")
    expect(vendorCategoryToContactType("Subcontractor")).toBe("subcontractor")
    expect(vendorCategoryToContactType("Internal")).toBe("internal")
  })

  it("does not bulk-assign financial institutions", () => {
    expect(isDirectoryAssignable("Bank / Lender")).toBe(false)
    expect(isDirectoryAssignable("Supplier")).toBe(true)
  })
})
