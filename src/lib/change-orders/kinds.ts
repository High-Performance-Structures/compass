import type { ChangeOrderBudgetTreatment } from "@/lib/change-orders/rebaseline"

/**
 * How a change order is built. Staff choose the first three; a
 * contract-version change order is created when a newer contract-estimate
 * version is accepted. Older change orders have no kind and keep the cost
 * lines they were recorded with.
 * - estimate: priced with its own change-order estimate; accepting the
 *   estimate executes it and updates the budget.
 * - description: documents a scope or contract-language change with no cost.
 * - replacement: a newer contract-estimate version replaces the baseline.
 * - contract_version: the line-by-line differences of an accepted version.
 */
export const CHANGE_ORDER_KINDS = ["estimate", "description", "replacement", "contract_version"] as const
export type ChangeOrderKind = (typeof CHANGE_ORDER_KINDS)[number]

/** The kinds staff can choose when creating or editing a change order. */
export const CHOOSABLE_CHANGE_ORDER_KINDS = ["estimate", "description", "replacement"] as const
export type ChoosableChangeOrderKind = (typeof CHOOSABLE_CHANGE_ORDER_KINDS)[number]

export function isChangeOrderKind(value: unknown): value is ChangeOrderKind {
  return typeof value === "string" && CHANGE_ORDER_KINDS.some((kind) => kind === value)
}

export function isChoosableChangeOrderKind(value: unknown): value is ChoosableChangeOrderKind {
  return value === "estimate" || value === "description" || value === "replacement"
}

export function budgetTreatmentForKind(kind: ChangeOrderKind): ChangeOrderBudgetTreatment {
  return kind === "replacement" ? "baseline_replacement" : "additive"
}

export function changeOrderKindLabel(kind: ChangeOrderKind | null): string {
  switch (kind) {
    case "estimate":
      return "Priced with an estimate"
    case "description":
      return "Description only (no cost)"
    case "replacement":
      return "Replace contract estimate"
    case "contract_version":
      return "Contract estimate version changes"
    case null:
      return "Recorded cost lines"
  }
}
