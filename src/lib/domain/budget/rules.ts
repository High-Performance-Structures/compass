/*
 * Pure pay application line math (architecture standard, section 5): the
 * server computes each G703 line's stored totals from its stored inputs.
 * No database or network access.
 */

export type BudgetLineProgressInput = {
  readonly previousWorkCompleted: number
  readonly currentWorkCompleted: number
  readonly storedMaterials: number
  readonly adjustedEstimate: number
}

export type BudgetLineProgress = {
  readonly priorCosts: number
  readonly currentCosts: number
  readonly totalCosts: number
  readonly percentComplete: number
  readonly balanceToFinish: number
}

/** Prior, current and to-date totals, percent complete (one decimal) and balance to finish. */
export function budgetLineProgress(input: BudgetLineProgressInput): BudgetLineProgress {
  const totalCompletedStored = input.previousWorkCompleted + input.currentWorkCompleted + input.storedMaterials
  return {
    priorCosts: input.previousWorkCompleted,
    currentCosts: input.currentWorkCompleted + input.storedMaterials,
    totalCosts: totalCompletedStored,
    percentComplete:
      input.adjustedEstimate > 0 ? Math.round((totalCompletedStored / input.adjustedEstimate) * 1_000) / 10 : 0,
    balanceToFinish: input.adjustedEstimate - totalCompletedStored,
  }
}

/** Retainage held at a percent (0–100) of completed and stored work, to the cent. */
export function retainageAtPercent(totalCompletedStored: number, retainagePercent: number): number {
  return Math.round(totalCompletedStored * retainagePercent) / 100
}

/** Retainage held at a line's existing rate (a fraction), to the cent. */
export function retainageAtRate(totalCompletedStored: number, rate: number): number {
  return Math.round(totalCompletedStored * rate * 100) / 100
}
