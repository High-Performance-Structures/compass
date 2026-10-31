
export type BillingScope =
  | "construction"
  | "preconstruction"

export function isBillingScope(value: unknown): value is BillingScope {
  return value === "construction" || value === "preconstruction"
}
