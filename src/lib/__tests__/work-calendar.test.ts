import { describe, expect, it } from "vitest"

import {
  projectTodoHref,
  resolveHOfficeProjectId,
  scheduleItemHref,
  workCalendarEntryMatches,
} from "@/lib/work-calendar"

const entry = {
  projectLabel: "O-202",
  projectName: "Loeffler Residence",
  title: "Confirm cabinet delivery",
  status: "open",
  priority: "normal",
  assignedTo: "Rebekah",
  companyName: "HPS",
  sourceLabel: "Staff Task TASK-014",
}

describe("work calendar navigation and search", () => {
  it("matches a project name even when the display label is its project number", () => {
    expect(workCalendarEntryMatches(entry, "Loeffler")).toBe(true)
    expect(workCalendarEntryMatches(entry, "O-202")).toBe(true)
    expect(workCalendarEntryMatches(entry, "cabinet delivery")).toBe(true)
    expect(workCalendarEntryMatches(entry, "Loomis")).toBe(false)
  })

  it("builds focused links for to-dos and schedule items", () => {
    expect(projectTodoHref("proj/o 202", "todo/14")).toBe(
      "/dashboard/projects/proj%2Fo%20202/todos?item=todo%2F14#todo-todo%2F14"
    )
    expect(scheduleItemHref("proj/o 202", "task/8")).toBe(
      "/dashboard/projects/proj%2Fo%20202/schedule?view=list&item=task%2F8#schedule-item-task%2F8"
    )
  })
})

describe("H-Office default project resolution", () => {
  it("resolves one exact H-Office identity", () => {
    expect(
      resolveHOfficeProjectId([
        { id: "loeffler", name: "Loeffler", projectNumber: "O-202" },
        { id: "office", name: "H-Office", projectNumber: "H-OFFICE" },
      ])
    ).toBe("office")
  })

  it("fails closed when the default is missing or ambiguous", () => {
    expect(
      resolveHOfficeProjectId([
        { id: "loeffler", name: "Loeffler", projectNumber: "O-202" },
      ])
    ).toBeNull()
    expect(
      resolveHOfficeProjectId([
        { id: "office-1", name: "H-Office", projectNumber: null },
        { id: "office-2", name: "H Office Project", projectNumber: null },
      ])
    ).toBeNull()
  })
})
