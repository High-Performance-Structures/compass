import { describe, expect, it } from "vitest"
import type { ScheduleTaskData } from "@/lib/schedule/types"
import { EMPTY_FILTERS } from "@/lib/schedule/types"
import { NO_CONFLICT_SETTINGS } from "@/lib/schedule/conflicts"
import { SCHEDULE_LIST_COLUMNS } from "@/lib/schedule/saved-views"
import {
  parseScheduleCsv,
  requestedScheduleSettings,
  scheduleColumnLabel,
  scheduleCsv,
  schedulePhaseOptions,
  schedulePrintItems,
  scheduleQueryString,
  toggleListValue,
  visibleScheduleTasks,
} from "../schedule-view-rules"

function task(overrides: Partial<ScheduleTaskData>): ScheduleTaskData {
  return {
    id: "t",
    projectId: "p1",
    title: "Item",
    startDate: "2026-11-02",
    workdays: 1,
    endDateCalculated: "2026-11-02",
    phase: "framing",
    displayColor: null,
    status: "PENDING",
    isCriticalPath: false,
    isMilestone: false,
    percentComplete: 0,
    assignedTo: null,
    sortOrder: 0,
    createdAt: "2026-10-01",
    updatedAt: "2026-10-01",
    ...overrides,
  }
}

function params(query: string): URLSearchParams {
  return new URLSearchParams(query)
}

const baseInput = {
  conflicts: new Map(),
  conflictsOnly: false,
  filters: EMPTY_FILTERS,
  preset: "all" as const,
  currentUserAssigneeTerms: [],
  orderMode: "chronological" as const,
  groupMode: "none" as const,
  scheduleProjects: [],
  conflictSettings: NO_CONFLICT_SETTINGS,
  now: new Date(2026, 10, 1, 15, 30),
}

describe("schedule view rules", () => {
  it("reads only known settings from the URL", () => {
    expect(requestedScheduleSettings(params(""))).toEqual({
      preset: "all",
      group: "none",
      columns: [...SCHEDULE_LIST_COLUMNS],
      statuses: [],
    })
    const requested = requestedScheduleSettings(
      params("preset=past-due&group=crew&columns=phase,bogus&status=COMPLETE,NOPE")
    )
    expect(requested.preset).toBe("past-due")
    expect(requested.group).toBe("crew")
    expect(requested.columns).toEqual(["phase"])
    expect(requested.statuses).toEqual(["COMPLETE"])
    expect(requestedScheduleSettings(params("preset=bad&group=bad")).preset).toBe("all")
  })

  it("writes the view state to the query and drops defaults", () => {
    const state = {
      view: "gantt" as const,
      orderMode: "chronological" as const,
      filters: EMPTY_FILTERS,
      preset: "all" as const,
      groupMode: "none" as const,
      conflictsOnly: false,
      visibleColumns: [...SCHEDULE_LIST_COLUMNS],
    }
    expect(scheduleQueryString("mode=projects&q=old", state)).toBe(
      "mode=projects&view=gantt&order=chronological"
    )
    expect(
      scheduleQueryString("", {
        ...state,
        filters: { status: ["PENDING"], phase: ["a", "b"], assignedTo: "Bo", search: "x" },
        preset: "next-7",
        groupMode: "phase",
        conflictsOnly: true,
        visibleColumns: ["phase"],
      })
    ).toBe(
      "view=gantt&order=chronological&status=PENDING&phase=a%2Cb&assignee=Bo&q=x&preset=next-7&group=phase&conflicts=1&columns=phase"
    )
  })

  it("lists each phase once in first-seen order", () => {
    expect(
      schedulePhaseOptions([task({ phase: "b" }), task({ phase: "" }), task({ phase: "a" }), task({ phase: "b" })])
    ).toEqual([
      { value: "b", label: "b" },
      { value: "a", label: "a" },
    ])
  })

  it("filters by status, phase, assignee, search and conflicts", () => {
    const tasks = [
      task({ id: "1", title: "Frame walls", status: "PENDING", assignedTo: "Acme Crew" }),
      task({ id: "2", title: "Pour slab", status: "COMPLETE", phase: "concrete" }),
    ]
    const ids = (overrides: Partial<Parameters<typeof visibleScheduleTasks>[0]>) =>
      visibleScheduleTasks({ ...baseInput, tasks, ...overrides }).map((item) => item.id)
    expect(ids({})).toEqual(["1", "2"])
    expect(ids({ filters: { ...EMPTY_FILTERS, status: ["COMPLETE"] } })).toEqual(["2"])
    expect(ids({ filters: { ...EMPTY_FILTERS, phase: ["concrete"] } })).toEqual(["2"])
    expect(ids({ filters: { ...EMPTY_FILTERS, assignedTo: "acme" } })).toEqual(["1"])
    expect(ids({ filters: { ...EMPTY_FILTERS, search: "SLAB" } })).toEqual(["2"])
    expect(ids({ conflictsOnly: true, conflicts: new Map([["1", []]]) })).toEqual(["1"])
  })

  it("applies date presets against today's date", () => {
    const tasks = [
      task({ id: "late", startDate: "2026-10-20", endDateCalculated: "2026-10-31" }),
      task({ id: "done", startDate: "2026-10-20", endDateCalculated: "2026-10-31", status: "COMPLETE" }),
      task({ id: "today", startDate: "2026-11-01", endDateCalculated: "2026-11-01" }),
      task({ id: "week", startDate: "2026-11-08", endDateCalculated: "2026-11-09" }),
      task({ id: "later", startDate: "2026-11-20", endDateCalculated: "2026-11-21" }),
      task({ id: "mine", startDate: "2026-12-20", endDateCalculated: "2026-12-21", assignedTo: " Jane Doe " }),
    ]
    const ids = (preset: Parameters<typeof visibleScheduleTasks>[0]["preset"], terms: readonly string[] = []) =>
      visibleScheduleTasks({ ...baseInput, tasks, preset, currentUserAssigneeTerms: terms }).map((item) => item.id)
    expect(ids("past-due")).toEqual(["late"])
    expect(ids("next-7")).toEqual(["today", "week"])
    expect(ids("next-30")).toEqual(["today", "week", "later"])
    expect(ids("my-items", ["jane"])).toEqual(["mine"])
    expect(ids("my-items", [" "])).toEqual([])
  })

  it("matches an item by any one of its people, all equal", () => {
    const shared = task({
      id: "shared",
      assignedTo: "Ann Lee, Jane Doe",
      people: [
        { name: "Ann Lee", assignedUserId: "u-ann", projectContactId: null },
        { name: "Jane Doe", assignedUserId: null, projectContactId: null },
      ],
    })
    const other = task({ id: "other", assignedTo: "Bo Diaz" })
    const ids = (input: Partial<Parameters<typeof visibleScheduleTasks>[0]>) =>
      visibleScheduleTasks({ ...baseInput, tasks: [shared, other], ...input }).map((item) => item.id)
    expect(ids({ preset: "my-items", currentUserAssigneeTerms: ["jane doe"] })).toEqual(["shared"])
    expect(ids({ preset: "my-items", currentUserAssigneeTerms: ["ann lee"] })).toEqual(["shared"])
    expect(ids({ filters: { ...EMPTY_FILTERS, assignedTo: "jane" } })).toEqual(["shared"])
    expect(ids({ filters: { ...EMPTY_FILTERS, assignedTo: "bo" } })).toEqual(["other"])
  })

  it("groups by phase, project and crew with unassigned last", () => {
    const tasks = [
      task({ id: "1", phase: "z", projectId: "p2", assignedTo: null }),
      task({ id: "2", phase: "a", projectId: "p1", assignedTo: "Beta" }),
      task({ id: "3", phase: "m", projectId: "p3", assignedTo: "Alpha" }),
    ]
    const ids = (groupMode: Parameters<typeof visibleScheduleTasks>[0]["groupMode"]) =>
      visibleScheduleTasks({
        ...baseInput,
        tasks,
        groupMode,
        scheduleProjects: [
          { id: "p1", name: "One", projectNumber: "O-2", department: "O", color: "" },
          { id: "p2", name: "Two", projectNumber: "O-1", department: "O", color: "" },
        ],
      }).map((item) => item.id)
    expect(ids("phase")).toEqual(["2", "3", "1"])
    expect(ids("project")).toEqual(["1", "2", "3"])
    expect(ids("crew")).toEqual(["3", "2", "1"])
  })

  it("exports CSV with escaping and a project column for several jobs", () => {
    const tasks = [task({ title: 'Say "hi", ok', assignedTo: "Bo", isMilestone: true })]
    expect(scheduleCsv(tasks, []).split("\n")).toEqual([
      "Title,Phase,Status,Start Date,End Date,Duration (days),% Complete,Assigned To,Critical Path,Milestone",
      '"Say ""hi"", ok",framing,PENDING,2026-11-02,2026-11-02,1,0,Bo,No,Yes',
    ])
    const projects = [
      { id: "p1", name: "One", projectNumber: null, department: "O" as const, color: "" },
      { id: "p2", name: "Two", projectNumber: "O-2", department: "O" as const, color: "" },
    ]
    expect(scheduleCsv(tasks, projects).split("\n")[1].startsWith("One,")).toBe(true)
  })

  it("parses imported CSV rows that have a title", () => {
    expect(
      parseScheduleCsv("Task,Start,Days,Phase,Owner\nDig,2026-11-02,x,site,Bo\n\n,2026-11-03,2,,\nPour,,3,,")
    ).toEqual([
      { title: "Dig", startDate: "2026-11-02", workdays: 1, phase: "site", assignedTo: "Bo", status: "PENDING", percentComplete: 0 },
      { title: "Pour", workdays: 3, status: "PENDING", percentComplete: 0 },
    ])
  })

  it("maps print items, toggles values and labels columns", () => {
    expect(schedulePrintItems([task({ id: "x", endDateCalculated: "2026-11-05" })])[0]).toMatchObject({
      id: "x",
      endDate: "2026-11-05",
    })
    expect(toggleListValue(["a"], "a")).toEqual([])
    expect(toggleListValue(["a"], "b")).toEqual(["a", "b"])
    expect(scheduleColumnLabel("endDateCalculated")).toBe("End date")
    expect(scheduleColumnLabel("assignedTo")).toBe("Responsible")
  })
})
