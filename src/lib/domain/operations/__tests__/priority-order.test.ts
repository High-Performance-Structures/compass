import { describe, expect, it } from "vitest"

import {
  planPriorityReorder,
  PRIORITY_REORDER_MAX_ITEMS,
  sortByPriorityOrder,
  type PriorityRankedItem,
  type PriorityReorderPlan,
} from "../priority-order"

function item(id: string, priorityRank: number | null, createdAt = "2026-11-01T00:00:00.000Z"): PriorityRankedItem {
  return { id, priorityRank, createdAt, number: id }
}

/** Applies a plan to the items and returns the new shared order. */
function applied(items: readonly PriorityRankedItem[], plan: PriorityReorderPlan): readonly string[] {
  const updates = plan.kind === "updates" ? new Map(plan.updates.map((u) => [u.id, u.nextRank])) : new Map()
  return sortByPriorityOrder(items.map((entry) => ({ ...entry, priorityRank: updates.get(entry.id) ?? entry.priorityRank })))
    .map((entry) => entry.id)
}

describe("sortByPriorityOrder", () => {
  it("puts ranked rows first by rank, then unranked rows oldest first", () => {
    const items = [
      item("new", null, "2026-11-03T00:00:00.000Z"),
      item("b", 2),
      item("old", null, "2026-10-01T00:00:00.000Z"),
      item("a", 1),
    ]
    expect(sortByPriorityOrder(items).map((entry) => entry.id)).toEqual(["a", "b", "old", "new"])
  })

  it("breaks equal dates by reference number, numerically", () => {
    const items = [item("PO-10", null), item("PO-9", null)]
    expect(sortByPriorityOrder(items).map((entry) => entry.id)).toEqual(["PO-9", "PO-10"])
  })
})

describe("planPriorityReorder", () => {
  it("reassigns only the list's own rank slots", () => {
    // Shared order: a(1) x(2) b(3) y(4) c(5). The list is one job: a, b, c.
    const items = [item("a", 1), item("b", 3), item("c", 5)]
    const plan = planPriorityReorder({ items, previousIds: ["a", "b", "c"], orderedIds: ["c", "a", "b"], maxRank: 5 })
    expect(plan).toEqual({
      kind: "updates",
      updates: [
        { id: "c", previousRank: 5, nextRank: 1 },
        { id: "a", previousRank: 1, nextRank: 3 },
        { id: "b", previousRank: 3, nextRank: 5 },
      ],
    })
    // Rows outside the list (x at 2, y at 4) keep their slots.
    const shared = [...items, item("x", 2), item("y", 4)]
    expect(applied(shared, plan)).toEqual(["c", "x", "a", "y", "b"])
  })

  it("ranks unranked rows after the shared maximum, keeping them in place", () => {
    const items = [
      item("a", 4),
      item("old", null, "2026-10-01T00:00:00.000Z"),
      item("new", null, "2026-11-02T00:00:00.000Z"),
    ]
    const plan = planPriorityReorder({
      items,
      previousIds: ["a", "old", "new"],
      orderedIds: ["new", "a", "old"],
      maxRank: 9,
    })
    expect(plan).toEqual({
      kind: "updates",
      updates: [
        { id: "new", previousRank: null, nextRank: 4 },
        { id: "a", previousRank: 4, nextRank: 10 },
        { id: "old", previousRank: null, nextRank: 11 },
      ],
    })
  })

  it("gives rows that share a rank distinct slots so the chosen order holds", () => {
    const items = [item("a", 2, "2026-10-01T00:00:00.000Z"), item("b", 2, "2026-10-02T00:00:00.000Z")]
    const plan = planPriorityReorder({ items, previousIds: ["a", "b"], orderedIds: ["b", "a"], maxRank: 2 })
    expect(applied(items, plan)).toEqual(["b", "a"])
  })

  it("reports no change for the same order", () => {
    const items = [item("a", 1), item("b", 2)]
    expect(planPriorityReorder({ items, previousIds: ["a", "b"], orderedIds: ["a", "b"], maxRank: 2 }))
      .toEqual({ kind: "unchanged" })
  })

  describe("stale guard", () => {
    it("refuses when the stored order differs from what the person saw", () => {
      // Someone else moved b above a after the list loaded.
      const items = [item("a", 2), item("b", 1)]
      expect(planPriorityReorder({ items, previousIds: ["a", "b"], orderedIds: ["b", "a"], maxRank: 2 }))
        .toEqual({ kind: "stale" })
    })

    it("refuses when a row in the list no longer exists", () => {
      const items = [item("a", 1)]
      expect(planPriorityReorder({ items, previousIds: ["a", "gone"], orderedIds: ["gone", "a"], maxRank: 1 }))
        .toEqual({ kind: "stale" })
    })
  })

  it("rejects an order that adds, drops or repeats rows", () => {
    const items = [item("a", 1), item("b", 2)]
    for (const orderedIds of [["a"], ["a", "c"], ["a", "a"], ["a", "b", "c"]]) {
      expect(planPriorityReorder({ items, previousIds: ["a", "b"], orderedIds, maxRank: 2 }).kind).toBe("invalid")
    }
  })

  it("caps the size of one reorder", () => {
    const ids = Array.from({ length: PRIORITY_REORDER_MAX_ITEMS + 1 }, (_, index) => `id-${index}`)
    expect(planPriorityReorder({ items: [], previousIds: ids, orderedIds: ids, maxRank: null }).kind).toBe("invalid")
  })
})
