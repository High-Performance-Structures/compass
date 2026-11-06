// @vitest-environment jsdom
import * as React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ColumnDef } from "@tanstack/react-table"

const push = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }))

import { RecordTable, recordSelectionColumn, useRecordTable } from "../record-table"
import { StatusFilterBar } from "../status-filter-bar"

type Item = { readonly id: string; readonly name: string; readonly amount: number }
const items: readonly Item[] = Array.from({ length: 3 }, (_, i) => ({ id: `id-${i}`, name: `Record ${i}`, amount: i }))
const columns: ColumnDef<Item>[] = [
  { accessorKey: "name", header: "Name" },
  { accessorKey: "amount", header: "Amount" },
]

function HrefHarness(): React.ReactElement {
  const table = useRecordTable({
    data: items,
    columns,
    getRowId: (row) => row.id,
    resetKey: "all",
    initialSorting: [{ id: "amount", desc: true }],
  })
  return React.createElement(RecordTable<Item>, {
    table,
    itemLabel: "records",
    emptyMessage: "None.",
    getRowHref: (row: Item) => `/records/${row.id}`,
  })
}

const onRowOpen = vi.fn()
function ClickHarness(): React.ReactElement {
  const table = useRecordTable({
    data: items,
    columns: [
      recordSelectionColumn<Item>((row) => row.name),
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) =>
          React.createElement("a", { href: `#${row.original.id}`, onClick: (e: React.MouseEvent) => e.preventDefault() }, row.original.name),
      },
      { accessorKey: "amount", header: "Amount" },
      { id: "actions", header: "", cell: () => React.createElement("button", { type: "button" }, "Edit") },
    ],
    getRowId: (row) => row.id,
    resetKey: "all",
    enableSelection: true,
  })
  return React.createElement(RecordTable<Item>, { table, itemLabel: "records", emptyMessage: "None.", onRowOpen })
}

describe("record table rows and status filters", () => {
  let root: Root
  let host: HTMLDivElement
  beforeEach(() => {
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true, configurable: true })
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    onRowOpen.mockClear()
    push.mockClear()
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  it("opens the record from a plain cell but not from its controls or a text selection", async () => {
    await act(async () => root.render(React.createElement(ClickHarness)))
    const row = host.querySelectorAll("tbody tr")[1]
    const amountCell = row?.querySelectorAll("td")[2]
    await act(async () => amountCell?.dispatchEvent(new MouseEvent("click", { bubbles: true })))
    expect(onRowOpen).toHaveBeenCalledTimes(1)
    expect(onRowOpen.mock.calls[0]?.[0]).toMatchObject({ id: "id-1" })

    for (const control of [row?.querySelector("a"), row?.querySelector("button"), row?.querySelector('[role="checkbox"]')]) {
      expect(control).toBeTruthy()
      await act(async () => control?.dispatchEvent(new MouseEvent("click", { bubbles: true })))
    }
    expect(onRowOpen).toHaveBeenCalledTimes(1)

    // Selecting text in the row to copy it does not open the record.
    const text = amountCell?.firstChild
    if (text) {
      const range = document.createRange()
      range.selectNodeContents(text)
      window.getSelection()?.removeAllRanges()
      window.getSelection()?.addRange(range)
    }
    await act(async () => amountCell?.dispatchEvent(new MouseEvent("click", { bubbles: true })))
    expect(onRowOpen).toHaveBeenCalledTimes(1)
    window.getSelection()?.removeAllRanges()
  })

  it("opens with its initial sort and navigates to the row's link", async () => {
    await act(async () => root.render(React.createElement(HrefHarness)))
    const firstRow = host.querySelector("tbody tr")
    expect(firstRow?.textContent).toContain("Record 2")
    await act(async () => firstRow?.querySelector("td")?.dispatchEvent(new MouseEvent("click", { bubbles: true })))
    expect(push).toHaveBeenCalledWith("/records/id-2")
  })

  it("shows status filter buttons with counts, hiding empty unpinned statuses", async () => {
    const onSelect = vi.fn()
    await act(async () =>
      root.render(
        React.createElement(StatusFilterBar<"open" | "draft" | "void" | "all">, {
          kind: "button",
          label: "Filter records by status",
          selected: "open",
          onSelect,
          options: [
            { value: "open", label: "Open", count: 0, pinned: true },
            { value: "draft", label: "Draft", count: 2 },
            { value: "void", label: "Void", count: 0 },
            { value: "all", label: "All", count: 2, pinned: true },
          ],
        }),
      ),
    )
    const buttons = [...host.querySelectorAll("button")]
    expect(buttons.map((button) => button.textContent)).toEqual(["Open0", "Draft2", "All2"])
    expect(buttons[0]?.getAttribute("aria-pressed")).toBe("true")
    await act(async () => buttons[1]?.click())
    expect(onSelect).toHaveBeenCalledWith("draft")
  })
})
