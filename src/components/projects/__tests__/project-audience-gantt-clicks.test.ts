// @vitest-environment jsdom
import * as React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { AudienceScheduleItem } from "@/lib/project-audience-preview-types"
import type { FrappeTask } from "@/lib/schedule/gantt-transform"

type ChartProps = {
  readonly focusedTaskId?: string | null
  readonly onTaskClick?: (task: FrappeTask, pointerType: string) => void
  readonly onTaskDoubleClick?: (task: FrappeTask) => void
  readonly onTaskVisibilityReady?: (
    handler: ((taskId: string) => void) | null
  ) => void
}
const chart = vi.hoisted(() => {
  const state: { props: ChartProps | null; revealed: string[] } = {
    props: null,
    revealed: [],
  }
  return state
})

vi.mock("@/components/schedule/gantt-chart", () => ({
  GanttChart: (props: ChartProps) => {
    chart.props = props
    React.useEffect(() => {
      props.onTaskVisibilityReady?.((taskId) => chart.revealed.push(taskId))
    }, [props])
    return React.createElement("div", { "data-testid": "chart" })
  },
}))
vi.mock("@/components/record-drawer", () => ({
  RecordDrawer: ({
    open,
    title,
  }: {
    readonly open: boolean
    readonly title: React.ReactNode
  }) => (open ? React.createElement("div", { "data-drawer": "open" }, title) : null),
}))
vi.mock("@/components/ui/resizable", () => {
  const Pass = ({ children }: { readonly children?: React.ReactNode }) =>
    React.createElement("div", null, children)
  return {
    ResizablePanelGroup: Pass,
    ResizablePanel: Pass,
    ResizableHandle: () => null,
  }
})
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }))
vi.mock("@/hooks/use-schedule-display-palette", () => ({
  useScheduleDisplayPalette: () => undefined,
}))
vi.mock("../schedule-item-responses", () => ({
  ScheduleItemResponses: () => null,
}))

import { ProjectAudienceGantt } from "../project-audience-gantt"

const item = (id: string, title: string): AudienceScheduleItem => ({
  id,
  title,
  startDate: "2026-11-02",
  endDate: "2026-11-06",
  workdays: 5,
  status: "PENDING",
  phase: "framing",
  displayColor: null,
  assignedTo: null,
  percentComplete: 0,
  isMilestone: false,
  confirmationRequired: false,
  confirmationStatus: "none",
  viewerCanConfirm: false,
  proposedStartDate: null,
  proposedWorkdays: null,
  proposalNote: null,
  proposalSubmittedAt: null,
  assignees: [],
})
const items = [item("a", "Framing"), item("b", "Roofing")]

function pointer(target: Element, type: string, pointerType: string): void {
  const event = new MouseEvent(type, { bubbles: true })
  Object.defineProperty(event, "pointerType", { value: pointerType })
  target.dispatchEvent(event)
}

/** A real pointer click has detail >= 1; screen readers send detail 0. */
function click(target: Element, detail = 1): void {
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, detail }))
}

const bar = (id: string, name: string): FrappeTask => ({
  id,
  name,
  start: "2026-11-02",
  end: "2026-11-06",
  progress: 0,
  dependencies: "",
  custom_class: "",
  displayColor: null,
  isCriticalPath: false,
  isMilestone: false,
})

describe("ProjectAudienceGantt clicks", () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(async () => {
    chart.props = null
    chart.revealed = []
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root.render(
        React.createElement(ProjectAudienceGantt, { items, projectId: "p1" })
      )
    })
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  const rowButton = (id: string): HTMLButtonElement => {
    const button = container.querySelector(
      `tr[data-schedule-task-id="${id}"] button`
    )
    if (!(button instanceof HTMLButtonElement)) throw new Error("row missing")
    return button
  }
  const drawerOpen = (): boolean =>
    container.querySelector('[data-drawer="open"]') !== null

  it("highlights and reveals on a single click without opening details", async () => {
    await act(async () => {
      pointer(rowButton("b"), "pointerdown", "mouse")
      click(rowButton("b"))
    })
    expect(drawerOpen()).toBe(false)
    expect(chart.props?.focusedTaskId).toBe("b")
    expect(chart.revealed).toEqual(["b"])
    expect(
      container.querySelector('tr[data-schedule-task-id="b"]')?.className
    ).toContain("bg-accent")
    expect(rowButton("b").getAttribute("aria-current")).toBe("true")
    expect(rowButton("a").hasAttribute("aria-current")).toBe(false)
    expect(rowButton("b").hasAttribute("aria-pressed")).toBe(false)

    // A second mouse click still only highlights; mouse users double-click.
    await act(async () => {
      pointer(rowButton("b"), "pointerdown", "mouse")
      click(rowButton("b"))
    })
    expect(drawerOpen()).toBe(false)
  })

  it("opens details on a screen-reader click (detail 0)", async () => {
    await act(async () => click(rowButton("a"), 0))
    expect(container.querySelector('[data-drawer="open"]')?.textContent).toBe(
      "Framing"
    )
    expect(chart.revealed).toEqual(["a"])
  })

  it("opens details on a row double-click", async () => {
    await act(async () => {
      rowButton("a").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))
    })
    expect(container.querySelector('[data-drawer="open"]')?.textContent).toBe(
      "Framing"
    )
  })

  it("opens details with Enter on a focused row", async () => {
    await act(async () => {
      rowButton("b").dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
      )
    })
    expect(container.querySelector('[data-drawer="open"]')?.textContent).toBe(
      "Roofing"
    )
    // Keyboard users still get the bar brought into view.
    expect(chart.revealed).toEqual(["b"])
  })

  it("opens details on a second tap of the highlighted row", async () => {
    await act(async () => {
      pointer(rowButton("a"), "pointerdown", "touch")
      click(rowButton("a"))
    })
    expect(drawerOpen()).toBe(false)
    await act(async () => {
      pointer(rowButton("a"), "pointerdown", "touch")
      click(rowButton("a"))
    })
    expect(drawerOpen()).toBe(true)
  })

  it("highlights on a bar click without scrolling the chart", async () => {
    await act(async () => chart.props?.onTaskClick?.(bar("b", "Roofing"), "mouse"))
    expect(chart.props?.focusedTaskId).toBe("b")
    expect(drawerOpen()).toBe(false)
    expect(chart.revealed).toEqual([])
    await act(async () => chart.props?.onTaskClick?.(bar("b", "Roofing"), "pen"))
    expect(drawerOpen()).toBe(true)
    expect(chart.revealed).toEqual([])
  })

  it("opens details on a bar double-click", async () => {
    await act(async () => chart.props?.onTaskDoubleClick?.(bar("a", "Framing")))
    expect(drawerOpen()).toBe(true)
    expect(chart.revealed).toEqual([])
  })
})
