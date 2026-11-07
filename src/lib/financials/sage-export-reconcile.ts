import { toCents } from "@/lib/format"
import {
  normalizedSageRecordNumber,
  sageLineKey,
  sageRecordNumbersFor,
  type SageCatalogIndex,
} from "@/lib/financials/sage-export-codes"
import type { SageExportLine } from "@/lib/financials/sage-export-preview"

/*
 * Compass's pay application against Sage's latest progress billing for the
 * job (read from Sage, never written). Every difference is reported with its
 * amount; nothing is adjusted to make the two agree.
 */

/** A line of Sage's latest progress billing, as Compass stores the read (dollars). */
export type SageBillingLine = {
  readonly costCode: string
  readonly description: string
  readonly adjustedEstimate: number
  readonly totalCompletedStored: number
}

export type SageBillingHeader = {
  readonly applicationNumber: string
  readonly periodTo: string | null
  readonly capturedAt: string | null
  /** Dollars. */
  readonly contractSumToDate: number
  readonly totalCompletedStoredToDate: number
}

type SageLineComparison = {
  readonly key: string
  readonly label: string
  readonly presence: "both" | "compass_only" | "sage_only"
  readonly compassContractCents: number
  readonly sageContractCents: number
  readonly contractDifferenceCents: number
  /** Compass's previous completed against Sage's completed to date on its last application. */
  readonly compassPreviousCents: number
  readonly sageCompletedCents: number
  readonly previousDifferenceCents: number
  readonly mismatch: boolean
}

type SageTotalComparison = {
  readonly compassCents: number
  readonly sageCents: number
  readonly differenceCents: number
  readonly mismatch: boolean
}

export type SageReconciliation =
  | {
      readonly available: true
      readonly sageApplication: SageBillingHeader
      readonly lines: readonly SageLineComparison[]
      readonly contractToDate: SageTotalComparison
      readonly completedToDate: SageTotalComparison
      readonly mismatchCount: number
      /** Keys of Compass lines Sage's progress billing doesn't have yet ("Append as new line"). */
      readonly newToSage: readonly string[]
    }
  | { readonly available: false; readonly reason: string }

function cents(dollars: number): number {
  return toCents(dollars) ?? 0
}

function total(compassCents: number, sageCents: number): SageTotalComparison {
  const differenceCents = compassCents - sageCents
  return { compassCents, sageCents, differenceCents, mismatch: differenceCents !== 0 }
}

/**
 * Compare per cost code: Compass previous completed vs Sage completed to date,
 * and Compass contract (scheduled + changes) vs Sage contract; plus the
 * header totals.
 */
export function reconcileWithSage(input: {
  readonly lines: readonly SageExportLine[]
  readonly compassContractToDateCents: number
  readonly sage: { readonly header: SageBillingHeader; readonly lines: readonly SageBillingLine[] } | null
  readonly index: SageCatalogIndex
  /** Why there is no Sage data, when `sage` is null. */
  readonly unavailableReason: string
}): SageReconciliation {
  if (!input.sage) return { available: false, reason: input.unavailableReason }
  // Sage's line description can differ from its cost code's name ("Contingency"
  // on the "Contingency Reserve" record), so lines match by Sage record number
  // first; by name only when Compass doesn't know the record number.
  const compassKeyByRecordNumber = new Map<string, string>()
  for (const line of input.lines) {
    for (const number of sageRecordNumbersFor(line.costCode, line.mapping, input.index)) {
      if (!compassKeyByRecordNumber.has(number)) compassKeyByRecordNumber.set(number, line.key)
    }
  }
  // Learn record numbers the catalog lacks from Sage's read itself: a Sage line
  // whose name resolves to a Compass line lends its record number to that
  // line, so other Sage lines on the same record match it too. Only when the
  // record resolves to exactly one Compass line; never over a catalog number.
  const compassKeys = new Set(input.lines.map((line) => line.key))
  const learned = new Map<string, string | null>()
  for (const line of input.sage.lines) {
    const recordNumber = normalizedSageRecordNumber(line.costCode)
    if (!recordNumber || compassKeyByRecordNumber.has(recordNumber)) continue
    const nameKey = sageLineKey(line, input.index)
    if (!compassKeys.has(nameKey)) continue
    const previous = learned.get(recordNumber)
    learned.set(recordNumber, previous === undefined || previous === nameKey ? nameKey : null)
  }
  for (const [recordNumber, key] of learned) if (key) compassKeyByRecordNumber.set(recordNumber, key)
  const sageByKey = new Map<string, { label: string; contract: number; completed: number }>()
  for (const line of input.sage.lines) {
    const recordNumber = normalizedSageRecordNumber(line.costCode)
    const key = (recordNumber ? compassKeyByRecordNumber.get(recordNumber) : undefined) ?? sageLineKey(line, input.index)
    const current = sageByKey.get(key)
    sageByKey.set(key, {
      label: current?.label ?? line.description,
      contract: (current?.contract ?? 0) + cents(line.adjustedEstimate),
      completed: (current?.completed ?? 0) + cents(line.totalCompletedStored),
    })
  }
  const comparisons: SageLineComparison[] = []
  const newToSage = new Set<string>()
  const compassByKey = new Map<string, { label: string; contract: number; previous: number }>()
  for (const line of input.lines) {
    const current = compassByKey.get(line.key)
    compassByKey.set(line.key, {
      label: current?.label ?? `${line.costCode} ${line.description}`.trim(),
      contract: (current?.contract ?? 0) + line.contractCents,
      previous: (current?.previous ?? 0) + line.previousCents,
    })
  }
  for (const [key, compass] of compassByKey) {
    const sage = sageByKey.get(key)
    if (!sage) newToSage.add(key)
    const contractDifferenceCents = compass.contract - (sage?.contract ?? 0)
    const previousDifferenceCents = compass.previous - (sage?.completed ?? 0)
    comparisons.push({
      key,
      label: compass.label,
      presence: sage ? "both" : "compass_only",
      compassContractCents: compass.contract,
      sageContractCents: sage?.contract ?? 0,
      contractDifferenceCents,
      compassPreviousCents: compass.previous,
      sageCompletedCents: sage?.completed ?? 0,
      previousDifferenceCents,
      // A new line with nothing billed before only needs appending.
      mismatch: sage ? contractDifferenceCents !== 0 || previousDifferenceCents !== 0 : previousDifferenceCents !== 0,
    })
  }
  for (const [key, sage] of sageByKey) {
    if (compassByKey.has(key)) continue
    comparisons.push({
      key,
      label: sage.label,
      presence: "sage_only",
      compassContractCents: 0,
      sageContractCents: sage.contract,
      contractDifferenceCents: -sage.contract,
      compassPreviousCents: 0,
      sageCompletedCents: sage.completed,
      previousDifferenceCents: -sage.completed,
      mismatch: sage.contract !== 0 || sage.completed !== 0,
    })
  }
  const compassPrevious = input.lines.reduce((sum, line) => sum + line.previousCents, 0)
  const contractToDate = total(input.compassContractToDateCents, cents(input.sage.header.contractSumToDate))
  const completedToDate = total(compassPrevious, cents(input.sage.header.totalCompletedStoredToDate))
  return {
    available: true,
    sageApplication: input.sage.header,
    lines: comparisons,
    contractToDate,
    completedToDate,
    mismatchCount:
      comparisons.filter((line) => line.mismatch).length + (contractToDate.mismatch ? 1 : 0) + (completedToDate.mismatch ? 1 : 0),
    newToSage: [...newToSage],
  }
}
