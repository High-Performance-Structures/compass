import { describe, expect, it } from "vitest"

import {
  choiceLeadTime,
  governingLeadTimeChoice,
  leadTimeLabel,
  ownerLeadTimeNote,
  selectionLeadTimeWarning,
  selectionNeededByDate,
  staffLeadTimeNote,
} from "@/lib/domain/selections/lead-time-rules"

const base = { selectionStatus: "needed", neededByDate: "2026-12-04", leadTimeDays: 56, warnDays: 7 } as const

describe("choiceLeadTime", () => {
  it("orders by the due date minus the lead time", () => {
    // Dec 4 − 56 days = Oct 9.
    expect(choiceLeadTime({ ...base, today: "2026-10-05" })).toEqual({
      level: "soon",
      orderByDate: "2026-10-09",
      neededByDate: "2026-12-04",
      leadTimeDays: 56,
      daysLeft: 4,
    })
  })

  it("is late once the order-by date has passed, and quiet outside the warning window", () => {
    expect(choiceLeadTime({ ...base, today: "2026-10-10" })).toMatchObject({ level: "late", daysLeft: -1 })
    expect(choiceLeadTime({ ...base, today: "2026-10-09" })).toMatchObject({ level: "soon", daysLeft: 0 })
    expect(choiceLeadTime({ ...base, today: "2026-10-02" })).toMatchObject({ level: "soon", daysLeft: 7 })
    expect(choiceLeadTime({ ...base, today: "2026-10-01" })).toBeNull()
    expect(choiceLeadTime({ ...base, warnDays: 14, today: "2026-10-01" })).toMatchObject({ level: "soon" })
  })

  it("ignores settled selections, missing lead times or due dates, and due dates already past", () => {
    for (const selectionStatus of ["ordered", "installed", "deferred", "unavailable"] as const) {
      expect(choiceLeadTime({ ...base, selectionStatus, today: "2026-10-10" })).toBeNull()
    }
    expect(choiceLeadTime({ ...base, leadTimeDays: null, today: "2026-10-10" })).toBeNull()
    expect(choiceLeadTime({ ...base, leadTimeDays: 0, today: "2026-10-10" })).toBeNull()
    expect(choiceLeadTime({ ...base, neededByDate: null, today: "2026-10-10" })).toBeNull()
    expect(choiceLeadTime({ ...base, today: "2026-12-05" })).toBeNull()
  })
})

describe("governingLeadTimeChoice", () => {
  const choices = [
    { id: "a", chosen: false, status: "proposed", leadTimeDays: 14 },
    { id: "b", chosen: false, status: "available", leadTimeDays: 56 },
    { id: "c", chosen: false, status: "declined", leadTimeDays: 90 },
    { id: "d", chosen: false, status: "proposed", leadTimeDays: null },
  ] as const

  it("uses the owner's pick, else the longest open lead time", () => {
    expect(governingLeadTimeChoice(choices)?.id).toBe("b")
    expect(governingLeadTimeChoice(choices.map((choice) => ({ ...choice, chosen: choice.id === "a" })))?.id).toBe("a")
    // A pick with no lead time means nothing to warn about.
    expect(governingLeadTimeChoice(choices.map((choice) => ({ ...choice, chosen: choice.id === "d" })))?.leadTimeDays).toBeNull()
    expect(governingLeadTimeChoice([])).toBeNull()
  })

  it("names the governing choice on the selection warning", () => {
    expect(
      selectionLeadTimeWarning({ selectionId: "s1", status: "owner_review", neededByDate: "2026-12-04", choices, today: "2026-10-05", warnDays: 7 }),
    ).toMatchObject({ selectionId: "s1", choiceId: "b", orderByDate: "2026-10-09", level: "soon" })
    expect(
      selectionLeadTimeWarning({ selectionId: "s1", status: "ordered", neededByDate: "2026-12-04", choices, today: "2026-10-05", warnDays: 7 }),
    ).toBeNull()
  })
})

describe("wording", () => {
  it("prefers the selection's own due date over its Selection Phase's", () => {
    expect(selectionNeededByDate("2026-12-01", "2026-12-04")).toBe("2026-12-01")
    expect(selectionNeededByDate(null, "2026-12-04")).toBe("2026-12-04")
    expect(selectionNeededByDate(null, null)).toBeNull()
  })

  it("says weeks for whole weeks", () => {
    expect(leadTimeLabel(56)).toBe("8-week lead time")
    expect(leadTimeLabel(10)).toBe("10-day lead time")
    expect(leadTimeLabel(7)).toBe("7-day lead time")
  })

  it("tells staff when to order and owners when to choose, without supplier details", () => {
    const soon = choiceLeadTime({ ...base, today: "2026-10-05" })
    const late = choiceLeadTime({ ...base, today: "2026-10-12" })
    if (!soon || !late) throw new Error("expected warnings")
    expect(staffLeadTimeNote(soon)).toBe("8-week lead time, needed Dec 4 — order by Oct 9")
    expect(staffLeadTimeNote(late)).toBe("8-week lead time — won't arrive by Dec 4 (order-by date was Oct 9)")
    expect(ownerLeadTimeNote(soon)).toBe("Longer lead time: choose by Oct 9 to stay on schedule.")
    expect(ownerLeadTimeNote(late)).toContain("as soon as you can")
  })
})
