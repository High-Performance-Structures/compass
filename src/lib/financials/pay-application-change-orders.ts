import { and, eq, inArray, ne, or, sql } from "drizzle-orm"

import type { getDb } from "@/db"
import { projectBudgetApplications, projectChangeOrderLines, projectChangeOrders } from "@/db/schema"
import { projectContractBudgetAdjustments } from "@/db/schema-estimates"
import { chunkD1Values } from "@/lib/d1-query"
import { BUDGET_PROJECTION_SOURCE, COMPASS_DRAW_SOURCE } from "@/lib/domain/financials/rules"
import { priorPayApplicationCondition } from "@/lib/financials/owner-pay-application-refresh"
import { loadPayApplicationShares, shareKey } from "@/lib/financials/pay-application-shares"

export type PayApplicationChangeOrder = {
  readonly id: string
  /** Change orders and variances are summarized and scheduled apart on the G702. */
  readonly recordType: "change_order" | "variance"
  readonly number: string
  readonly title: string
  readonly executedAt: string
  readonly costCodes: readonly string[]
  /**
   * The first owner pay application (any source, imported draws included)
   * whose period ends on or after the execution date; `thisPeriod` when that
   * is this application. Null when no application has a period to compare.
   */
  readonly firstBilled: { readonly applicationNumber: string; readonly periodTo: string | null; readonly thisPeriod: boolean } | null
  readonly name: string
  /** The part of the record in this contract budget (what G702 lines 2a/2b add up). */
  readonly amount: number
  /** The record's own total: all its lines, builder fee and insurance included. */
  readonly headerAmount: number
  /** Executed after the previous pay application's period (this month). */
  readonly current: boolean
  /** Where the change landed: its assemblies, or none for separate work. */
  readonly assemblies: readonly { readonly name: string; readonly amount: number }[]
}

function roundCents(value: number): number {
  return Math.round(value * 100) / 100
}

/** An owner pay application as change timing needs it. */
export type OwnerPayApplicationPeriod = {
  readonly id: string
  readonly applicationNumber: string
  readonly periodTo: string | null
}

const dateOf = (value: string | null): string | null => (value ? value.slice(0, 10) : null)

function applicationOrder(left: OwnerPayApplicationPeriod, right: OwnerPayApplicationPeriod): number {
  const leftDate = dateOf(left.periodTo) ?? "9999-12-31"
  const rightDate = dateOf(right.periodTo) ?? "9999-12-31"
  if (leftDate !== rightDate) return leftDate.localeCompare(rightDate)
  return left.applicationNumber.localeCompare(right.applicationNumber, undefined, { numeric: true })
}

/**
 * When each executed change order or variance was approved relative to the
 * pay application periods, by its execution date (never by G703 line deltas,
 * which imported draws only carry approximately).
 *
 * - current: executed after the previous application's period_to (with no
 *   previous application, everything counts as this month);
 * - firstBilled: the first application up to this one whose period_to is on
 *   or after the execution date; this application when none earlier is.
 */
export function changeTiming(
  executedAt: string,
  applications: readonly OwnerPayApplicationPeriod[],
  applicationId: string
): { readonly current: boolean; readonly firstBilled: PayApplicationChangeOrder["firstBilled"] } {
  const ordered = [...applications].sort(applicationOrder)
  const index = ordered.findIndex((application) => application.id === applicationId)
  const upToThis = index >= 0 ? ordered.slice(0, index + 1) : ordered
  const self = index >= 0 ? ordered[index] : undefined
  const previous = [...upToThis.slice(0, -1)].reverse().find((application) => dateOf(application.periodTo) !== null)
  const executed = dateOf(executedAt) ?? ""
  const previousTo = dateOf(previous?.periodTo ?? null)
  const current = !previousTo || executed > previousTo
  const billedIn = upToThis.find((application) => {
    const periodTo = dateOf(application.periodTo)
    return periodTo !== null && periodTo >= executed
  }) ?? self
  return {
    current,
    firstBilled: billedIn
      ? { applicationNumber: billedIn.applicationNumber, periodTo: billedIn.periodTo, thisPeriod: billedIn.id === applicationId }
      : null,
  }
}

/** The project's owner pay applications: Compass draws and imported draws alike. */
async function ownerPayApplicationPeriods(
  db: ReturnType<typeof getDb>,
  projectId: string,
  applicationId: string
): Promise<readonly OwnerPayApplicationPeriod[]> {
  const rows = await db
    .select({
      id: projectBudgetApplications.id,
      applicationNumber: projectBudgetApplications.applicationNumber,
      periodTo: projectBudgetApplications.periodTo,
      sourceSystem: projectBudgetApplications.sourceSystem,
      status: projectBudgetApplications.status,
    })
    .from(projectBudgetApplications)
    .where(
      or(
        eq(projectBudgetApplications.id, applicationId),
        and(priorPayApplicationCondition(projectId), ne(projectBudgetApplications.sourceSystem, BUDGET_PROJECTION_SOURCE))
      )
    )
  // Compass drafts other than the one being printed are not billed periods.
  return rows
    .filter((row) => row.id === applicationId || !(row.sourceSystem === COMPASS_DRAW_SOURCE && row.status === "draft"))
    .map(({ id, applicationNumber, periodTo }) => ({ id, applicationNumber, periodTo }))
}

/**
 * The executed change orders and variances in a pay application's contract
 * budget, with how each splits across assemblies, its own total, and when it
 * was approved relative to the pay application periods.
 */
export async function payApplicationChangeOrders(
  db: ReturnType<typeof getDb>,
  input: { readonly projectId: string; readonly applicationId: string; readonly budgetRevisionId: string | null }
): Promise<readonly PayApplicationChangeOrder[]> {
  if (!input.budgetRevisionId) return []
  const [rows, applications] = await Promise.all([
    db
      .select({
        changeOrderId: projectContractBudgetAdjustments.changeOrderId,
        amountCents: projectContractBudgetAdjustments.amountCents,
        assemblyName: projectContractBudgetAdjustments.assemblyName,
        contractAssemblyId: projectContractBudgetAdjustments.contractAssemblyId,
        executedAt: projectContractBudgetAdjustments.executedAt,
        changeOrderExecutedAt: projectChangeOrders.executedAt,
        number: projectChangeOrders.changeOrderNumber,
        title: projectChangeOrders.title,
        recordType: projectChangeOrders.recordType,
        headerCents: projectChangeOrders.amountCents,
        costCode: projectContractBudgetAdjustments.costCode,
      })
      .from(projectContractBudgetAdjustments)
      .leftJoin(projectChangeOrders, eq(projectChangeOrders.id, projectContractBudgetAdjustments.changeOrderId))
      .where(eq(projectContractBudgetAdjustments.revisionId, input.budgetRevisionId)),
    ownerPayApplicationPeriods(db, input.projectId, input.applicationId),
  ])
  const changeOrderIds = [...new Set(rows.map((row) => row.changeOrderId))]
  const lineTotals = new Map<string, number>()
  for (const ids of chunkD1Values(changeOrderIds)) {
    const totals = await db
      .select({
        changeOrderId: projectChangeOrderLines.changeOrderId,
        cents: sql<number>`coalesce(sum(${projectChangeOrderLines.amountCents}), 0)`,
        lines: sql<number>`count(${projectChangeOrderLines.amountCents})`,
      })
      .from(projectChangeOrderLines)
      .where(inArray(projectChangeOrderLines.changeOrderId, ids))
      .groupBy(projectChangeOrderLines.changeOrderId)
    for (const total of totals) {
      if (Number(total.lines) > 0) lineTotals.set(total.changeOrderId, Number(total.cents))
    }
  }
  const byChangeOrder = new Map<
    string,
    {
      name: string
      number: string
      title: string
      recordType: "change_order" | "variance"
      cents: number
      headerCents: number | null
      executedAt: string
      costCodes: Set<string>
      assemblies: Map<string, number>
    }
  >()
  for (const row of rows) {
    const entry =
      byChangeOrder.get(row.changeOrderId) ??
      {
        name: row.number ? `${row.number}${row.title ? ` · ${row.title}` : ""}` : "Change order",
        number: row.number ?? "",
        title: row.title ?? "",
        recordType: row.recordType === "variance" ? "variance" : "change_order",
        cents: 0,
        headerCents: lineTotals.get(row.changeOrderId) ?? row.headerCents ?? null,
        executedAt: row.changeOrderExecutedAt ?? row.executedAt,
        costCodes: new Set<string>(),
        assemblies: new Map<string, number>(),
      }
    entry.cents += row.amountCents
    entry.costCodes.add(row.costCode)
    if (row.contractAssemblyId && row.assemblyName) {
      entry.assemblies.set(row.assemblyName, (entry.assemblies.get(row.assemblyName) ?? 0) + row.amountCents)
    }
    byChangeOrder.set(row.changeOrderId, entry)
  }
  return [...byChangeOrder.entries()]
    .sort(([, left], [, right]) => left.executedAt.localeCompare(right.executedAt))
    .map(([id, entry]) => {
      const timing = changeTiming(entry.executedAt, applications, input.applicationId)
      return {
        id,
        recordType: entry.recordType,
        number: entry.number,
        title: entry.title,
        executedAt: entry.executedAt,
        costCodes: [...entry.costCodes].sort(),
        firstBilled: timing.firstBilled,
        name: entry.name,
        amount: roundCents(entry.cents / 100),
        headerAmount: roundCents((entry.headerCents ?? entry.cents) / 100),
        current: timing.current,
        assemblies: [...entry.assemblies.entries()].map(([name, cents]) => ({ name, amount: roundCents(cents / 100) })),
      }
    })
}

/**
 * Pay application rows with the part of their changes that came from
 * variances, read from the contract budget revision the draw was prepared
 * against. A row that no longer matches the revision's split shows none.
 */
export async function linesWithVariances<T extends { readonly costCode: string; readonly assemblyKey: string | null; readonly totalChanges: number }>(
  db: ReturnType<typeof getDb>,
  budgetRevisionId: string | null,
  lines: readonly T[]
): Promise<readonly (T & { readonly totalVariances: number })[]> {
  const shares = budgetRevisionId ? await loadPayApplicationShares(db, budgetRevisionId) : []
  const varianceByKey = new Map(shares.map((share) => [shareKey(share.costCode, share.assemblyKey), share.varianceCents]))
  return lines.map((line) => ({ ...line, totalVariances: roundCents((varianceByKey.get(shareKey(line.costCode, line.assemblyKey)) ?? 0) / 100) }))
}
