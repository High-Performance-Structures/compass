/*
 * Pure pay application line math (architecture standard, section 5): the
 * server computes each G703 line's stored totals from its stored inputs.
 * No database or network access.
 */

import { canonicalFeeCostCode } from "@/lib/domain/financials/builder-fee-codes"
import { distributeCents } from "@/lib/financials/pay-application-shares"

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

// ---- Shop tickets on a pay application

/** A G703 line a shop ticket amount can be added to. */
export type ShopTicketImportLine = {
  readonly id: string
  readonly costCode: string
  readonly adjustedEstimate: number
  readonly previousWorkCompleted: number
  readonly currentWorkCompleted: number
  readonly storedMaterials: number
}

/** One shop ticket line's amount (any rate kind) by cost code. */
export type ShopTicketAmount = {
  readonly ticketId: string
  readonly costCode: string
  readonly amountCents: number
}

/** What one ticket adds to one G703 line. */
export type ShopTicketContribution = {
  readonly ticketId: string
  readonly budgetLineId: string
  readonly amountCents: number
}

/**
 * What each ticket should add to each G703 line: its amounts per cost code,
 * spread across that code's lines (base budget and change-order or assembly
 * shares) by scheduled value, as pay applications already spread amounts.
 * Builder fee codes match under their canonical name. Amounts whose cost code
 * has no G703 line come back as `unmatched` and are not imported.
 */
export function shopTicketContributionTargets(
  lines: readonly Pick<ShopTicketImportLine, "id" | "costCode" | "adjustedEstimate">[],
  amounts: readonly ShopTicketAmount[]
): { readonly contributions: readonly ShopTicketContribution[]; readonly unmatched: readonly ShopTicketAmount[] } {
  const linesByCode = new Map<string, Pick<ShopTicketImportLine, "id" | "costCode" | "adjustedEstimate">[]>()
  for (const line of lines) {
    const code = canonicalFeeCostCode(line.costCode)
    linesByCode.set(code, [...(linesByCode.get(code) ?? []), line])
  }
  const totals = new Map<string, ShopTicketAmount>()
  for (const amount of amounts) {
    const code = canonicalFeeCostCode(amount.costCode.trim())
    const key = `${amount.ticketId}|${code}`
    const current = totals.get(key)
    totals.set(key, { ticketId: amount.ticketId, costCode: code, amountCents: (current?.amountCents ?? 0) + amount.amountCents })
  }
  const contributions: ShopTicketContribution[] = []
  const unmatched: ShopTicketAmount[] = []
  for (const total of totals.values()) {
    if (total.amountCents === 0) continue
    const codeLines = linesByCode.get(total.costCode)
    if (!codeLines) {
      unmatched.push(total)
      continue
    }
    const parts = distributeCents(
      total.amountCents,
      codeLines.map((line) => Math.max(0, toCents(line.adjustedEstimate)))
    )
    codeLines.forEach((line, index) => {
      const amountCents = parts[index] ?? 0
      if (amountCents !== 0) contributions.push({ ticketId: total.ticketId, budgetLineId: line.id, amountCents })
    })
  }
  return { contributions, unmatched }
}

export type ShopTicketContributionPlan = {
  /** Lines whose current work changes, with the new amount in dollars. */
  readonly lineChanges: readonly { readonly lineId: string; readonly currentWorkCompleted: number; readonly deltaCents: number }[]
  /** The contributions to keep for the tickets in scope once the plan is applied. */
  readonly contributions: readonly ShopTicketContribution[]
  /** Lines left unchanged because the new amount breaks a G703 line rule. */
  readonly blocked: readonly { readonly lineId: string; readonly costCode: string; readonly error: string }[]
}

/**
 * Move the tickets in scope from what they already added (`existing`) to
 * what they should add (`targets`). Each line changes by the difference only,
 * so a re-import never adds a ticket twice and an empty target takes a
 * ticket's amounts back off. A line whose new current work breaks
 * `payApplicationLineEntry` keeps its amounts and existing contributions.
 */
export function planShopTicketContributions(input: {
  readonly lines: readonly ShopTicketImportLine[]
  readonly existing: readonly ShopTicketContribution[]
  readonly targets: readonly ShopTicketContribution[]
}): ShopTicketContributionPlan {
  const sumByLine = (rows: readonly ShopTicketContribution[]): Map<string, number> => {
    const map = new Map<string, number>()
    for (const row of rows) map.set(row.budgetLineId, (map.get(row.budgetLineId) ?? 0) + row.amountCents)
    return map
  }
  const existingByLine = sumByLine(input.existing)
  const targetByLine = sumByLine(input.targets)
  const lineChanges: { lineId: string; currentWorkCompleted: number; deltaCents: number }[] = []
  const blocked: { lineId: string; costCode: string; error: string }[] = []
  const keepExisting = new Set<string>()
  for (const line of input.lines) {
    const deltaCents = (targetByLine.get(line.id) ?? 0) - (existingByLine.get(line.id) ?? 0)
    if (deltaCents === 0) continue
    const currentWorkCompleted = (toCents(line.currentWorkCompleted) + deltaCents) / 100
    const checked = payApplicationLineEntry({
      previousWorkCompleted: line.previousWorkCompleted,
      adjustedEstimate: line.adjustedEstimate,
      currentWorkCompleted,
      storedMaterials: line.storedMaterials,
      retainagePercent: 0,
    })
    if (!checked.success) {
      blocked.push({ lineId: line.id, costCode: line.costCode, error: checked.error })
      keepExisting.add(line.id)
      continue
    }
    lineChanges.push({ lineId: line.id, currentWorkCompleted: checked.entry.currentWorkCompleted, deltaCents })
  }
  const lineIds = new Set(input.lines.map((line) => line.id))
  const contributions = [
    ...input.targets.filter((row) => lineIds.has(row.budgetLineId) && !keepExisting.has(row.budgetLineId)),
    ...input.existing.filter((row) => keepExisting.has(row.budgetLineId)),
  ].filter((row) => row.amountCents !== 0)
  return { lineChanges, contributions, blocked }
}

/**
 * When a draft moves to a new budget revision and a cost code's lines are
 * replaced (its amounts spread across new shares), each ticket's amount on
 * that code is spread the same way onto the new lines, so what the ticket
 * added stays recorded and a later import still adds only the difference.
 */
export function respreadShopTicketContributions(
  existing: readonly ShopTicketContribution[],
  replacedLineCodes: ReadonlyMap<string, string>,
  newLinesByCode: ReadonlyMap<string, readonly { readonly id: string; readonly weightCents: number }[]>
): readonly ShopTicketContribution[] {
  const totals = new Map<string, { ticketId: string; costCode: string; amountCents: number }>()
  for (const row of existing) {
    const costCode = replacedLineCodes.get(row.budgetLineId)
    if (costCode === undefined) continue
    const key = `${row.ticketId}|${costCode}`
    const current = totals.get(key)
    totals.set(key, { ticketId: row.ticketId, costCode, amountCents: (current?.amountCents ?? 0) + row.amountCents })
  }
  return [...totals.values()].flatMap((total) => {
    const lines = newLinesByCode.get(total.costCode) ?? []
    const parts = distributeCents(
      total.amountCents,
      lines.map((line) => Math.max(0, line.weightCents))
    )
    return lines.flatMap((line, index) => {
      const amountCents = parts[index] ?? 0
      return amountCents === 0 ? [] : [{ ticketId: total.ticketId, budgetLineId: line.id, amountCents }]
    })
  })
}
