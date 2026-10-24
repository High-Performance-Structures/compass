/** Which agreement a job's invoice or payment belongs to. */
export const BILLING_SCOPES = ["construction", "preconstruction"] as const

export type BillingScope = (typeof BILLING_SCOPES)[number]

export function isBillingScope(value: unknown): value is BillingScope {
  return value === "construction" || value === "preconstruction"
}
