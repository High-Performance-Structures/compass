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

export type PayApplicationLineEntryInput = {
  readonly previousWorkCompleted: number
  readonly adjustedEstimate: number
  /** Null when the typed value is not a number. */
  readonly currentWorkCompleted: number | null
  readonly storedMaterials: number | null
  readonly retainagePercent: number | null
}

export type PayApplicationLineEntry = {
  readonly currentWorkCompleted: number
  readonly storedMaterials: number
  readonly retainagePercent: number
  readonly totalCompletedStored: number
}

const toCents = (value: number): number => Math.round(value * 100)

/**
 * Checks what staff enter on a draft G703 line. Work completed this period may
 * be negative to credit back work billed on an earlier draw, as long as the
 * line's total completed and stored to date stays at zero or more. Stored
 * materials and retainage percent are never negative, and the total cannot
 * pass the line's adjusted scheduled value. Amounts are rounded to the cent.
 */
export function payApplicationLineEntry(
  input: PayApplicationLineEntryInput
):
  | { readonly success: true; readonly entry: PayApplicationLineEntry }
  | { readonly success: false; readonly error: string } {
  const { currentWorkCompleted, storedMaterials, retainagePercent } = input
  if (currentWorkCompleted === null || !Number.isFinite(currentWorkCompleted)) {
    return { success: false, error: "Current work must be a dollar amount." }
  }
  if (storedMaterials === null || !Number.isFinite(storedMaterials) || storedMaterials < 0) {
    return { success: false, error: "Stored materials must be zero or greater." }
  }
  if (retainagePercent === null || !Number.isFinite(retainagePercent) || retainagePercent < 0) {
    return { success: false, error: "Retainage must be zero or greater." }
  }
  if (retainagePercent > 100) return { success: false, error: "Retainage cannot exceed 100%." }
  const currentCents = toCents(currentWorkCompleted)
  const storedCents = toCents(storedMaterials)
  // Sum in cents so a credit that exactly reverses earlier work lands on zero.
  const totalCents = toCents(input.previousWorkCompleted) + currentCents + storedCents
  if (totalCents < 0) {
    return {
      success: false,
      error: "Current work can credit back earlier billing, but completed and stored to date cannot go below zero.",
    }
  }
  if (totalCents > toCents(input.adjustedEstimate) + 1) {
    return {
      success: false,
      error: "Completed work and stored materials cannot exceed the adjusted budget line.",
    }
  }
  return {
    success: true,
    entry: {
      currentWorkCompleted: currentCents / 100,
      storedMaterials: storedCents / 100,
      retainagePercent: Math.round(retainagePercent * 100) / 100,
      totalCompletedStored: totalCents / 100,
    },
  }
}
