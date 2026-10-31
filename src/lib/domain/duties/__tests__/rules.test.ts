import { describe, expect, it } from "vitest"

import { isUniqueConflict, nextRecurringDutySortOrder, recurringDoneEntryNote, weekStartOf } from "../rules"

describe("weekStartOf", () => {
  it("returns the Monday of the week", () => {
    expect(weekStartOf(new Date(2026, 9, 31))).toBe("2026-10-26") // Saturday
    expect(weekStartOf(new Date(2026, 10, 1))).toBe("2026-10-26") // Sunday
    expect(weekStartOf(new Date(2026, 10, 2))).toBe("2026-11-02") // Monday
  })
})

describe("recurringDoneEntryNote", () => {
  it("names the duty, account and period, then the notes", () => {
    expect(
      recurringDoneEntryNote({ title: "Bank rec", accountName: "Operating", periodLabel: "May 2026", notes: " Matched " })
    ).toBe("Bank rec · Operating: May 2026. Matched")
  })

  it("leaves out an empty account and empty notes", () => {
    expect(recurringDoneEntryNote({ title: "Sales tax", accountName: null, periodLabel: "Q2 2026", notes: "  " })).toBe(
      "Sales tax: Q2 2026"
    )
  })
})

describe("nextRecurringDutySortOrder", () => {
  it("goes after the last duty, starting at 1", () => {
    expect(nextRecurringDutySortOrder(null)).toBe(1)
    expect(nextRecurringDutySortOrder(undefined)).toBe(1)
    expect(nextRecurringDutySortOrder(4)).toBe(5)
  })
})

describe("isUniqueConflict", () => {
  it("recognizes D1 unique-index errors", () => {
    expect(isUniqueConflict(new Error("D1_ERROR: UNIQUE constraint failed"))).toBe(true)
    expect(isUniqueConflict(new Error("unique constraint"))).toBe(true)
    expect(isUniqueConflict(new Error("other"))).toBe(false)
    expect(isUniqueConflict("UNIQUE")).toBe(false)
  })
})
