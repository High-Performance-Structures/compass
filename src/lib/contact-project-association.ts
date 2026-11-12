import { JOB_ROLE_CONTACT_TYPE, vendorTypeNamed, type VendorTypeSetting } from "@/lib/feature-settings/vendor-types-settings"

export type VendorContactType = "internal" | "supplier" | "subcontractor"

/** Banks and lenders are never picked for a job or invited. */
function isFinancialInstitution(category: string): boolean {
  const lower = category.trim().toLowerCase()
  return lower.includes("bank") || lower.includes("lender")
}

/**
 * How a vendor with this directory type is listed on a job, or null when it
 * is never added (a bank or lender). Every other vendor can be picked for a
 * job (RFIs, RFQs, POs, to-dos, the schedule): a type on the company's
 * vendor-types list is listed as its job role, a type with no job role as a
 * subcontractor it can't invite (vendorCanBeInvited). A name not on the list
 * (an older Compass category) keeps the earlier reading: Internal stays
 * internal, "supplier" or "miscellaneous" are suppliers, anything else a
 * subcontractor.
 */
export function vendorJobContactType(category: string, types: readonly VendorTypeSetting[]): VendorContactType | null {
  const lower = category.trim().toLowerCase()
  if (lower.includes("internal")) return "internal"
  if (isFinancialInstitution(category)) return null
  const listed = vendorTypeNamed(types, category)
  if (listed) return JOB_ROLE_CONTACT_TYPE[listed.jobRole]
  return lower.includes("supplier") || lower.includes("miscellaneous") ? "supplier" : "subcontractor"
}

/**
 * Whether people at a vendor of this type may be invited to Compass. A type
 * with no job role can be picked for a job but not invited; changing the
 * vendor's type (or that type's job role in Settings) makes it invitable.
 */
export function vendorCanBeInvited(category: string, types: readonly VendorTypeSetting[]): boolean {
  if (isFinancialInstitution(category)) return false
  const listed = vendorTypeNamed(types, category)
  return listed ? listed.jobRole !== "none" : true
}
