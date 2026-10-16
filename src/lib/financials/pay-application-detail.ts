/** How much of a pay application the client sees. */
export const PAY_APPLICATION_OWNER_DETAILS = [
  "division_percent",
  "division",
  "cost_code",
] as const

export type PayApplicationOwnerDetail =
  (typeof PAY_APPLICATION_OWNER_DETAILS)[number]

export const PAY_APPLICATION_OWNER_DETAIL_LABELS: Readonly<
  Record<PayApplicationOwnerDetail, string>
> = {
  division_percent: "Division, % complete only",
  division: "Division with amounts",
  cost_code: "Cost code with amounts",
}

export function isPayApplicationOwnerDetail(
  value: unknown
): value is PayApplicationOwnerDetail {
  return PAY_APPLICATION_OWNER_DETAILS.some((detail) => detail === value)
}

export type PercentBillingLine = {
  readonly costCode: string
  readonly adjustedEstimate: number
  readonly previousWorkCompleted: number
  readonly storedMaterials: number
}

/**
 * Work completed this period that brings a G703 line to `percentComplete`
 * of its scheduled value, counting previous work and stored materials.
 */
export function currentWorkForPercent(
  line: PercentBillingLine,
  percentComplete: number
):
  | { readonly success: true; readonly currentWorkCompleted: number }
  | { readonly success: false; readonly error: string } {
  if (!Number.isFinite(percentComplete) || percentComplete < 0 || percentComplete > 100) {
    return { success: false, error: "Percent complete must be between 0 and 100." }
  }
  const targetCents = Math.round(line.adjustedEstimate * percentComplete)
  const alreadyCents =
    Math.round(line.previousWorkCompleted * 100) + Math.round(line.storedMaterials * 100)
  if (targetCents < alreadyCents) {
    return {
      success: false,
      error: `${line.costCode} is already billed past ${percentComplete}% including stored materials.`,
    }
  }
  return { success: true, currentWorkCompleted: (targetCents - alreadyCents) / 100 }
}
