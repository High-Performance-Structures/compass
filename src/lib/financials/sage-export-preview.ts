import { canonicalFeeCostCode } from "@/lib/domain/financials/builder-fee-codes"
import { parseDateOnly, toCents as dollarsToCents } from "@/lib/format"
import { g703ByCostCode } from "@/lib/financials/pay-application-shares"
import {
  compassLineKey,
  mapToSageCostCode,
  type SageCatalogIndex,
  type SageCostCodeMapping,
} from "@/lib/financials/sage-export-codes"

/*
 * The Sage export preview for an owner pay application: what Compass would
 * send to Sage 100 Contractor, worked out from the draw without writing
 * anything. Pure, so the page, the print and the tests share it. Amounts in
 * are dollars (as pay application lines store them); amounts out are cents.
 */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const

function toCents(dollars: number): number {
  return dollarsToCents(dollars) ?? 0
}

// ---- header

/** "3" from "3", "03" or "App 3"; the raw text when it has no digits. */
export function applicationSequence(applicationNumber: string): string {
  const digits = /\d+/.exec(applicationNumber)?.[0]
  return digits ? String(Number(digits)) : applicationNumber.trim()
}

/** Sage's accounting period (month 1-12) and the month's name for a date. */
export function sagePeriod(date: string | null): { readonly period: number; readonly month: string; readonly year: number } | null {
  const parsed = parseDateOnly(date ? date.slice(0, 10) : null)
  if (!parsed) return null
  const month = MONTHS[parsed.getMonth()]
  return month ? { period: parsed.getMonth() + 1, month, year: parsed.getFullYear() } : null
}

/** "November 2026 Pay Request", from the period-to date. */
export function payRequestDescription(periodTo: string | null): string | null {
  const period = sagePeriod(periodTo)
  return period ? `${period.month} ${period.year} Pay Request` : null
}

// ---- lines

/** A pay application row as the export reads it (dollars). */
export type SageExportSourceLine = {
  readonly costCode: string
  readonly divisionCode: string
  readonly description: string
  readonly originalEstimate: number
  readonly totalChanges: number
  /** The part of totalChanges from variances. */
  readonly totalVariances: number
  readonly adjustedEstimate: number
  readonly previousWorkCompleted: number
  readonly currentWorkCompleted: number
  readonly storedMaterials: number
  readonly totalCompletedStored: number
  readonly retainageHeld: number
  readonly balanceToFinish: number
}

export type SageExportLine = {
  /** Shared with Sage's progress billing lines for reconciliation. */
  readonly key: string
  readonly costCode: string
  readonly divisionCode: string
  readonly description: string
  readonly mapping: SageCostCodeMapping
  readonly scheduledCents: number
  readonly changeOrderCents: number
  readonly varianceCents: number
  /** Scheduled value plus all changes. */
  readonly contractCents: number
  readonly previousCents: number
  readonly currentCents: number
  readonly storedCents: number
  readonly completedToDateCents: number
  readonly retainageCents: number
}

/** One line per cost code, as Sage keeps them, each mapped to its Sage cost code. */
export function sageExportLines(lines: readonly SageExportSourceLine[], index: SageCatalogIndex): readonly SageExportLine[] {
  const varianceByCode = new Map<string, number>()
  for (const line of lines) {
    const code = canonicalFeeCostCode(line.costCode)
    varianceByCode.set(code, (varianceByCode.get(code) ?? 0) + toCents(line.totalVariances))
  }
  const rows = g703ByCostCode(
    lines.map((line) => ({
      budgetRevisionLineId: null,
      csiDivision: line.divisionCode,
      costCode: line.costCode,
      description: line.description,
      originalEstimate: line.originalEstimate,
      totalChanges: line.totalChanges,
      adjustedEstimate: line.adjustedEstimate,
      previousWorkCompleted: line.previousWorkCompleted,
      currentWorkCompleted: line.currentWorkCompleted,
      storedMaterials: line.storedMaterials,
      totalCosts: line.totalCompletedStored,
      retainageHeld: line.retainageHeld,
      balanceToFinish: line.balanceToFinish,
    }))
  )
  return rows.map((row) => {
    const changes = toCents(row.totalChanges)
    const variances = varianceByCode.get(row.costCode) ?? 0
    return {
      key: compassLineKey(row.costCode),
      costCode: row.costCode,
      divisionCode: row.csiDivision,
      description: row.description,
      mapping: mapToSageCostCode(row.costCode, index),
      scheduledCents: toCents(row.originalEstimate),
      changeOrderCents: changes - variances,
      varianceCents: variances,
      contractCents: toCents(row.adjustedEstimate),
      previousCents: toCents(row.previousWorkCompleted),
      currentCents: toCents(row.currentWorkCompleted),
      storedCents: toCents(row.storedMaterials),
      completedToDateCents: toCents(row.totalCosts),
      retainageCents: toCents(row.retainageHeld),
    }
  })
}

// ---- change orders and variances

export type SageChangeOrderSource = {
  readonly id: string
  readonly recordType: "change_order" | "variance"
  readonly number: string
  readonly title: string
  readonly executedAt: string
  /** Set when the record is linked to a Sage change order. */
  readonly sageRecordId: string | null
  readonly lines: readonly { readonly costCode: string; readonly amountCents: number }[]
}

export type SageChangeOrderPreview = {
  readonly id: string
  readonly recordType: "change_order" | "variance"
  readonly sageName: string
  readonly title: string
  readonly executedAt: string
  readonly period: ReturnType<typeof sagePeriod>
  readonly amountCents: number
  readonly lines: readonly { readonly costCode: string; readonly amountCents: number; readonly mapping: SageCostCodeMapping }[]
  /** "linked" when Compass holds the Sage change order's id; otherwise Compass can't tell. */
  readonly inSage: "linked" | "unknown"
}

/** The change order's name in Sage: variances carry a "V-" prefix. */
export function sageChangeOrderName(number: string, recordType: "change_order" | "variance"): string {
  const trimmed = number.trim()
  if (recordType !== "variance") return trimmed
  return /^v-/i.test(trimmed) ? `V-${trimmed.slice(2)}` : `V-${trimmed}`
}

export function sageChangeOrderPreviews(
  changeOrders: readonly SageChangeOrderSource[],
  index: SageCatalogIndex
): readonly SageChangeOrderPreview[] {
  return [...changeOrders]
    .sort((left, right) => left.executedAt.localeCompare(right.executedAt) || left.number.localeCompare(right.number, undefined, { numeric: true }))
    .map((changeOrder) => {
      const byCode = new Map<string, number>()
      for (const line of changeOrder.lines) {
        const code = canonicalFeeCostCode(line.costCode)
        byCode.set(code, (byCode.get(code) ?? 0) + line.amountCents)
      }
      const lines = [...byCode.entries()].map(([costCode, amountCents]) => ({ costCode, amountCents, mapping: mapToSageCostCode(costCode, index) }))
      return {
        id: changeOrder.id,
        recordType: changeOrder.recordType,
        sageName: sageChangeOrderName(changeOrder.number, changeOrder.recordType),
        title: changeOrder.title,
        executedAt: changeOrder.executedAt,
        period: sagePeriod(changeOrder.executedAt),
        amountCents: lines.reduce((sum, line) => sum + line.amountCents, 0),
        lines,
        inSage: changeOrder.sageRecordId ? "linked" : "unknown",
      }
    })
}
