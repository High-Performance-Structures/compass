import { canonicalFeeCostCode } from "@/lib/domain/financials/builder-fee-codes"
import {
  BUDGET_PROJECTION_SOURCE,
  IMPORTED_DRAW_UNBILLED_STATUSES,
  SAGE_SNAPSHOT_SOURCE,
} from "@/lib/domain/financials/rules"
import { distributeCents, shareKey } from "@/lib/financials/pay-application-shares"
import { toCents } from "@/lib/format"

/*
 * Completion on the contract budget view. A contract budget revision's budget
 * view carries no progress of its own, and pay applications stay on the
 * revision they were built on, so when the budget is rebuilt (say after
 * reclassifying change orders as variances) the newest revision has no pay
 * application. The budget view then shows the latest pay application's
 * completion, from any revision, mapped by cost code: by assembly where the
 * pay application's assemblies line up with the budget's, else spread over
 * the cost code's lines by budget. Pure, so the page and the tests share it.
 */

type ApplicationRow = { readonly id: string; readonly sourceSystem: string; readonly status: string }

const UNBILLED: ReadonlySet<string> = new Set(IMPORTED_DRAW_UNBILLED_STATUSES)

/** Whether the row is a contract budget revision's budget view. */
export function isBudgetProjection(application: ApplicationRow | null): boolean {
  return application?.sourceSystem === BUDGET_PROJECTION_SOURCE
}

/**
 * The newest pay application that counts for completion: not a budget view,
 * not a Sage read snapshot, not voided, replaced or still being written.
 * Compass draws and imported draws both count. `applications` come newest
 * first and already filtered to what the viewer may see.
 */
export function latestProgressApplication<T extends ApplicationRow>(applications: readonly T[]): T | null {
  return (
    applications.find(
      (application) =>
        application.sourceSystem !== BUDGET_PROJECTION_SOURCE &&
        application.sourceSystem !== SAGE_SNAPSHOT_SOURCE &&
        !UNBILLED.has(application.status)
    ) ?? null
  )
}

/** A pay application line's completion (dollars). */
export type ProgressLine = {
  readonly costCode: string
  readonly assemblyKey: string | null
  readonly priorCosts: number
  readonly currentCosts: number
  readonly totalCosts: number
  readonly retainageHeld: number
}

type BudgetLine = {
  readonly costCode: string
  readonly adjustedEstimate: number
  readonly priorCosts: number
  readonly currentCosts: number
  readonly totalCosts: number
  readonly percentComplete: number
  readonly balanceToFinish: number
  readonly retainageHeld: number
}

type Amounts = { prior: number; current: number; total: number; retainage: number }

const ZERO: Amounts = { prior: 0, current: 0, total: 0, retainage: 0 }

function cents(dollars: number): number {
  return toCents(dollars) ?? 0
}

function add(left: Amounts, line: ProgressLine): Amounts {
  return {
    prior: left.prior + cents(line.priorCosts),
    current: left.current + cents(line.currentCosts),
    total: left.total + cents(line.totalCosts),
    retainage: left.retainage + cents(line.retainageHeld),
  }
}

function percent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0
  return Math.round((numerator / denominator) * 1000) / 10
}

/** Amounts for each budget line of one cost code (cents), in the lines' order. */
function amountsForCode(
  lines: readonly { readonly line: BudgetLine; readonly assemblyKey: string | null }[],
  progress: readonly ProgressLine[]
): readonly Amounts[] {
  const byShare = new Map<string, Amounts>()
  for (const row of progress) {
    const key = shareKey("", row.assemblyKey)
    byShare.set(key, add(byShare.get(key) ?? ZERO, row))
  }
  const budgetKeys = lines.map((entry) => shareKey("", entry.assemblyKey))
  const uniqueBudgetKeys = new Set(budgetKeys)
  const matchesByAssembly =
    uniqueBudgetKeys.size === budgetKeys.length && [...byShare.keys()].every((key) => uniqueBudgetKeys.has(key))
  if (matchesByAssembly) return budgetKeys.map((key) => byShare.get(key) ?? ZERO)
  const total = [...byShare.values()].reduce(
    (sum, amounts) => ({
      prior: sum.prior + amounts.prior,
      current: sum.current + amounts.current,
      total: sum.total + amounts.total,
      retainage: sum.retainage + amounts.retainage,
    }),
    ZERO
  )
  const weights = lines.map((entry) => Math.max(0, cents(entry.line.adjustedEstimate)))
  const prior = distributeCents(total.prior, weights)
  const current = distributeCents(total.current, weights)
  const completed = distributeCents(total.total, weights)
  const retainage = distributeCents(total.retainage, weights)
  return lines.map((_, index) => ({
    prior: prior[index] ?? 0,
    current: current[index] ?? 0,
    total: completed[index] ?? 0,
    retainage: retainage[index] ?? 0,
  }))
}

/**
 * The budget lines with the pay application's completion on them. Builder
 * fees match under either spelling. A budget line with no completion keeps
 * zero; the budget amounts themselves never change.
 */
export function withPayApplicationProgress<T extends BudgetLine>(
  lines: readonly T[],
  progress: readonly ProgressLine[],
  assemblyKeyOf: (line: T) => string | null = () => null
): readonly T[] {
  const progressByCode = new Map<string, ProgressLine[]>()
  for (const row of progress) {
    const code = canonicalFeeCostCode(row.costCode.trim())
    const rows = progressByCode.get(code) ?? []
    rows.push(row)
    progressByCode.set(code, rows)
  }
  const entriesByCode = new Map<string, { readonly index: number; readonly line: T; readonly assemblyKey: string | null }[]>()
  lines.forEach((line, index) => {
    const code = canonicalFeeCostCode(line.costCode.trim())
    const entries = entriesByCode.get(code) ?? []
    entries.push({ index, line, assemblyKey: assemblyKeyOf(line) })
    entriesByCode.set(code, entries)
  })
  const amounts = new Map<number, Amounts>()
  for (const [code, entries] of entriesByCode) {
    const rows = progressByCode.get(code)
    if (!rows) continue
    amountsForCode(entries, rows).forEach((value, position) => {
      const entry = entries[position]
      if (entry) amounts.set(entry.index, value)
    })
  }
  return lines.map((line, index) => {
    const value = amounts.get(index) ?? ZERO
    const totalCosts = value.total / 100
    return {
      ...line,
      priorCosts: value.prior / 100,
      currentCosts: value.current / 100,
      totalCosts,
      retainageHeld: value.retainage / 100,
      percentComplete: percent(totalCosts, line.adjustedEstimate),
      balanceToFinish: (cents(line.adjustedEstimate) - value.total) / 100,
    }
  })
}
