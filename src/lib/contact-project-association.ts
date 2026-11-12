import type { VendorTypeSetting } from "@/lib/feature-settings/vendor-types-settings"

export type VendorContactType = "internal" | "supplier" | "subcontractor"

/**
 * How a vendor with this directory type joins a job, or null when it never
 * does. A type on the company's vendor-types list decides by its job role
 * ("none" never joins). A name not on the list (an older Compass category
 * not yet moved to a Sage type) keeps the earlier reading: Internal stays
 * internal, banks and lenders never join, "supplier" or "miscellaneous" are
 * suppliers, anything else a subcontractor.
 */
export function vendorJobContactType(category: string, types: readonly VendorTypeSetting[]): VendorContactType | null {
  const lower = category.trim().toLowerCase()
  if (lower.includes("internal")) return "internal"
  const listed = types.find((type) => type.name.trim().toLowerCase() === lower)
  if (listed) return listed.jobRole === "none" ? null : listed.jobRole
  if (lower.includes("bank") || lower.includes("lender")) return null
  return lower.includes("supplier") || lower.includes("miscellaneous") ? "supplier" : "subcontractor"
}
