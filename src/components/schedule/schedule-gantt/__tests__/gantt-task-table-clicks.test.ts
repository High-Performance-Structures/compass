// @vitest-environment jsdom
import * as React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ScheduleTaskData } from "@/lib/schedule/types"

vi.mock("@/components/projects/project-task-create-button", () => ({
  ProjectTaskCreateButton: () => null,
}))

import { GanttTaskTable } from "../gantt-task-table"

const task: ScheduleTaskData = {
  id: "t1",
  projectId: "p1",
  title: "Framing",
  startDate: "2026-11-02",
  workdays: 5,
  endDateCalculated: "2026-11-06",
  phase: "framing",
  displayColor: null,
  status: "PENDING",
  isCriticalPath: false,
  isMilestone: false,
  percentComplete: 0,
  assignedTo: null,
  sortOrder: 0,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
}

describe("GanttTaskTable clicks", () => {
  let root: Root
  let container: HTMLDivElement
  const focused: string[] = []
  const edited: string[] = []

  beforeEach(async () => {
    focused.length = 0
    edited.length = 0
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root.render(
        React.createElement(GanttTaskTable, {
          displayItems: [{ type: "task", task }],
          togglePhase: () => {},
          projectById: new Map(),
          multipleProjects: false,
          conflicts: new Map(),
          focusedTaskId: null,
          focusTaskOnTimeline: (next) => focused.push(next.id),
          phaseGrouping: false,
          groupByCrew: false,
          assigneeOptions: [],
          projectId: null,
          onEditTask: (next) => edited.push(next.id),
          onAddTask: () => {},
        })
      )
    })
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  const row = (): Element => {
    const element = container.querySelector('[data-schedule-task-id="t1"]')
    if (!element) throw new Error("row missing")
    return element
  }

  it("shows the item on a click and opens the editor on a double-click", async () => {
    await act(async () => {
      row().dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(focused).toEqual(["t1"])
    expect(edited).toEqual([])

    await act(async () => {
      row().dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))
    })
    expect(edited).toEqual(["t1"])
    expect(row().getAttribute("title")).toContain("double-click to edit")
  })

  it("does not open the editor twice from a double-click on the pencil", async () => {
    const pencil = container.querySelector('[aria-label="Edit Framing"]')
    if (!pencil) throw new Error("pencil missing")
    await act(async () => {
      pencil.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      pencil.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))
    })
    expect(edited).toEqual(["t1"])
    expect(focused).toEqual([])
  })
})
