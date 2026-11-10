/**
 * Pay request page layout: the "Work on" areas (kept in `?work=`) and which
 * G703 groups open by themselves. Layout only; billing math lives elsewhere.
 */
import { overBilledAmount } from "@/lib/financials/pay-application-line-checks"

export const PAY_REQUEST_WORK_AREAS = [
  {
    value: "billing",
    label: "Billing",
    description: "Bill the G703 by group percent or line by line.",
  },
  {
    value: "sage",
    label: "Sage",
    description: "Sage link and comparison, what to enter in Sage, the AR invoice, and the export preview.",
  },
  {
    value: "payments",
    label: "Payments",
    description: "Payments received against this billed draw.",
  },
  {
    value: "shop-tickets",
    label: "Shop tickets",
    description: "Shop tickets imported onto this pay request.",
  },
] as const

export type PayRequestWorkArea = (typeof PAY_REQUEST_WORK_AREAS)[number]["value"]

export const DEFAULT_PAY_REQUEST_WORK_AREA: PayRequestWorkArea = "billing"

export function isPayRequestWorkArea(value: string): value is PayRequestWorkArea {
  return PAY_REQUEST_WORK_AREAS.some((area) => area.value === value)
}

/** The `?work=` search param as an area; missing or unknown values open Billing. */
export function parsePayRequestWorkArea(raw: string | readonly string[] | null | undefined): PayRequestWorkArea {
  const value = typeof raw === "string" ? raw : raw?.[0]
  return value !== undefined && isPayRequestWorkArea(value) ? value : DEFAULT_PAY_REQUEST_WORK_AREA
}

type FoldableLine = { readonly adjustedEstimate: number; readonly totalCompletedStored: number }

/**
 * Groups start folded; the ones holding an over-billed line open by themselves
 * so the warning is never hidden behind a fold.
 */
export function payRequestGroupsOpenByDefault(
  groups: readonly { readonly id: string; readonly lines: readonly FoldableLine[] }[]
): readonly string[] {
  return groups.filter((group) => group.lines.some((line) => overBilledAmount(line) > 0)).map((group) => group.id)
}

/** The Sage comparison opens by itself when Compass and Sage disagree. */
export function sageReconciliationNeedsAttention(
  reconciliation: { readonly mismatchCount: number; readonly totals: { readonly mismatch: boolean } } | null
): boolean {
  return reconciliation !== null && (reconciliation.mismatchCount > 0 || reconciliation.totals.mismatch)
}
