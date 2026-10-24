import type { EstimateLedgerLine } from "@/lib/financials/estimate-ledger"

export type VersionDifferenceKind = "added" | "removed" | "changed"

export type VersionDifferenceLine = {
  readonly lineNumber: number
  readonly kind: VersionDifferenceKind
  readonly description: string
  readonly phaseCode: string
  readonly costCode: string
  readonly previousAmountCents: number
  readonly newAmountCents: number
  /** New minus previous, at the client price. */
  readonly amountCents: number
}

export type VersionDifference = {
  readonly lines: readonly VersionDifferenceLine[]
  readonly previousTotalCents: number
  readonly newTotalCents: number
  readonly netChangeCents: number
}

type Side = {
  readonly description: string
  readonly phaseCode: string
  readonly costCode: string
  readonly amountCents: number
}

function normalized(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ")
}

function side(line: EstimateLedgerLine): Side {
  return {
    description: line.description,
    phaseCode: line.divisionCode,
    costCode: line.costCode,
    amountCents: line.lineTotalCents,
  }
}

/**
 * Line-by-line differences between two versions of a contract estimate at
 * the client price. Lines are matched within a cost code, by description
 * first and then in order, because re-imported versions don't keep line ids.
 * Unchanged lines are left out; the differences sum to the net change.
 */
export function estimateVersionDifference(
  previous: readonly EstimateLedgerLine[],
  next: readonly EstimateLedgerLine[]
): VersionDifference {
  const byCode = new Map<string, { previous: Side[]; next: Side[] }>()
  const group = (costCode: string) => {
    const existing = byCode.get(costCode)
    if (existing) return existing
    const created = { previous: [] as Side[], next: [] as Side[] }
    byCode.set(costCode, created)
    return created
  }
  for (const line of previous) group(line.costCode).previous.push(side(line))
  for (const line of next) group(line.costCode).next.push(side(line))

  const drafts: Omit<VersionDifferenceLine, "lineNumber">[] = []
  const push = (before: Side | null, after: Side | null) => {
    const previousAmountCents = before?.amountCents ?? 0
    const newAmountCents = after?.amountCents ?? 0
    const amountCents = newAmountCents - previousAmountCents
    const descriptionChanged =
      before !== null && after !== null && normalized(before.description) !== normalized(after.description)
    if (amountCents === 0 && !descriptionChanged) return
    const shown = after ?? before
    if (!shown) return
    drafts.push({
      kind: before === null ? "added" : after === null ? "removed" : "changed",
      description: descriptionChanged && before ? `${after?.description ?? ""} (was: ${before.description})` : shown.description,
      phaseCode: shown.phaseCode,
      costCode: shown.costCode,
      previousAmountCents,
      newAmountCents,
      amountCents,
    })
  }

  for (const [, sides] of [...byCode.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const unmatchedNext = [...sides.next]
    const unmatchedPrevious: Side[] = []
    for (const before of sides.previous) {
      const index = unmatchedNext.findIndex((after) => normalized(after.description) === normalized(before.description))
      if (index === -1) {
        unmatchedPrevious.push(before)
        continue
      }
      const [after] = unmatchedNext.splice(index, 1)
      push(before, after ?? null)
    }
    // Leftovers in the same cost code are the same scope reworded.
    const pairs = Math.max(unmatchedPrevious.length, unmatchedNext.length)
    for (let index = 0; index < pairs; index += 1) {
      push(unmatchedPrevious[index] ?? null, unmatchedNext[index] ?? null)
    }
  }

  const previousTotalCents = previous.reduce((sum, line) => sum + line.lineTotalCents, 0)
  const newTotalCents = next.reduce((sum, line) => sum + line.lineTotalCents, 0)
  return {
    lines: drafts.map((line, index) => ({ lineNumber: index + 1, ...line })),
    previousTotalCents,
    newTotalCents,
    netChangeCents: newTotalCents - previousTotalCents,
  }
}
