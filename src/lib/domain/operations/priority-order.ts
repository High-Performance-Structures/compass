/**
 * Ordering priority for project_operations rows (purchase orders first; RFQs
 * and RFIs can reuse it). Pure: no database access.
 *
 * Each row carries one shared rank, compared among the organization's rows of
 * the same record type. Lower ranks come first. Rows without a rank sort after
 * every ranked row, oldest first, so a new row lands at the bottom without
 * being written.
 *
 * A list (one job's POs, or the company-wide ordering queue) is a subset of
 * that shared order. Reordering a subset only reassigns the rank slots its own
 * rows hold, so rows outside it keep their place.
 */

export type PriorityRankedItem = {
  readonly id: string
  readonly priorityRank: number | null
  readonly createdAt: string
  /** Reference number (such as a PO number), the last tie-breaker. */
  readonly number: string | null
}

export type PriorityRankUpdate = {
  readonly id: string
  /** The rank stored now, for the write's guard. */
  readonly previousRank: number | null
  readonly nextRank: number
}

export type PriorityReorderPlan =
  | { readonly kind: "unchanged" }
  | { readonly kind: "updates"; readonly updates: readonly PriorityRankUpdate[] }
  | { readonly kind: "stale" }
  | { readonly kind: "invalid"; readonly reason: string }

/** Upper bound on one reorder: keeps the write batch well inside D1's limits. */
export const PRIORITY_REORDER_MAX_ITEMS = 500

/** Ranked first by rank, then unranked oldest first; ties by number, then id. */
function comparePriorityOrder(left: PriorityRankedItem, right: PriorityRankedItem): number {
  const leftRanked = left.priorityRank !== null
  const rightRanked = right.priorityRank !== null
  if (leftRanked !== rightRanked) return leftRanked ? -1 : 1
  if (left.priorityRank !== null && right.priorityRank !== null && left.priorityRank !== right.priorityRank) {
    return left.priorityRank - right.priorityRank
  }
  if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? -1 : 1
  const numbers = (left.number ?? "").localeCompare(right.number ?? "", undefined, { numeric: true })
  if (numbers !== 0) return numbers
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}

export function sortByPriorityOrder<T extends PriorityRankedItem>(items: readonly T[]): T[] {
  return [...items].sort(comparePriorityOrder)
}

function samePriorityOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

/**
 * Plans the rank writes that put `orderedIds` in that order.
 *
 * - `items` are the rows the list showed, as stored now (any order).
 * - `previousIds` is the order the person saw. If the stored order of those
 *   rows differs, someone else changed it: the plan is "stale".
 * - `maxRank` is the highest rank in the organization's shared order (for
 *   the record type), or null when nothing is ranked yet.
 *
 * Unranked rows in the list first get ranks after `maxRank` in their current
 * order, which keeps them where they were. Then the list's rank slots, lowest
 * first, are handed out in the new order.
 */
export function planPriorityReorder({
  items,
  previousIds,
  orderedIds,
  maxRank,
}: {
  readonly items: readonly PriorityRankedItem[]
  readonly previousIds: readonly string[]
  readonly orderedIds: readonly string[]
  readonly maxRank: number | null
}): PriorityReorderPlan {
  if (orderedIds.length > PRIORITY_REORDER_MAX_ITEMS) {
    return { kind: "invalid", reason: `Reorder at most ${PRIORITY_REORDER_MAX_ITEMS} items at a time.` }
  }
  const unique = new Set(orderedIds)
  const previous = new Set(previousIds)
  if (
    unique.size !== orderedIds.length ||
    previous.size !== previousIds.length ||
    orderedIds.length !== previousIds.length ||
    orderedIds.some((id) => !previous.has(id))
  ) {
    return { kind: "invalid", reason: "Reorder only the items in this list." }
  }
  const byId = new Map(items.map((item) => [item.id, item]))
  // A row that was deleted or moved out of reach since the list loaded.
  if (previousIds.some((id) => !byId.has(id))) return { kind: "stale" }
  const current = sortByPriorityOrder(previousIds.flatMap((id) => byId.get(id) ?? []))
  if (!samePriorityOrder(current.map((item) => item.id), previousIds)) return { kind: "stale" }
  if (samePriorityOrder(previousIds, orderedIds)) return { kind: "unchanged" }

  let nextFreeRank = Math.max(maxRank ?? 0, ...current.map((item) => item.priorityRank ?? 0)) + 1
  // `current` is sorted, so unranked rows are its tail and take rising ranks.
  // Slots rise strictly: two rows sharing a rank would otherwise fall back to
  // their creation dates and ignore the order the person chose.
  const slots: number[] = []
  for (const item of current) {
    const slot = item.priorityRank ?? nextFreeRank++
    const previousSlot = slots.at(-1)
    slots.push(previousSlot !== undefined && slot <= previousSlot ? previousSlot + 1 : slot)
  }
  const updates = orderedIds.flatMap((id, index): PriorityRankUpdate[] => {
    const item = byId.get(id)
    const nextRank = slots[index]
    if (!item || nextRank === undefined || item.priorityRank === nextRank) return []
    return [{ id, previousRank: item.priorityRank, nextRank }]
  })
  return updates.length === 0 ? { kind: "unchanged" } : { kind: "updates", updates }
}
