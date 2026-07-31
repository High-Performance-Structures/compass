import { z } from "zod/v4"

const money = z.number().finite().min(-1_000_000_000_000).max(1_000_000_000_000)
const MAX_PAY_APPLICATION_LINES = 150

export const sagePayApplicationHeaderSchema = z.object({
  sourceApplicationId: z.string().min(1).max(256),
  sourceRevision: z.string().min(1).max(256),
  sageJobId: z.string().min(1).max(256).nullable(),
  sageJobNumber: z.string().min(1).max(256).nullable(),
  applicationNumber: z.string().min(1).max(128),
  periodTo: z.iso.date().nullable(),
  status: z.string().min(1).max(64),
  originalContractSum: money,
  netChanges: money,
  contractSumToDate: money,
  totalCompletedStoredToDate: money,
  retainageHeld: money,
  totalEarnedLessRetainage: money,
  previousCertificates: money,
  currentPaymentDue: money,
  balanceToFinish: money,
})

export const sagePayApplicationLineSchema = z.object({
  sourceLineId: z.string().min(1).max(256),
  costCode: z.string().min(1).max(128),
  csiDivision: z.string().min(1).max(32),
  csiDivisionName: z.string().min(1).max(256),
  description: z.string().min(1).max(1000),
  originalEstimate: money,
  priorChanges: money,
  currentChanges: money,
  totalChanges: money,
  adjustedEstimate: money,
  previousWorkCompleted: money,
  currentWorkCompleted: money,
  storedMaterials: money,
  totalCompletedStoredToDate: money,
  retainageHeld: money,
  balanceToFinish: money,
  sortOrder: z.number().int().min(0),
})

export const sagePayApplicationSnapshotSchema = z.object({
  runId: z.uuid(),
  claimToken: z.uuid(),
  capturedAt: z.iso.datetime({ offset: true }),
  header: sagePayApplicationHeaderSchema,
  // The normalized application and all of its lines are committed in one D1
  // batch. This bound stays below the paid-plan query limit and approximate
  // per-invocation binding limit while preserving realistic G703 schedules.
  lines: z
    .array(sagePayApplicationLineSchema)
    .min(1)
    .max(MAX_PAY_APPLICATION_LINES),
})

export type SagePayApplicationHeader = z.infer<
  typeof sagePayApplicationHeaderSchema
>
export type SagePayApplicationLine = z.infer<
  typeof sagePayApplicationLineSchema
>
export type SagePayApplicationSnapshot = z.infer<
  typeof sagePayApplicationSnapshotSchema
>

export type SageReconciliationCheck = {
  readonly key: string
  readonly expected: number
  readonly actual: number
  readonly difference: number
  readonly passed: boolean
}

export type SagePayApplicationReconciliation = {
  readonly passed: boolean
  readonly rowCount: number
  readonly checks: readonly SageReconciliationCheck[]
  readonly duplicateSourceLineIds: readonly string[]
}

const CURRENCY_TOLERANCE = 0.02

function cents(value: number): number {
  return Math.round(value * 100) / 100
}

function total(
  lines: readonly SagePayApplicationLine[],
  select: (line: SagePayApplicationLine) => number
): number {
  return cents(lines.reduce((sum, line) => sum + select(line), 0))
}

function check(
  key: string,
  expected: number,
  actual: number
): SageReconciliationCheck {
  const normalizedExpected = cents(expected)
  const normalizedActual = cents(actual)
  const difference = cents(normalizedActual - normalizedExpected)
  return {
    key,
    expected: normalizedExpected,
    actual: normalizedActual,
    difference,
    passed: Math.abs(difference) <= CURRENCY_TOLERANCE,
  }
}

function duplicateLineIds(
  lines: readonly SagePayApplicationLine[]
): readonly string[] {
  const counts = new Map<string, number>()
  for (const line of lines) {
    counts.set(line.sourceLineId, (counts.get(line.sourceLineId) ?? 0) + 1)
  }
  return [...counts.entries()]
    .filter((entry) => entry[1] > 1)
    .map((entry) => entry[0])
    .sort()
}

export function normalizeSagePayApplicationSnapshot(
  snapshot: SagePayApplicationSnapshot
): SagePayApplicationSnapshot {
  return {
    ...snapshot,
    lines: [...snapshot.lines].sort((left, right) => {
      const sortDifference = left.sortOrder - right.sortOrder
      if (sortDifference !== 0) return sortDifference
      return left.sourceLineId.localeCompare(right.sourceLineId)
    }),
  }
}

export function reconcileSagePayApplicationSnapshot(
  snapshot: SagePayApplicationSnapshot
): SagePayApplicationReconciliation {
  const lines = snapshot.lines
  const checks: SageReconciliationCheck[] = [
    check(
      "header.contract_sum_to_date",
      snapshot.header.originalContractSum + snapshot.header.netChanges,
      snapshot.header.contractSumToDate
    ),
    check(
      "header.earned_less_retainage",
      snapshot.header.totalCompletedStoredToDate -
        snapshot.header.retainageHeld,
      snapshot.header.totalEarnedLessRetainage
    ),
    check(
      "header.current_payment_due",
      snapshot.header.totalEarnedLessRetainage -
        snapshot.header.previousCertificates,
      snapshot.header.currentPaymentDue
    ),
    check(
      "header.balance_to_finish",
      snapshot.header.contractSumToDate -
        snapshot.header.totalEarnedLessRetainage,
      snapshot.header.balanceToFinish
    ),
    check(
      "lines.original_contract_sum",
      snapshot.header.originalContractSum,
      total(lines, (line) => line.originalEstimate)
    ),
    check(
      "lines.net_changes",
      snapshot.header.netChanges,
      total(lines, (line) => line.totalChanges)
    ),
    check(
      "lines.contract_sum_to_date",
      snapshot.header.contractSumToDate,
      total(lines, (line) => line.adjustedEstimate)
    ),
    check(
      "lines.total_completed_stored",
      snapshot.header.totalCompletedStoredToDate,
      total(lines, (line) => line.totalCompletedStoredToDate)
    ),
    check(
      "lines.retainage",
      snapshot.header.retainageHeld,
      total(lines, (line) => line.retainageHeld)
    ),
    check(
      "lines.balance_plus_retainage",
      snapshot.header.balanceToFinish,
      total(
        lines,
        (line) => line.balanceToFinish + line.retainageHeld
      )
    ),
  ]

  for (const line of lines) {
    checks.push(
      check(
        `line.${line.sourceLineId}.total_changes`,
        line.priorChanges + line.currentChanges,
        line.totalChanges
      ),
      check(
        `line.${line.sourceLineId}.adjusted_estimate`,
        line.originalEstimate + line.totalChanges,
        line.adjustedEstimate
      ),
      check(
        `line.${line.sourceLineId}.completed_stored`,
        line.previousWorkCompleted +
          line.currentWorkCompleted +
          line.storedMaterials,
        line.totalCompletedStoredToDate
      ),
      check(
        `line.${line.sourceLineId}.balance`,
        line.adjustedEstimate - line.totalCompletedStoredToDate,
        line.balanceToFinish
      )
    )
  }

  const duplicateSourceLineIds = duplicateLineIds(lines)
  return {
    passed:
      duplicateSourceLineIds.length === 0 &&
      checks.every((item) => item.passed),
    rowCount: lines.length,
    checks,
    duplicateSourceLineIds,
  }
}

export async function hashSagePayApplicationSnapshot(
  snapshot: SagePayApplicationSnapshot
): Promise<string> {
  const normalized = normalizeSagePayApplicationSnapshot(snapshot)
  // Transport metadata changes every time the bridge captures the same Sage
  // revision. Hash only source-owned financial content so retries and later
  // sync runs remain idempotent.
  const encoded = new TextEncoder().encode(
    JSON.stringify({
      header: normalized.header,
      lines: normalized.lines,
    })
  )
  const digest = await crypto.subtle.digest("SHA-256", encoded)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}
