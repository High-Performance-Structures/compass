import { and, asc, eq, isNotNull } from "drizzle-orm"

import type { getDb } from "@/db"
import { projectChangeOrders } from "@/db/schema"
import {
  projectContractBudgetAdjustments,
  projectContractBudgetLines,
  projectContractBudgetRevisions,
  projectEstimateAssemblies,
  projectEstimateLines,
} from "@/db/schema-estimates"

/**
 * One G703 row on a pay application: a contract budget cost code, or the part
 * of it that belongs to one estimate assembly or one change order.
 */
export type PayApplicationShare = {
  readonly budgetRevisionLineId: string
  readonly costCode: string
  readonly divisionCode: string
  readonly divisionName: string
  readonly description: string
  /** "asm:<id>" or "co:<id>"; null for work outside any assembly. */
  readonly assemblyKey: string | null
  readonly assemblyName: string | null
  readonly assemblySort: number
  readonly originalEstimateCents: number
  readonly approvedChangeCents: number
  readonly adjustedBudgetCents: number
  readonly ownerVisible: boolean
  readonly sortOrder: number
}

export type ShareRevisionLine = {
  readonly id: string
  readonly costCode: string
  readonly divisionCode: string
  readonly divisionName: string
  readonly description: string
  readonly originalEstimateCents: number
  readonly approvedChangeCents: number
  readonly adjustedBudgetCents: number
  readonly ownerVisible: boolean
  readonly sortOrder: number
}

export type ShareAllocation = {
  readonly costCode: string
  readonly key: string
  readonly name: string
  readonly sort: number
  readonly cents: number
}

/** "Other" holds work in a cost code that no assembly or change order claims. */
export const UNASSIGNED_ASSEMBLY_NAME = "Other work"

export function shareKey(costCode: string, assemblyKey: string | null): string {
  return `${costCode}|${assemblyKey ?? ""}`
}

/**
 * Split each contract budget cost code into assembly shares (from the accepted
 * estimate's lines) and change-order shares (from executed change orders).
 * Whatever the allocations don't cover stays in a share with no assembly.
 */
export function payApplicationShares(input: {
  readonly revisionLines: readonly ShareRevisionLine[]
  readonly estimateAllocations: readonly ShareAllocation[]
  readonly changeAllocations: readonly ShareAllocation[]
}): readonly PayApplicationShare[] {
  const byCostCode = (allocations: readonly ShareAllocation[]): Map<string, Map<string, ShareAllocation>> => {
    const map = new Map<string, Map<string, ShareAllocation>>()
    for (const allocation of allocations) {
      const group = map.get(allocation.costCode) ?? new Map<string, ShareAllocation>()
      const current = group.get(allocation.key)
      group.set(allocation.key, current ? { ...current, cents: current.cents + allocation.cents } : allocation)
      map.set(allocation.costCode, group)
    }
    return map
  }
  const estimateByCode = byCostCode(input.estimateAllocations)
  const changeByCode = byCostCode(input.changeAllocations)

  return input.revisionLines.flatMap((line) => {
    const base = {
      budgetRevisionLineId: line.id,
      costCode: line.costCode,
      divisionCode: line.divisionCode,
      divisionName: line.divisionName,
      description: line.description,
      ownerVisible: line.ownerVisible,
      sortOrder: line.sortOrder,
    }
    const estimate = [...(estimateByCode.get(line.costCode)?.values() ?? [])].filter((item) => item.cents !== 0)
    const changes = [...(changeByCode.get(line.costCode)?.values() ?? [])].filter((item) => item.cents !== 0)
    const shares: PayApplicationShare[] = []
    for (const item of estimate) {
      shares.push({ ...base, assemblyKey: item.key, assemblyName: item.name, assemblySort: item.sort, originalEstimateCents: item.cents, approvedChangeCents: 0, adjustedBudgetCents: item.cents })
    }
    for (const item of changes) {
      // A change tied to an assembly joins that assembly's row (AIA "changes").
      const index = shares.findIndex((share) => share.assemblyKey === item.key)
      const existing = shares[index]
      if (existing) {
        shares[index] = {
          ...existing,
          approvedChangeCents: existing.approvedChangeCents + item.cents,
          adjustedBudgetCents: existing.adjustedBudgetCents + item.cents,
        }
        continue
      }
      shares.push({ ...base, assemblyKey: item.key, assemblyName: item.name, assemblySort: item.sort, originalEstimateCents: 0, approvedChangeCents: item.cents, adjustedBudgetCents: item.cents })
    }
    const originalLeft = line.originalEstimateCents - estimate.reduce((sum, item) => sum + item.cents, 0)
    const changeLeft = line.approvedChangeCents - changes.reduce((sum, item) => sum + item.cents, 0)
    if (shares.length === 0 || originalLeft !== 0 || changeLeft !== 0) {
      shares.push({
        ...base,
        assemblyKey: null,
        assemblyName: shares.length === 0 ? null : UNASSIGNED_ASSEMBLY_NAME,
        assemblySort: 1_000_000,
        originalEstimateCents: originalLeft,
        approvedChangeCents: changeLeft,
        adjustedBudgetCents: originalLeft + changeLeft,
      })
    }
    return shares
  })
}

/**
 * Whether one cost code's existing rows can carry over to its shares row by
 * row. They can't when the rows predate the assembly split (all without an
 * assembly while the shares have assemblies) or when a row with amounts has
 * no matching share; then the amounts are spread by scheduled value.
 */
export function splitNeedsSpreading(
  rows: readonly { readonly assemblyKey: string | null; readonly hasAmounts: boolean }[],
  shares: readonly { readonly assemblyKey: string | null }[]
): boolean {
  if (rows.length === 0) return false
  const shareKeys = new Set(shares.map((share) => share.assemblyKey ?? ""))
  const predatesSplit = rows.every((row) => row.assemblyKey === null) && shares.some((share) => share.assemblyKey !== null)
  if (predatesSplit) return rows.some((row) => row.hasAmounts)
  return rows.some((row) => row.hasAmounts && !shareKeys.has(row.assemblyKey ?? ""))
}

/**
 * Split `totalCents` across `weights` in proportion, in whole cents, with the
 * rounding remainder on the largest weight so the parts add up exactly.
 */
export function distributeCents(totalCents: number, weights: readonly number[]): readonly number[] {
  if (weights.length === 0) return []
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0)
  if (weightSum === 0) {
    return weights.map((_, index) => (index === 0 ? totalCents : 0))
  }
  const parts = weights.map((weight) => Math.round((totalCents * weight) / weightSum))
  const remainder = totalCents - parts.reduce((sum, part) => sum + part, 0)
  let largest = 0
  weights.forEach((weight, index) => {
    if (weight > (weights[largest] ?? 0)) largest = index
  })
  return parts.map((part, index) => (index === largest ? part + remainder : part))
}

/**
 * The accepted estimate's assembly a change belongs to: the one it was tied
 * to, or one with the same name when a newer contract version renumbered it.
 */
export function contractAssemblyFor<T extends { readonly id: string; readonly name: string }>(
  assemblies: readonly T[],
  change: { readonly contractAssemblyId: string | null; readonly assemblyName: string | null }
): T | null {
  if (!change.contractAssemblyId && !change.assemblyName) return null
  const byId = assemblies.find((assembly) => assembly.id === change.contractAssemblyId)
  if (byId) return byId
  if (!change.contractAssemblyId) return null
  const name = change.assemblyName?.trim().toLowerCase()
  return assemblies.find((assembly) => assembly.name.trim().toLowerCase() === name) ?? null
}

/** The pay application shares for a contract budget revision. */
export async function loadPayApplicationShares(
  db: ReturnType<typeof getDb>,
  revisionId: string
): Promise<readonly PayApplicationShare[]> {
  const revision = await db
    .select({ acceptedEstimateId: projectContractBudgetRevisions.acceptedEstimateId })
    .from(projectContractBudgetRevisions)
    .where(eq(projectContractBudgetRevisions.id, revisionId))
    .get()
  const [revisionLines, assemblies, estimateLines, adjustments] = await Promise.all([
    db
      .select()
      .from(projectContractBudgetLines)
      .where(eq(projectContractBudgetLines.revisionId, revisionId))
      .orderBy(asc(projectContractBudgetLines.divisionCode), asc(projectContractBudgetLines.sortOrder)),
    revision?.acceptedEstimateId
      ? db
          .select()
          .from(projectEstimateAssemblies)
          .where(eq(projectEstimateAssemblies.estimateId, revision.acceptedEstimateId))
      : Promise.resolve([]),
    revision?.acceptedEstimateId
      ? db
          .select({
            costCode: projectEstimateLines.costCode,
            assemblyId: projectEstimateLines.assemblyId,
            lineTotalCents: projectEstimateLines.lineTotalCents,
          })
          .from(projectEstimateLines)
          .where(
            and(
              eq(projectEstimateLines.estimateId, revision.acceptedEstimateId),
              isNotNull(projectEstimateLines.assemblyId)
            )
          )
      : Promise.resolve([]),
    db
      .select({
        costCode: projectContractBudgetAdjustments.costCode,
        changeOrderId: projectContractBudgetAdjustments.changeOrderId,
        amountCents: projectContractBudgetAdjustments.amountCents,
        changeOrderNumber: projectChangeOrders.changeOrderNumber,
        title: projectChangeOrders.title,
        contractAssemblyId: projectContractBudgetAdjustments.contractAssemblyId,
        assemblyName: projectContractBudgetAdjustments.assemblyName,
        executedAt: projectContractBudgetAdjustments.executedAt,
      })
      .from(projectContractBudgetAdjustments)
      .leftJoin(projectChangeOrders, eq(projectChangeOrders.id, projectContractBudgetAdjustments.changeOrderId))
      .where(eq(projectContractBudgetAdjustments.revisionId, revisionId)),
  ])
  const assemblyById = new Map(assemblies.map((assembly) => [assembly.id, assembly]))
  const estimateAllocations: ShareAllocation[] = estimateLines.flatMap((line) => {
    const assembly = line.assemblyId ? assemblyById.get(line.assemblyId) : undefined
    if (!assembly) return []
    return [{ costCode: line.costCode, key: `asm:${assembly.id}`, name: assembly.name, sort: assembly.sortOrder, cents: line.lineTotalCents }]
  })
  const changeOrderIds = [...new Set([...adjustments].sort((a, b) => a.executedAt.localeCompare(b.executedAt)).map((row) => row.changeOrderId))]
  const changeAllocations: ShareAllocation[] = adjustments.map((row) => {
    const assembly = contractAssemblyFor(assemblies, row)
    if (assembly) {
      return { costCode: row.costCode, key: `asm:${assembly.id}`, name: assembly.name, sort: assembly.sortOrder, cents: row.amountCents }
    }
    return {
      costCode: row.costCode,
      key: `co:${row.changeOrderId}`,
      name: row.changeOrderNumber
        ? `Change order ${row.changeOrderNumber}${row.title ? ` · ${row.title}` : ""}`
        : "Change order",
      sort: 500_000 + changeOrderIds.indexOf(row.changeOrderId),
      cents: row.amountCents,
    }
  })
  return payApplicationShares({ revisionLines, estimateAllocations, changeAllocations })
}

export type PriorShareLine = {
  readonly costCode: string
  readonly assemblyKey: string | null
  readonly totalCosts: number
  readonly retainageHeld: number
  readonly totalChanges: number
}

/**
 * What the previous pay application already billed on each share. Rows that
 * match a share carry over directly; a cost code billed before it was split
 * into assemblies is spread across its shares by scheduled value.
 */
export function priorAmountsForShares(
  shares: readonly PayApplicationShare[],
  priorLines: readonly PriorShareLine[]
): readonly { readonly previousCents: number; readonly retainageCents: number; readonly priorChangesCents: number }[] {
  const toCents = (value: number): number => Math.round(value * 100)
  const priorByKey = new Map(priorLines.map((line) => [shareKey(line.costCode, line.assemblyKey), line]))
  const result = shares.map(() => ({ previousCents: 0, retainageCents: 0, priorChangesCents: 0 }))
  const sharesByCode = new Map<string, number[]>()
  shares.forEach((share, index) => sharesByCode.set(share.costCode, [...(sharesByCode.get(share.costCode) ?? []), index]))
  for (const [costCode, indexes] of sharesByCode) {
    const codeLines = priorLines.filter((line) => line.costCode === costCode)
    const codeShares = indexes.flatMap((index) => {
      const share = shares[index]
      return share ? [share] : []
    })
    const allMatch = !splitNeedsSpreading(
      codeLines.map((line) => ({ assemblyKey: line.assemblyKey, hasAmounts: line.totalCosts !== 0 || line.retainageHeld !== 0 })),
      codeShares
    )
    if (allMatch) {
      for (const index of indexes) {
        const share = shares[index]
        const prior = share ? priorByKey.get(shareKey(share.costCode, share.assemblyKey)) : undefined
        if (prior) {
          result[index] = {
            previousCents: toCents(prior.totalCosts),
            retainageCents: toCents(prior.retainageHeld),
            priorChangesCents: toCents(prior.totalChanges),
          }
        }
      }
      continue
    }
    const weights = indexes.map((index) => Math.max(0, shares[index]?.adjustedBudgetCents ?? 0))
    const changeWeights = indexes.map((index) => Math.max(0, shares[index]?.approvedChangeCents ?? 0))
    const previous = distributeCents(codeLines.reduce((sum, line) => sum + toCents(line.totalCosts), 0), weights)
    const retainage = distributeCents(codeLines.reduce((sum, line) => sum + toCents(line.retainageHeld), 0), weights)
    const changes = distributeCents(codeLines.reduce((sum, line) => sum + toCents(line.totalChanges), 0), changeWeights)
    indexes.forEach((index, position) => {
      result[index] = {
        previousCents: previous[position] ?? 0,
        retainageCents: retainage[position] ?? 0,
        priorChangesCents: changes[position] ?? 0,
      }
    })
  }
  return result
}

export type G703Row = {
  readonly budgetRevisionLineId: string | null
  readonly csiDivision: string
  readonly costCode: string
  readonly description: string
  readonly originalEstimate: number
  readonly totalChanges: number
  readonly adjustedEstimate: number
  readonly previousWorkCompleted: number
  readonly currentWorkCompleted: number
  readonly storedMaterials: number
  readonly totalCosts: number
  readonly retainageHeld: number
  readonly balanceToFinish: number
}

/** G703 rows combined back to one per cost code, as Sage keeps them. */
export function g703ByCostCode<T extends G703Row>(rows: readonly T[]): readonly G703Row[] {
  const add = (left: number, right: number): number => Math.round((left + right) * 100) / 100
  const byCode = new Map<string, G703Row>()
  for (const row of rows) {
    const current = byCode.get(row.costCode)
    byCode.set(
      row.costCode,
      current
        ? {
            ...current,
            originalEstimate: add(current.originalEstimate, row.originalEstimate),
            totalChanges: add(current.totalChanges, row.totalChanges),
            adjustedEstimate: add(current.adjustedEstimate, row.adjustedEstimate),
            previousWorkCompleted: add(current.previousWorkCompleted, row.previousWorkCompleted),
            currentWorkCompleted: add(current.currentWorkCompleted, row.currentWorkCompleted),
            storedMaterials: add(current.storedMaterials, row.storedMaterials),
            totalCosts: add(current.totalCosts, row.totalCosts),
            retainageHeld: add(current.retainageHeld, row.retainageHeld),
            balanceToFinish: add(current.balanceToFinish, row.balanceToFinish),
          }
        : {
            budgetRevisionLineId: row.budgetRevisionLineId,
            csiDivision: row.csiDivision,
            costCode: row.costCode,
            description: row.description,
            originalEstimate: row.originalEstimate,
            totalChanges: row.totalChanges,
            adjustedEstimate: row.adjustedEstimate,
            previousWorkCompleted: row.previousWorkCompleted,
            currentWorkCompleted: row.currentWorkCompleted,
            storedMaterials: row.storedMaterials,
            totalCosts: row.totalCosts,
            retainageHeld: row.retainageHeld,
            balanceToFinish: row.balanceToFinish,
          }
    )
  }
  return [...byCode.values()]
}
