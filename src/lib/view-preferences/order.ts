/** Reads a saved list order: unique string ids, at most 100. */
export function parseSavedOrder(value: string | null | undefined): readonly string[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return [...new Set(parsed.filter((item): item is string => typeof item === "string" && item.length <= 80))].slice(0, 100)
  } catch {
    return []
  }
}

/**
 * Applies a saved order to items: saved ids first in their saved order, then
 * any items the saved order doesn't mention, in their default order.
 */
export function applySavedOrder<T extends { readonly id: string }>(
  items: readonly T[],
  savedOrder: readonly string[],
): readonly T[] {
  if (savedOrder.length === 0) return items
  const byId = new Map(items.map((item) => [item.id, item]))
  const ordered: T[] = []
  for (const id of savedOrder) {
    const item = byId.get(id)
    if (item) {
      ordered.push(item)
      byId.delete(id)
    }
  }
  return [...ordered, ...items.filter((item) => byId.has(item.id))]
}

export const ROLE_DASHBOARD_VIEW_PREFIX = "role-dashboard:"
