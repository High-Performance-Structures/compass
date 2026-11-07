import type { PayApplicationOwnerDetail } from "@/lib/financials/pay-application-detail"
import { UNASSIGNED_ASSEMBLY_NAME } from "@/lib/financials/pay-application-shares"

/** One pay application row as the G703 continuation sheet needs it. */
export type PayApplicationReportSource = {
  readonly costCode: string
  readonly description: string
  readonly divisionCode: string
  readonly divisionName: string
  readonly assemblyKey: string | null
  readonly assemblyName: string | null
  readonly assemblySort: number
  readonly originalEstimate: number
  readonly priorChanges: number
  readonly currentChanges: number
  /** The part of this row's changes that came from variances; 0 when none. */
  readonly totalVariances: number
  readonly previousWorkCompleted: number
  readonly currentWorkCompleted: number
  readonly storedMaterials: number
  readonly ownerVisible: boolean
}

/** G703 columns B–J for one row, group or total. */
export type PayApplicationReportAmounts = {
  readonly originalContractSum: number
  /** Running total of change orders on the row. */
  readonly changeOrders: number
  /** Running total of variances on the row. */
  readonly variances: number
  readonly adjustedEstimate: number
  readonly priorCosts: number
  readonly currentCosts: number
  readonly completedToDate: number
  readonly percentComplete: number
  readonly balance: number
}

type PayApplicationReportRow = PayApplicationReportAmounts & {
  readonly key: string
  readonly label: string
}

type PayApplicationReportGroup = PayApplicationReportRow & {
  /** Cost code rows under the group; empty when the group prints as one row. */
  readonly rows: readonly PayApplicationReportRow[]
}

export type PayApplicationReport = {
  readonly groupLabel: "Assembly" | "Division" | "Cost code"
  readonly groups: readonly PayApplicationReportGroup[]
  readonly totals: PayApplicationReportAmounts
}

const roundCents = (value: number): number => Math.round(value * 100) / 100

function amountsFor(sources: readonly PayApplicationReportSource[]): PayApplicationReportAmounts {
  const sum = (pick: (source: PayApplicationReportSource) => number): number =>
    roundCents(sources.reduce((total, source) => total + pick(source), 0))
  const originalContractSum = sum((source) => source.originalEstimate)
  const variances = sum((source) => source.totalVariances)
  const changeOrders = roundCents(sum((source) => source.priorChanges + source.currentChanges) - variances)
  const adjustedEstimate = roundCents(originalContractSum + changeOrders + variances)
  const priorCosts = sum((source) => source.previousWorkCompleted)
  const currentCosts = sum((source) => source.currentWorkCompleted + source.storedMaterials)
  const completedToDate = roundCents(priorCosts + currentCosts)
  return {
    originalContractSum,
    changeOrders,
    variances,
    adjustedEstimate,
    priorCosts,
    currentCosts,
    completedToDate,
    percentComplete: adjustedEstimate > 0 ? Math.round((completedToDate / adjustedEstimate) * 1000) / 10 : 0,
    balance: roundCents(adjustedEstimate - completedToDate),
  }
}

type Bucket = { readonly key: string; readonly label: string; readonly sort: string | number; readonly sources: PayApplicationReportSource[] }

function bucketsBy(
  sources: readonly PayApplicationReportSource[],
  identify: (source: PayApplicationReportSource) => Omit<Bucket, "sources">
): readonly Bucket[] {
  const buckets = new Map<string, Bucket>()
  for (const source of sources) {
    const id = identify(source)
    const bucket = buckets.get(id.key) ?? { ...id, sources: [] }
    bucket.sources.push(source)
    buckets.set(id.key, bucket)
  }
  return [...buckets.values()].sort((left, right) =>
    typeof left.sort === "number" && typeof right.sort === "number"
      ? left.sort - right.sort || left.label.localeCompare(right.label)
      : String(left.sort).localeCompare(String(right.sort))
  )
}

function costCodeRows(sources: readonly PayApplicationReportSource[]): readonly PayApplicationReportRow[] {
  return bucketsBy(sources, (source) => ({
    key: source.costCode,
    label: `${source.costCode} · ${source.description}`,
    sort: source.costCode,
  })).map((bucket) => ({ key: bucket.key, label: bucket.label, ...amountsFor(bucket.sources) }))
}

/**
 * The G703 continuation sheet at the client's detail. Percent levels print one
 * combined row per assembly or division (the percent sets what is billed);
 * Assembly and Division also list the cost codes under each group.
 */
export function payApplicationReport(
  sources: readonly PayApplicationReportSource[],
  detail: PayApplicationOwnerDetail
): PayApplicationReport {
  const visible = sources.filter((source) => source.ownerVisible)
  const totals = amountsFor(visible)
  if (detail === "cost_code") {
    return {
      groupLabel: "Cost code",
      groups: costCodeRows(visible).map((row) => ({ ...row, rows: [] })),
      totals,
    }
  }
  const byAssembly = detail === "assembly" || detail === "assembly_percent"
  const itemized = detail === "assembly" || detail === "division"
  const buckets = byAssembly
    ? bucketsBy(visible, (source) => ({
        key: source.assemblyKey ?? "",
        label: source.assemblyName ?? UNASSIGNED_ASSEMBLY_NAME,
        sort: source.assemblyKey ? source.assemblySort : Number.MAX_SAFE_INTEGER,
      }))
    : bucketsBy(visible, (source) => ({
        key: source.divisionCode,
        label: `${source.divisionCode} · ${source.divisionName}`,
        sort: source.divisionCode,
      }))
  return {
    groupLabel: byAssembly ? "Assembly" : "Division",
    groups: buckets.map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      ...amountsFor(bucket.sources),
      rows: itemized ? costCodeRows(bucket.sources) : [],
    })),
    totals,
  }
}

type ChangeOrderSummaryItem = {
  readonly name: string
  readonly amount: number
  readonly assemblies: readonly { readonly name: string; readonly amount: number }[]
}

type SummaryListItem = ChangeOrderSummaryItem & {
  readonly current: boolean
  readonly recordType: "change_order" | "variance"
}

/** Additions (or increases) and deductions (or decreases), deductions as a positive amount. */
type ChangeTotals = { readonly additions: number; readonly deductions: number }

export type ChangeKindSummary = {
  readonly previous: ChangeTotals
  readonly current: ChangeTotals
  readonly totals: ChangeTotals
  /** Additions less deductions, previous and this month. */
  readonly net: number
  readonly currentItems: readonly ChangeOrderSummaryItem[]
}

export type PayApplicationChangeSummary = {
  /** G702 line 2a and the change-order summary. */
  readonly changeOrders: ChangeKindSummary
  /** G702 line 2b and the variance summary. */
  readonly variances: ChangeKindSummary
}

function totalsOf(amounts: readonly number[]): ChangeTotals {
  return {
    additions: roundCents(amounts.filter((amount) => amount > 0).reduce((sum, amount) => sum + amount, 0)),
    deductions: roundCents(amounts.filter((amount) => amount < 0).reduce((sum, amount) => sum - amount, 0)),
  }
}

function kindSummary(previous: readonly number[], current: readonly number[], currentItems: readonly ChangeOrderSummaryItem[]): ChangeKindSummary {
  const previousTotals = totalsOf(previous)
  const currentTotals = totalsOf(current)
  const totals = {
    additions: roundCents(previousTotals.additions + currentTotals.additions),
    deductions: roundCents(previousTotals.deductions + currentTotals.deductions),
  }
  return { previous: previousTotals, current: currentTotals, totals, net: roundCents(totals.additions - totals.deductions), currentItems }
}

/**
 * The G702 change summaries: change orders as additions and deductions, and
 * variances as increases and decreases, approved in previous months and this
 * month. With the change-order list each record counts once, by its amount;
 * otherwise (older or imported draws) the G703 changes all count as change
 * orders, and current items come from change-order rows.
 */
export function payApplicationChangeSummary(
  sources: readonly PayApplicationReportSource[],
  items: readonly SummaryListItem[] | null = null
): PayApplicationChangeSummary {
  const priorTotal = roundCents(sources.reduce((total, source) => total + source.priorChanges, 0))
  const currentTotal = roundCents(sources.reduce((total, source) => total + source.currentChanges, 0))
  const listed = items?.filter((item) => item.amount !== 0) ?? []
  const listedTotal = roundCents(listed.reduce((total, item) => total + item.amount, 0))
  const listedCurrent = roundCents(listed.filter((item) => item.current).reduce((total, item) => total + item.amount, 0))
  // Use the list only when it accounts for the G703's changes.
  if (items && listedTotal === roundCents(priorTotal + currentTotal) && listedCurrent === currentTotal) {
    const of = (recordType: SummaryListItem["recordType"]): ChangeKindSummary => {
      const kind = listed.filter((item) => item.recordType === recordType)
      return kindSummary(
        kind.filter((item) => !item.current).map((item) => item.amount),
        kind.filter((item) => item.current).map((item) => item.amount),
        kind.filter((item) => item.current).map(({ name, amount, assemblies }) => ({ name, amount, assemblies }))
      )
    }
    return { changeOrders: of("change_order"), variances: of("variance") }
  }
  const currentByName = new Map<string, number>()
  for (const source of sources) {
    if (source.currentChanges === 0 || !source.assemblyKey?.startsWith("co:") || !source.assemblyName) continue
    currentByName.set(source.assemblyName, roundCents((currentByName.get(source.assemblyName) ?? 0) + source.currentChanges))
  }
  return {
    changeOrders: kindSummary(
      [priorTotal],
      [currentTotal],
      [...currentByName.entries()].map(([name, amount]) => ({ name, amount, assemblies: [] }))
    ),
    variances: kindSummary([], [], []),
  }
}
