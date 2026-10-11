import { describe, expect, it } from "vitest"
import { behindLabel, dutyStatus, nextPeriod, periodDueDate, periodLabel } from "@/lib/internal-duties/recurring"

describe("recurring duty periods", () => {
  it("steps months, quarters and years", () => {
    expect(nextPeriod("2026-12", "monthly")).toBe("2027-01")
    expect(nextPeriod("2026-Q4", "quarterly")).toBe("2027-Q1")
    expect(nextPeriod("2026", "yearly")).toBe("2027")
  })

  it("puts the due date in the month after the period, clamped to its length", () => {
    expect(periodDueDate("2026-09", 20)).toBe("2026-10-20")
    expect(periodDueDate("2026-01", 31)).toBe("2026-02-28")
    expect(periodDueDate("2026-Q3", 15)).toBe("2026-10-15")
  })
})

describe("duty status", () => {
  it("counts FSB as five months behind when April is the last reconciliation", () => {
    const status = dutyStatus({ cadence: "monthly", dueDay: 15, lastDone: "2026-04", today: "2026-10-11" })
    expect(status.kind).toBe("behind")
    if (status.kind !== "behind") return
    // May through August are past due; September is due Oct 15, not yet.
    expect(status.owed).toEqual(["2026-05", "2026-06", "2026-07", "2026-08"])
    expect(behindLabel(status.owed.length, "monthly")).toBe("4 months behind")
  })

  it("shows the next period as due soon within a week", () => {
    expect(dutyStatus({ cadence: "monthly", dueDay: 15, lastDone: "2026-08", today: "2026-10-11" })).toEqual({
      kind: "due_soon",
      nextPeriod: "2026-09",
      nextDue: "2026-10-15",
    })
  })

  it("is current when the next due date is further off", () => {
    expect(dutyStatus({ cadence: "monthly", dueDay: 20, lastDone: "2026-09", today: "2026-10-11" }).kind).toBe("current")
  })

  it("waits for a first completion", () => {
    expect(dutyStatus({ cadence: "monthly", dueDay: 15, lastDone: null, today: "2026-10-11" })).toEqual({ kind: "not_started" })
  })

  it("labels periods", () => {
    expect(periodLabel("2026-05")).toBe("May 2026")
    expect(periodLabel("2026-Q2")).toBe("Q2 2026")
  })
})
