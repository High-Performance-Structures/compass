/** Keep directory-to-project vendor roles consistent across single and bulk additions. */
export function vendorCategoryToContactType(category: string): "internal" | "supplier" | "subcontractor" {
  const lower = category.toLowerCase()
  if (lower.includes("internal")) return "internal"
  if (lower.includes("supplier") || lower.includes("miscellaneous")) return "supplier"
  return "subcontractor"
}

export function isDirectoryAssignable(category: string): boolean {
  const lower = category.toLowerCase()
  return !lower.includes("bank") && !lower.includes("lender")
}
