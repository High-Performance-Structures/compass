/**
 * Ordering priority for project_operations rows (purchase orders first; RFQs
 * and RFIs can reuse it). Pure: no database access.
 *
 * Each row carries one shared rank, compared among the organization's rows of
 * the same record type. Lower ranks come first. Rows without a rank sort after
 * every ranked row, oldest first, so a new row lands at the bottom without
 * being written. The first reorder that touches an unranked row ranks every
 * unranked row of the organization in that same order (the store's
 * `rankUnrankedOperations`), so nothing moves.
 *
 * A list (one job's POs, or the company-wide ordering queue) is a subset of
 * that shared order, and a reorder sends only the span of the list that moved.
 * Reordering a span only reassigns the rank slots its own rows hold, so rows
 * outside it keep their place.
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
  /** Some rows have no rank yet: rank the organization's unranked rows, then plan again. */
  | { readonly kind: "unranked" }
  | { readonly kind: "invalid"; readonly reason: string }

/**
 * Upper bound on one moved span. The write is one statement whose plan is a
 * single JSON parameter, so this is about request size, not D1's
 * bound-parameter limit.
 */
export const PRIORITY_REORDER_MAX_ITEMS = 2000

/** Plain code-unit order, as SQLite's default BINARY collation compares ASCII text. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * Exactly the SQL order (PRIORITY_ORDER_BY in priority-queries.ts): ranked
 * first by rank, then unranked; then created date, then number with a blank
 * number first (SQLite sorts NULL first ascending), then id.
 */
function comparePriorityOrder(left: PriorityRankedItem, right: PriorityRankedItem): number {
  const leftRanked = left.priorityRank !== null
  const rightRanked = right.priorityRank !== null
  if (leftRanked !== rightRanked) return leftRanked ? -1 : 1
  if (left.priorityRank !== null && right.priorityRank !== null && left.priorityRank !== right.priorityRank) {
    return left.priorityRank - right.priorityRank
  }
  const created = compareText(left.createdAt, right.createdAt)
  if (created !== 0) return created
  if (left.number !== right.number) {
    if (left.number === null) return -1
    if (right.number === null) return 1
    return compareText(left.number, right.number)
  }
  return compareText(left.id, right.id)
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
 * - `items` are the rows of the moved span, as stored now (any order).
 * - `previousIds` is the span's order as the person saw it. If the stored
 *   order of those rows differs, someone else changed it: the plan is "stale".
 *
 * The span's rank slots, lowest first, are handed out in the new order.
 */
export function planPriorityReorder({
  items,
  previousIds,
  orderedIds,
}: {
  readonly items: readonly PriorityRankedItem[]
  readonly previousIds: readonly string[]
  readonly orderedIds: readonly string[]
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
  if (current.some((item) => item.priorityRank === null)) return { kind: "unranked" }

  // Slots rise strictly: two rows sharing a rank would otherwise fall back to
  // their creation dates and ignore the order the person chose.
  const slots: number[] = []
  for (const item of current) {
    const slot = item.priorityRank ?? 0
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
