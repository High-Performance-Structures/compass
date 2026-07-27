import { describe, expect, it } from "vitest"

import {
  addDaysToIsoDate,
  buildOwnerUpdateDraftPrompt,
  cleanOwnerUpdateDraft,
  defaultOwnerUpdatePeriod,
  isCompletedScheduleCandidate,
  isLookAheadScheduleCandidate,
  ownerUpdateTodoTiming,
} from "@/lib/owner-updates/composer"

describe("owner update composer", () => {
  it("defaults to a seven-day reporting window", () => {
    expect(defaultOwnerUpdatePeriod("2026-07-27")).toEqual({
      startDate: "2026-07-21",
      endDate: "2026-07-27",
    })
    expect(addDaysToIsoDate("2026-07-31", 1)).toBe("2026-08-01")
  })

  it("separates completed and look-ahead schedule candidates", () => {
    expect(
      isCompletedScheduleCandidate(
        {
          status: "COMPLETE",
          percentComplete: 100,
          endDate: "2026-07-24",
        },
        "2026-07-20",
        "2026-07-26"
      )
    ).toBe(true)
    expect(
      isLookAheadScheduleCandidate(
        {
          status: "IN_PROGRESS",
          percentComplete: 40,
          startDate: "2026-07-27",
          endDate: "2026-07-31",
        },
        "2026-07-26"
      )
    ).toBe(true)
  })

  it("includes to-dos from the reporting period and following week", () => {
    expect(
      ownerUpdateTodoTiming(
        "2026-07-24",
        "2026-07-20",
        "2026-07-26"
      )
    ).toBe("reporting_period")
    expect(
      ownerUpdateTodoTiming(
        "2026-08-02",
        "2026-07-20",
        "2026-07-26"
      )
    ).toBe("upcoming")
    expect(
      ownerUpdateTodoTiming(
        "2026-08-03",
        "2026-07-20",
        "2026-07-26"
      )
    ).toBeNull()
  })

  it("builds a bounded source-only Jarvis instruction", () => {
    const prompt = buildOwnerUpdateDraftPrompt({
      projectLabel: "O-202 Loeffler",
      periodStart: "2026-07-20",
      periodEnd: "2026-07-26",
      dailyLogs: [
        {
          logDate: "2026-07-24",
          workCompleted: "Installed cabinets.",
          issues: null,
          notes: "Countertop template next.",
        },
      ],
      attachments: [
        {
          fileName: "kitchen.jpg",
          caption: "Kitchen cabinets installed",
          kind: "photo",
        },
      ],
      completedScheduleItems: [],
      lookAheadScheduleItems: [],
      todos: [],
    })

    expect(prompt).toContain("Use only the supplied information")
    expect(prompt).toContain("Installed cabinets.")
    expect(prompt).toContain("Countertop template next.")
    expect(prompt).toContain("Kitchen cabinets installed")
    expect(cleanOwnerUpdateDraft("```text\nDraft summary\n```")).toBe(
      "Draft summary"
    )
  })
})
