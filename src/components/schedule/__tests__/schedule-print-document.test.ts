/** @vitest-environment jsdom */

import * as React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  printScheduleDocument,
  SchedulePrintDocument,
  type SchedulePrintItem,
} from "@/components/schedule/schedule-print-document"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock("@/lib/print/ios-print", () => ({
  requiresSynchronousPrint: () => false,
}))

vi.mock("@/lib/print/readiness", () => ({
  IOS_PRINT_STATE_TIMEOUT_MS: 120_000,
  PRINT_STATE_TIMEOUT_MS: 5_000,
  waitForPrintLayout: vi.fn(async () => undefined),
}))

function scheduleItems(count: number): readonly SchedulePrintItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `task-${index}`,
    projectId: "project-202",
    title: `Schedule item ${index + 1}`,
    startDate: "2026-08-21",
    endDate: "2026-08-22",
    workdays: 2,
    status: "PENDING",
    phase: "finish",
    displayColor: index % 2 === 0 ? "blue" : "green",
    assignedTo: "Trade partner",
    percentComplete: index,
    isMilestone: false,
  }))
}

describe("SchedulePrintDocument", () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    document.body.className = ""
    document.body.replaceChildren()
    vi.restoreAllMocks()
  })

  it("renders every accessible schedule row outside the scrolling workspace", async () => {
    await act(async () => {
      root.render(
        React.createElement(SchedulePrintDocument, {
          audienceLabel: "Client schedule",
          brand: null,
          items: scheduleItems(75),
          paletteScopeId: "project-202",
          projectName: "Bishop and Loeffler",
          projectNumber: "O-202-595",
        })
      )
    })

    const printRoot = document.querySelector(
      '[data-project-schedule-print-document="true"]'
    )
    expect(printRoot?.parentElement).toBe(document.body)
    expect(
      printRoot?.querySelectorAll(".schedule-print-table tbody tr")
    ).toHaveLength(75)
  })

  it("isolates the print document until the browser finishes printing", async () => {
    await act(async () => {
      root.render(
        React.createElement(SchedulePrintDocument, {
          audienceLabel: "Sub/vendor schedule",
          brand: null,
          items: scheduleItems(2),
          paletteScopeId: "project-202",
          projectName: "Bishop and Loeffler",
          projectNumber: "O-202-595",
        })
      )
    })
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => undefined)

    await printScheduleDocument()

    expect(document.body.classList.contains("schedule-printing")).toBe(true)
    expect(printSpy).toHaveBeenCalledOnce()

    window.dispatchEvent(new Event("afterprint"))
    expect(document.body.classList.contains("schedule-printing")).toBe(false)
  })
})
