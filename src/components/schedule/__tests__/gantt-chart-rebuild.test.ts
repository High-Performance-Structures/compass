// @vitest-environment jsdom
import * as React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { FrappeTask } from "@/lib/schedule/gantt-transform"

const constructed = vi.hoisted(() => ({ count: 0 }))

vi.mock("frappe-gantt", () => ({
  default: class {
    config = { column_width: 38, step: 1, unit: "day" }
    gantt_start = new Date("2026-10-01T00:00:00")
    constructor(element: HTMLElement, tasks: readonly { readonly id: string }[]) {
      constructed.count += 1
      const container = document.createElement("div")
      container.className = "gantt-container"
      for (const task of tasks) {
        const wrapper = document.createElement("div")
        wrapper.className = "bar-wrapper"
        wrapper.dataset.id = task.id
        container.appendChild(wrapper)
      }
      element.appendChild(container)
    }
    change_view_mode(): void {}
  },
}))
vi.mock("./../gantt.css", () => ({}))

import { GanttChart } from "../gantt-chart"

const tasks: FrappeTask[] = [
  { id: "a", name: "Framing", start: "2026-10-01", end: "2026-10-05", progress: 0, dependencies: "", custom_class: "", displayColor: null, isCriticalPath: false, isMilestone: false },
  { id: "b", name: "Roofing", start: "2026-10-06", end: "2026-10-09", progress: 0, dependencies: "", custom_class: "", displayColor: null, isCriticalPath: false, isMilestone: false },
]

describe("GanttChart rebuilds", () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    constructed.count = 0
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    vi.stubGlobal("CSS", { escape: (value: string) => value })
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  const renderChart = async (focusedTaskId: string | null): Promise<void> => {
    await act(async () => {
      root.render(React.createElement(GanttChart, { tasks, viewMode: "Day", focusedTaskId }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  it("highlights a newly focused item without rebuilding the chart", async () => {
    await renderChart(null)
    expect(constructed.count).toBe(1)

    await renderChart("a")
    await renderChart("b")
    await renderChart("b")
    expect(constructed.count).toBe(1)
    expect(container.querySelector('[data-id="b"]')?.classList.contains("schedule-focused")).toBe(true)
    expect(container.querySelector('[data-id="a"]')?.classList.contains("schedule-focused")).toBe(false)
  })

  it("reports bar clicks with the pointer type and double-clicks separately", async () => {
    const clicks: string[] = []
    const doubleClicks: string[] = []
    await act(async () => {
      root.render(
        React.createElement(GanttChart, {
          tasks,
          viewMode: "Day",
          onTaskClick: (task, pointerType) => clicks.push(`${task.id}:${pointerType}`),
          onTaskDoubleClick: (task) => doubleClicks.push(task.id),
        })
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    const bar = container.querySelector('[data-id="a"]')
    if (!bar) throw new Error("bar missing")
    await act(async () => {
      const press = new MouseEvent("pointerdown", { bubbles: true })
      Object.defineProperty(press, "pointerType", { value: "touch" })
      bar.dispatchEvent(press)
      bar.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      bar.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))
    })
    expect(clicks).toEqual(["a:touch"])
    expect(doubleClicks).toEqual(["a"])
  })
})
