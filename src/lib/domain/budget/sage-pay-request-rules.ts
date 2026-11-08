import { canonicalFeeCostCode, isBuilderFeeCostCode } from "@/lib/domain/financials/builder-fee-codes"
import { toCents } from "@/lib/format"
import { compassLineKey, sageLineKey, type SageCatalogIndex } from "@/lib/financials/sage-export-codes"
import { applicationSequence } from "@/lib/financials/sage-export-preview"

/*
 * Pay requests built in Sage and synced into Compass (pure; no database).
 * A Sage progress billing's G703 lines map onto Compass cost codes with the
 * same matching the Sage export preview uses; a Compass pay application with
 * the same number is compared line by line; and issued shop tickets the
 * synced billing plainly covers are found so they count as billed.
 * Amounts in are dollars (as the snapshot and G703 rows store them); amounts
 * compared are cents.
 */

/** A G703 line of Sage's progress billing, as the read snapshot stores it (dollars). */
export type SageSnapshotLine = {
  readonly sourceLineId: string
  readonly costCode: string
  readonly csiDivision: string
  readonly csiDivisionName: string
  readonly description: string
  readonly originalEstimate: number
  readonly totalChanges: number
  readonly adjustedEstimate: number
  readonly previousWorkCompleted: number
  readonly currentWorkCompleted: number
  readonly storedMaterials: number
  readonly totalCompletedStoredToDate: number
  readonly retainageHeld: number
  readonly balanceToFinish: number
  readonly sortOrder: number
  /** Sage's Taxable flag on the line; bridges before snapshot v4 leave it out. */
  readonly taxable?: boolean
}

/** A Compass cost code the project already bills on (its contract budget). */
export type CompassCostCode = {
  readonly costCode: string
  readonly divisionCode: string
  readonly divisionName: string
  readonly description: string
}

/** A Sage line placed on a Compass cost code. */
export type SyncedPayRequestLine = SageSnapshotLine & {
  readonly compassCostCode: string
  readonly divisionCode: string
  readonly divisionName: string
  readonly compassDescription: string
  /** False when no Compass cost code matched; the line keeps Sage's own text. */
  readonly mapped: boolean
}

const CSI_KEY = /^\d{2} \d{2} \d{2}(\.\d{2})?$/

/**
 * Each Sage line on the Compass cost code it bills: the project's own
 * contract budget code with the same key first, then the CSI code or builder
 * fee name Sage's text carries. A line nothing matches keeps Sage's
 * description as its cost code and is flagged, never guessed.
 */
export function mapSageLinesToCompass(
  lines: readonly SageSnapshotLine[],
  input: { readonly index: SageCatalogIndex; readonly compassCodes: readonly CompassCostCode[] }
): readonly SyncedPayRequestLine[] {
  const byKey = new Map<string, CompassCostCode>()
  for (const code of input.compassCodes) {
    const key = compassLineKey(code.costCode)
    if (!byKey.has(key)) byKey.set(key, code)
  }
  return [...lines]
    .sort((left, right) => left.sortOrder - right.sortOrder || left.sourceLineId.localeCompare(right.sourceLineId))
    .map((line) => {
      const key = sageLineKey(line, input.index)
      const known = byKey.get(key)
      if (known) {
        return {
          ...line,
          compassCostCode: known.costCode,
          divisionCode: known.divisionCode,
          divisionName: known.divisionName,
          compassDescription: known.description,
          mapped: true,
        }
      }
      if (CSI_KEY.test(key) || isBuilderFeeCostCode(canonicalFeeCostCode(key))) {
        const division = CSI_KEY.test(key) ? key.slice(0, 2) : line.csiDivision
        return {
          ...line,
          compassCostCode: key,
          divisionCode: division,
          divisionName: line.csiDivisionName,
          compassDescription: line.description,
          mapped: true,
        }
      }
      return {
        ...line,
        compassCostCode: line.description,
        divisionCode: line.csiDivision,
        divisionName: line.csiDivisionName,
        compassDescription: line.description,
        mapped: false,
      }
    })
}

/** Whether a Compass pay application number and Sage's application number are the same draw ("PAYAPP-003" and "3"). */
export function sameApplicationNumber(compassNumber: string, sageNumber: string): boolean {
  const left = applicationSequence(compassNumber)
  const right = applicationSequence(sageNumber)
  return /^\d+$/.test(left) && left === right
}

// ---- reconciliation of a Compass pay application against Sage's

/** A G703 row as reconciliation reads it (dollars). */
export type ReconcileLine = {
  readonly costCode: string
  readonly description: string
  readonly adjustedEstimate: number
  readonly previousWorkCompleted: number
  readonly currentWorkCompleted: number
  readonly storedMaterials: number
}

type PayRequestReconciliationRow = {
  readonly key: string
  readonly label: string
  readonly presence: "both" | "compass_only" | "sage_only"
  readonly compassContractCents: number
  readonly sageContractCents: number
  /** This period: current work plus stored materials. */
  readonly compassThisPeriodCents: number
  readonly sageThisPeriodCents: number
  readonly compassToDateCents: number
  readonly sageToDateCents: number
  readonly mismatch: boolean
}

export type PayRequestReconciliation = {
  readonly rows: readonly PayRequestReconciliationRow[]
  readonly totals: Omit<PayRequestReconciliationRow, "key" | "label" | "presence">
  readonly mismatchCount: number
}

type Sums = { label: string; contract: number; thisPeriod: number; toDate: number }

function sumByKey(lines: readonly (ReconcileLine & { readonly key: string })[]): Map<string, Sums> {
  const map = new Map<string, Sums>()
  for (const line of lines) {
    const current = map.get(line.key) ?? { label: `${line.costCode} ${line.description}`.trim(), contract: 0, thisPeriod: 0, toDate: 0 }
    const thisPeriod = (toCents(line.currentWorkCompleted) ?? 0) + (toCents(line.storedMaterials) ?? 0)
    current.contract += toCents(line.adjustedEstimate) ?? 0
    current.thisPeriod += thisPeriod
    current.toDate += (toCents(line.previousWorkCompleted) ?? 0) + thisPeriod
    map.set(line.key, current)
  }
  return map
}

/**
 * A Compass pay application against the Sage progress billing with the same
 * number, cost code by cost code: contract, this period and completed to
 * date. Every difference is shown; nothing is changed to make them agree.
 */
export function reconcilePayRequestWithSage(
  compass: readonly ReconcileLine[],
  sage: readonly SyncedPayRequestLine[]
): PayRequestReconciliation {
  const compassSums = sumByKey(compass.map((line) => ({ ...line, key: compassLineKey(line.costCode) })))
  const sageSums = sumByKey(
    sage.map((line) => ({
      costCode: line.compassCostCode,
      description: line.compassDescription,
      adjustedEstimate: line.adjustedEstimate,
      previousWorkCompleted: line.previousWorkCompleted,
      currentWorkCompleted: line.currentWorkCompleted,
      storedMaterials: line.storedMaterials,
      key: compassLineKey(line.compassCostCode),
    }))
  )
  const empty: Sums = { label: "", contract: 0, thisPeriod: 0, toDate: 0 }
  const keys = [...new Set([...compassSums.keys(), ...sageSums.keys()])]
  const rows = keys.map((key): PayRequestReconciliationRow => {
    const left = compassSums.get(key)
    const right = sageSums.get(key)
    const c = left ?? empty
    const s = right ?? empty
    return {
      key,
      label: left?.label ?? right?.label ?? key,
      presence: left && right ? "both" : left ? "compass_only" : "sage_only",
      compassContractCents: c.contract,
      sageContractCents: s.contract,
      compassThisPeriodCents: c.thisPeriod,
      sageThisPeriodCents: s.thisPeriod,
      compassToDateCents: c.toDate,
      sageToDateCents: s.toDate,
      mismatch: c.contract !== s.contract || c.thisPeriod !== s.thisPeriod || c.toDate !== s.toDate,
    }
  })
  const total = (pick: (row: PayRequestReconciliationRow) => number): number => rows.reduce((sum, row) => sum + pick(row), 0)
  const totals = {
    compassContractCents: total((row) => row.compassContractCents),
    sageContractCents: total((row) => row.sageContractCents),
    compassThisPeriodCents: total((row) => row.compassThisPeriodCents),
    sageThisPeriodCents: total((row) => row.sageThisPeriodCents),
    compassToDateCents: total((row) => row.compassToDateCents),
    sageToDateCents: total((row) => row.sageToDateCents),
    mismatch: false,
  }
  const totalsMismatch =
    totals.compassContractCents !== totals.sageContractCents ||
    totals.compassThisPeriodCents !== totals.sageThisPeriodCents ||
    totals.compassToDateCents !== totals.sageToDateCents
  return {
    rows,
    totals: { ...totals, mismatch: totalsMismatch },
    mismatchCount: rows.filter((row) => row.mismatch).length,
  }
}

// ---- shop tickets the synced billing covers

/** An issued shop ticket not yet billed, with its amounts by cost code. */
export type UnbilledShopTicket = {
  readonly id: string
  readonly ticketDate: string
  readonly lines: readonly { readonly costCode: string; readonly amountCents: number }[]
}

/**
 * The tickets Sage's billing plainly covers: every cost code a ticket bills
 * has a synced line whose current-period amount (current work plus stored
 * materials) is at least what all candidate tickets put on that code, and
 * the ticket is dated on or before the period. Anything less is ambiguous
 * and left for staff to tick.
 */
export function shopTicketsCoveredBySage(
  tickets: readonly UnbilledShopTicket[],
  lines: readonly SyncedPayRequestLine[],
  periodTo: string | null
): ReadonlySet<string> {
  const periodCents = new Map<string, number>()
  for (const line of lines) {
    const key = compassLineKey(line.compassCostCode)
    periodCents.set(key, (periodCents.get(key) ?? 0) + (toCents(line.currentWorkCompleted) ?? 0) + (toCents(line.storedMaterials) ?? 0))
  }
  const period = periodTo ? periodTo.slice(0, 10) : null
  const candidates = tickets.filter((ticket) => ticket.lines.length > 0 && (!period || ticket.ticketDate.slice(0, 10) <= period))
  const demand = new Map<string, number>()
  for (const ticket of candidates) {
    for (const line of ticket.lines) {
      const key = compassLineKey(line.costCode)
      demand.set(key, (demand.get(key) ?? 0) + line.amountCents)
    }
  }
  const covered = new Set<string>()
  for (const ticket of candidates) {
    const fits = ticket.lines.every((line) => {
      const key = compassLineKey(line.costCode)
      const available = periodCents.get(key)
      return available !== undefined && available > 0 && available >= (demand.get(key) ?? 0)
    })
    if (fits) covered.add(ticket.id)
  }
  return covered
}
