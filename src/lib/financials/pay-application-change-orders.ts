import { and, desc, eq, lt, ne } from "drizzle-orm"

import type { getDb } from "@/db"
import { projectBudgetApplications, projectChangeOrders } from "@/db/schema"
import { projectContractBudgetAdjustments } from "@/db/schema-estimates"

export type PayApplicationChangeOrder = {
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
      })
      .from(projectContractBudgetAdjustments)
      .leftJoin(projectChangeOrders, eq(projectChangeOrders.id, projectContractBudgetAdjustments.changeOrderId))
      .where(eq(projectContractBudgetAdjustments.revisionId, revisionId))
  const [rows, previousRows] = await Promise.all([
    select(input.budgetRevisionId),
    previous?.budgetRevisionId ? select(previous.budgetRevisionId) : Promise.resolve([]),
  ])
  const previousIds = new Set(previousRows.map((row) => row.changeOrderId))
  const byChangeOrder = new Map<
    string,
    { name: string; cents: number; executedAt: string; assemblies: Map<string, number> }
  >()
  for (const row of rows) {
    const entry =
      byChangeOrder.get(row.changeOrderId) ??
      {
        name: row.number ? `${row.number}${row.title ? ` · ${row.title}` : ""}` : "Change order",
        cents: 0,
        executedAt: row.executedAt,
        assemblies: new Map<string, number>(),
      }
    entry.cents += row.amountCents
    if (row.contractAssemblyId && row.assemblyName) {
      entry.assemblies.set(row.assemblyName, (entry.assemblies.get(row.assemblyName) ?? 0) + row.amountCents)
    }
    byChangeOrder.set(row.changeOrderId, entry)
  }
  return [...byChangeOrder.entries()]
    .sort(([, left], [, right]) => left.executedAt.localeCompare(right.executedAt))
    .map(([id, entry]) => ({
      name: entry.name,
      amount: roundCents(entry.cents / 100),
      current: !previousIds.has(id),
      assemblies: [...entry.assemblies.entries()].map(([name, cents]) => ({ name, amount: roundCents(cents / 100) })),
    }))
}
