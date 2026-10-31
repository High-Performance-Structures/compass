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
  readonly previousWorkCompleted: number
  readonly currentWorkCompleted: number
  readonly storedMaterials: number
  readonly ownerVisible: boolean
}

/** G703 columns B–J for one row, group or total. */
export type PayApplicationReportAmounts = {
  readonly originalContractSum: number
  readonly priorChanges: number
  readonly currentChanges: number
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
  const priorChanges = sum((source) => source.priorChanges)
  const currentChanges = sum((source) => source.currentChanges)
  const adjustedEstimate = roundCents(originalContractSum + priorChanges + currentChanges)
  const priorCosts = sum((source) => source.previousWorkCompleted)
  const currentCosts = sum((source) => source.currentWorkCompleted + source.storedMaterials)
  const completedToDate = roundCents(priorCosts + currentCosts)
  return {
    originalContractSum,
    priorChanges,
    currentChanges,
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

export type ChangeOrderSummaryItem = {
  readonly name: string
  readonly amount: number
  readonly assemblies: readonly { readonly name: string; readonly amount: number }[]
}

/**
 * Change orders approved before and during this period, by name where known.
 * With the change-order list, current items come from it, so changes that
 * landed inside an assembly are still named; otherwise from change-order rows.
 */
export function payApplicationChangeOrderSummary(
  sources: readonly PayApplicationReportSource[],
  changeOrders: readonly (ChangeOrderSummaryItem & { readonly current: boolean })[] | null = null
): {
  readonly previous: number
  readonly current: number
  readonly currentItems: readonly ChangeOrderSummaryItem[]
} {
  const previous = roundCents(sources.reduce((total, source) => total + source.priorChanges, 0))
  const current = roundCents(sources.reduce((total, source) => total + source.currentChanges, 0))
  if (changeOrders) {
    const items = changeOrders.filter((item) => item.current && item.amount !== 0)
    // Use the list only when it accounts for this period's changes.
    if (roundCents(items.reduce((total, item) => total + item.amount, 0)) === current) {
      return { previous, current, currentItems: items.map(({ name, amount, assemblies }) => ({ name, amount, assemblies })) }
    }
  }
  const currentByName = new Map<string, number>()
  for (const source of sources) {
    if (source.currentChanges === 0 || !source.assemblyKey?.startsWith("co:") || !source.assemblyName) continue
    currentByName.set(source.assemblyName, roundCents((currentByName.get(source.assemblyName) ?? 0) + source.currentChanges))
  }
  return {
    previous,
    current,
    currentItems: [...currentByName.entries()].map(([name, amount]) => ({ name, amount, assemblies: [] })),
  }
}
