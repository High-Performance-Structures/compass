// @vitest-environment jsdom
import * as React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const push = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }))
vi.mock("next/link", () => ({ default: (props: React.ComponentProps<"a">) => React.createElement("a", props) }))

import { ProjectRfiRecordTable } from "@/components/projects/project-rfi-record-table"
import { defaultRecordStatusList } from "@/lib/domain/record-statuses/rules"
import type { RfiListRow } from "@/lib/rfis/record-list"

function rfi(index: number, overrides: Partial<RfiListRow> = {}): RfiListRow {
  return {
    id: `rfi-${index}`,
    rfiNumber: `RFI-${String(index).padStart(3, "0")}`,
    subject: `Question ${index}`,
    question: `Details ${index}`,
    status: "new",
    priority: "normal",
    assignedToName: `Person ${index}`,
    companyName: null,
    requesterName: "Sam Super",
    submittedAt: "2026-11-01T12:00:00.000Z",
    dueDate: null,
    answeredAt: null,
    ...overrides,
  }
}

function bodyRows(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll("tbody tr")).map(
    (row) => row.querySelector("td")?.textContent ?? "",
  )
}

function header(host: HTMLElement, name: string): HTMLButtonElement {
  const button = Array.from(host.querySelectorAll("thead button")).find((item) => item.textContent?.includes(name))
  if (!(button instanceof HTMLButtonElement)) throw new Error(`No ${name} header`)
  return button
}

describe("RFI record table", () => {
  let root: Root
  let host: HTMLDivElement
  beforeEach(() => {
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true, configurable: true })
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    push.mockReset()
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  async function renderStaff(rows: readonly RfiListRow[], selectedId: string | null = null): Promise<void> {
    await act(async () =>
      root.render(
        React.createElement(ProjectRfiRecordTable, {
          rows,
          statuses: defaultRecordStatusList("rfi"),
          audience: "staff",
          projectId: "project-a",
          statusFilter: "open",
          selectedId,
          emptyMessage: "No RFIs yet.",
        }),
      ),
    )
  }

  it("sorts the Needed by column by date value with blanks last", async () => {
    await renderStaff([
      rfi(1, { dueDate: "2026-12-01" }),
      rfi(2, { dueDate: null }),
      rfi(3, { dueDate: "2026-11-30" }),
    ])
    await act(async () => header(host, "Needed by").click())
    expect(bodyRows(host)).toEqual(["RFI-003", "RFI-001", "RFI-002"])
    await act(async () => header(host, "Needed by").click())
    expect(bodyRows(host)).toEqual(["RFI-001", "RFI-003", "RFI-002"])
  })

  it("sorts status in workflow order", async () => {
    await renderStaff([
      rfi(1, { status: "complete" }),
      rfi(2, { status: "info_needed" }),
      rfi(3, { status: "open" }),
    ])
    await act(async () => header(host, "Status").click())
    expect(bodyRows(host)).toEqual(["RFI-003", "RFI-002", "RFI-001"])
  })

  it("opens the page holding a deep-linked RFI", async () => {
    const rows = Array.from({ length: 30 }, (_, index) => rfi(index + 1))
    await renderStaff(rows, "rfi-28")
    expect(host.textContent).toContain("RFI-028")
    expect(host.textContent).not.toContain("RFI-001")
    // The selected RFI's row is marked without scrolling to it.
    expect(host.querySelector("#rfi-row-rfi-28")?.getAttribute("data-focused")).toBe("true")
    expect(host.querySelectorAll("tbody tr[data-focused]")).toHaveLength(1)
  })

  it("opens the RFI record from anywhere on the row, keeping the filter", async () => {
    await renderStaff([rfi(7)])
    const cell = host.querySelectorAll("tbody td")[2]
    await act(async () => cell?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 })))
    expect(push).toHaveBeenCalledWith("/dashboard/projects/project-a/rfis?status=open&item=rfi-7#rfi-rfi-7")
    const link = host.querySelector("tbody a")
    expect(link?.getAttribute("href")).toBe("/dashboard/projects/project-a/rfis?status=open&item=rfi-7#rfi-rfi-7")
  })

  it("shows vendors only the columns they saw before, and opens the RFI in place", async () => {
    const onSelect = vi.fn()
    await act(async () =>
      root.render(
        React.createElement(ProjectRfiRecordTable, {
          rows: [rfi(4)],
          statuses: defaultRecordStatusList("rfi"),
          audience: "vendor",
          onSelect,
          emptyMessage: "No RFIs are currently visible for this project.",
        }),
      ),
    )
    const headers = Array.from(host.querySelectorAll("thead th")).map((cell) => cell.textContent)
    expect(headers).toEqual(["RFI", "Subject", "Status", "Assigned to", "Needed by"])
    expect(host.textContent).not.toContain("Sam Super")
    const cell = host.querySelectorAll("tbody td")[1]
    await act(async () => cell?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 })))
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "rfi-4" }))
    expect(push).not.toHaveBeenCalled()
  })
})
