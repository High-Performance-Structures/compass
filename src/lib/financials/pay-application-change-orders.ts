import { and, asc, desc, eq, lt, ne, notInArray } from "drizzle-orm"

import type { getDb } from "@/db"
import { projectBudgetApplications, projectChangeOrders } from "@/db/schema"
import { projectContractBudgetAdjustments } from "@/db/schema-estimates"
import { loadPayApplicationShares, shareKey } from "@/lib/financials/pay-application-shares"

export type PayApplicationChangeOrder = {
  readonly id: string
  /** Change orders and variances are summarized and scheduled apart on the G702. */
  readonly recordType: "change_order" | "variance"
  readonly number: string
  readonly title: string
  readonly executedAt: string
  readonly costCodes: readonly string[]
  /** The first pay application whose contract budget included it; null when none before this one. */
  readonly firstBilled: { readonly applicationNumber: string; readonly periodTo: string | null } | null
  readonly name: string
  readonly amount: number
  /** Approved since the previous pay application. */
  readonly current: boolean
  /** Where the change landed: its assemblies, or none for separate work. */
  readonly assemblies: readonly { readonly name: string; readonly amount: number }[]
}

function roundCents(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * The executed change orders in a pay application's contract budget, with
 * how each splits across assemblies. A change order is current when the
 * previous pay application's budget didn't include it yet.
 */
export async function payApplicationChangeOrders(
  db: ReturnType<typeof getDb>,
  input: { readonly projectId: string; readonly applicationId: string; readonly budgetRevisionId: string | null }
): Promise<readonly PayApplicationChangeOrder[]> {
  if (!input.budgetRevisionId) return []
  const application = await db
    .select({ createdAt: projectBudgetApplications.createdAt })
    .from(projectBudgetApplications)
    .where(eq(projectBudgetApplications.id, input.applicationId))
    .get()
  const previous = application
    ? await db
        .select({ budgetRevisionId: projectBudgetApplications.budgetRevisionId })
        .from(projectBudgetApplications)
        .where(
          and(
            eq(projectBudgetApplications.projectId, input.projectId),
            eq(projectBudgetApplications.sourceSystem, "compass_contract_budget"),
            ne(projectBudgetApplications.id, input.applicationId),
            lt(projectBudgetApplications.createdAt, application.createdAt)
          )
        )
        .orderBy(desc(projectBudgetApplications.createdAt))
        .get()
    : undefined
  const select = (revisionId: string) =>
    db
      .select({
        changeOrderId: projectContractBudgetAdjustments.changeOrderId,
        amountCents: projectContractBudgetAdjustments.amountCents,
        assemblyName: projectContractBudgetAdjustments.assemblyName,
        contractAssemblyId: projectContractBudgetAdjustments.contractAssemblyId,
        executedAt: projectContractBudgetAdjustments.executedAt,
        number: projectChangeOrders.changeOrderNumber,
        title: projectChangeOrders.title,
        recordType: projectChangeOrders.recordType,
        costCode: projectContractBudgetAdjustments.costCode,
      })
      .from(projectContractBudgetAdjustments)
      .leftJoin(projectChangeOrders, eq(projectChangeOrders.id, projectContractBudgetAdjustments.changeOrderId))
      .where(eq(projectContractBudgetAdjustments.revisionId, revisionId))
  const [rows, previousRows] = await Promise.all([
    select(input.budgetRevisionId),
    previous?.budgetRevisionId ? select(previous.budgetRevisionId) : Promise.resolve([]),
  ])
  const previousIds = new Set(previousRows.map((row) => row.changeOrderId))
  const firstBilled = await firstBilledApplications(db, input.projectId, application?.createdAt ?? null, input.applicationId)
  const byChangeOrder = new Map<
    string,
    {
      name: string
      number: string
      title: string
      recordType: "change_order" | "variance"
      cents: number
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
        executedAt: row.executedAt,
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
    .map(([id, entry]) => ({
      id,
      recordType: entry.recordType,
      number: entry.number,
      title: entry.title,
      executedAt: entry.executedAt,
      costCodes: [...entry.costCodes].sort(),
      firstBilled: previousIds.has(id) ? firstBilled.get(id) ?? null : null,
      name: entry.name,
      amount: roundCents(entry.cents / 100),
      current: !previousIds.has(id),
      assemblies: [...entry.assemblies.entries()].map(([name, cents]) => ({ name, amount: roundCents(cents / 100) })),
    }))
}

/** Pay applications billed before this one never include these statuses. */
const UNBILLED_STATUSES = ["void", "superseded", "building", "budget_current", "budget_superseded"]

/**
 * For each change order in an earlier pay application's contract budget, the
 * first such application: the period the change was first billed.
 */
async function firstBilledApplications(
  db: ReturnType<typeof getDb>,
  projectId: string,
  before: string | null,
  applicationId: string
): Promise<ReadonlyMap<string, { readonly applicationNumber: string; readonly periodTo: string | null }>> {
  if (!before) return new Map()
  const rows = await db
    .selectDistinct({
      changeOrderId: projectContractBudgetAdjustments.changeOrderId,
      applicationNumber: projectBudgetApplications.applicationNumber,
      periodTo: projectBudgetApplications.periodTo,
      createdAt: projectBudgetApplications.createdAt,
    })
    .from(projectBudgetApplications)
    .innerJoin(projectContractBudgetAdjustments, eq(projectContractBudgetAdjustments.revisionId, projectBudgetApplications.budgetRevisionId))
    .where(
      and(
        eq(projectBudgetApplications.projectId, projectId),
        eq(projectBudgetApplications.sourceSystem, "compass_contract_budget"),
        ne(projectBudgetApplications.id, applicationId),
        lt(projectBudgetApplications.createdAt, before),
        notInArray(projectBudgetApplications.status, UNBILLED_STATUSES)
      )
    )
    .orderBy(asc(projectBudgetApplications.createdAt))
  const first = new Map<string, { readonly applicationNumber: string; readonly periodTo: string | null }>()
  for (const row of rows) {
    if (!first.has(row.changeOrderId)) first.set(row.changeOrderId, { applicationNumber: row.applicationNumber, periodTo: row.periodTo })
  }
  return first
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
