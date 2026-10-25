import { describe, expect, it } from "vitest"

import {
  buildTodaysPlan,
  measureWeekLoad,
  planDigestText,
  weekBounds,
  type PlanScheduleItem,
  type PlanTodo,
} from "@/lib/morning-plan/plan"
import type { WorkdayExceptionData } from "@/lib/schedule/types"

// Wednesday, Oct 28, 2026. Its week runs Mon Oct 26 to Sun Nov 1.
const TODAY = "2026-10-28"

function task(id: string, startDate: string, endDate: string): PlanScheduleItem {
  return { id, title: `Task ${id}`, projectLabel: "O-202", startDate, endDate, href: `/s/${id}` }
}

function todo(id: string, dueDate: string, priority = "normal"): PlanTodo {
  return { id, title: `To-do ${id}`, projectLabel: "O-170", dueDate, priority, href: `/t/${id}` }
}

describe("weekBounds", () => {
  it("runs Monday to Sunday", () => {
    expect(weekBounds(TODAY)).toEqual({ start: "2026-10-26", end: "2026-11-01" })
    expect(weekBounds("2026-11-01")).toEqual({ start: "2026-10-26", end: "2026-11-01" })
    expect(weekBounds("2026-10-26")).toEqual({ start: "2026-10-26", end: "2026-11-01" })
  })
})

describe("buildTodaysPlan", () => {
  it("orders overdue, today, meetings, then later this week, and drops next week", () => {
    const plan = buildTodaysPlan({
      today: TODAY,
      scheduleItems: [
        task("later", "2026-10-30", "2026-10-30"),
        task("underway", "2026-10-27", "2026-10-29"),
        task("due", "2026-10-26", TODAY),
        task("late", "2026-10-20", "2026-10-22"),
        task("next-week", "2026-11-03", "2026-11-04"),
      ],
      todos: [todo("late-todo", "2026-10-21"), todo("today-todo", TODAY), todo("friday", "2026-10-30")],
      meetings: [
        { id: "m2", title: "Site walk", projectLabel: "O-202", startTime: "14:00", href: "/m2" },
        { id: "m1", title: "Office meeting", projectLabel: null, startTime: "08:30", href: "/m1" },
        { id: "m0", title: "Holiday party", projectLabel: null, startTime: null, href: "/m0" },
      ],
    })
    expect(plan.entries.map((entry) => `${entry.section}:${entry.key}`)).toEqual([
      "overdue:todo:late-todo",
      "overdue:schedule:late",
      "today:schedule:due",
      "today:todo:today-todo",
      "today:schedule:underway",
      "meetings:meeting:m0",
      "meetings:meeting:m1",
      "meetings:meeting:m2",
      "thisWeek:schedule:later",
      "thisWeek:todo:friday",
    ])
    expect(plan.entries.find((entry) => entry.key === "meeting:m1")?.detail).toBe("8:30 AM")
    expect(plan.entries.find((entry) => entry.key === "meeting:m0")?.detail).toBe("All day")
    expect(plan.entries.find((entry) => entry.key === "schedule:due")?.detail).toBe("Due today")
  })
})

describe("measureWeekLoad", () => {
  const base = { today: TODAY, todos: [] as readonly PlanTodo[], exceptions: [] as readonly WorkdayExceptionData[], thresholdPercent: 100, todoWorkdays: 0.25 }

  it("counts only the workdays each item covers inside the week", () => {
    const load = measureWeekLoad({
      ...base,
      // Fri before through Tue: Mon + Tue inside the week. Thu to next Wed: Thu + Fri.
      scheduleItems: [task("a", "2026-10-23", "2026-10-27"), task("b", "2026-10-29", "2026-11-04")],
    })
    expect(load).toMatchObject({ availableWorkdays: 5, assignedWorkdays: 4, percent: 80, overloaded: false, suggestions: [] })
  })

  it("flags overlapping work and suggests the lowest-priority, latest-due items first", () => {
    const load = measureWeekLoad({
      ...base,
      scheduleItems: [task("frame", "2026-10-26", "2026-10-30"), task("trim", "2026-10-28", "2026-10-30")],
      todos: [todo("call", "2026-10-29", "high"), todo("file", "2026-10-30", "low")],
    })
    expect(load.assignedWorkdays).toBe(8.5)
    expect(load.overloaded).toBe(true)
    expect(load.percent).toBe(170)
    // The low-priority to-do goes first, then the latest-due schedule item;
    // that brings 8.5 workdays under the 5 available, so it stops there.
    expect(load.suggestions.map((item) => item.key)).toEqual(["todo:file", "schedule:frame"])
  })

  it("uses company holidays from the workday calendar", () => {
    const holiday: WorkdayExceptionData = {
      id: "h",
      projectId: "office",
      title: "Closed",
      startDate: "2026-10-29",
      endDate: "2026-10-30",
      type: "non_working",
      category: "company_holiday",
      recurrence: "one_time",
      notes: null,
      createdAt: "",
      updatedAt: "",
    }
    const load = measureWeekLoad({ ...base, exceptions: [holiday], scheduleItems: [task("a", "2026-10-26", "2026-10-30")] })
    expect(load).toMatchObject({ availableWorkdays: 3, assignedWorkdays: 3, overloaded: false })
    const higher = measureWeekLoad({ ...base, exceptions: [holiday], thresholdPercent: 50, scheduleItems: [task("a", "2026-10-26", "2026-10-30")] })
    expect(higher.overloaded).toBe(true)
  })
})

describe("planDigestText", () => {
  it("lists sections and notes an overloaded week", () => {
    const plan = buildTodaysPlan({ today: TODAY, scheduleItems: [task("due", TODAY, TODAY)], todos: [], meetings: [] })
    const load = measureWeekLoad({ today: TODAY, scheduleItems: [task("x", "2026-10-26", "2026-10-30"), task("y", "2026-10-26", "2026-10-30")], todos: [], exceptions: [], thresholdPercent: 100, todoWorkdays: 0 })
    const text = planDigestText(plan, load)
    expect(text).toContain("Today:\n- O-202 · Task due (Due today)")
    expect(text).toContain("This week holds 10 workdays of assigned work for 5 available.")
  })

  it("says so when nothing is assigned", () => {
    expect(planDigestText({ today: TODAY, entries: [] }, null)).toBe("Nothing is assigned to you for today or the rest of this week.")
  })
})
