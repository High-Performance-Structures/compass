// @vitest-environment jsdom
import * as React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ColumnDef } from "@tanstack/react-table"

const push = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }))
const toastError = vi.fn()
vi.mock("sonner", () => ({ toast: { error: (message: string) => toastError(message), success: vi.fn() } }))

import { RecordTable, recordSelectionColumn, useRecordTable } from "../record-table"
import { usePriorityRecordTable } from "../record-table-priority"
import type { RecordPriorityController } from "../record-table-sortable"
import type { ActionDone } from "@/lib/action-result"

type Item = { readonly id: string; readonly name: string; readonly amount: number }
const items: readonly Item[] = Array.from({ length: 30 }, (_, i) => ({ id: `id-${i}`, name: `Record ${i}`, amount: i }))
const columns: ColumnDef<Item>[] = [
  { accessorKey: "name", header: "Name" },
  { accessorKey: "amount", header: "Amount" },
]

let priority: RecordPriorityController<Item>
let resolveSave: ((result: ActionDone) => void) | null = null
const onReorder = vi.fn(
  (previousIds: readonly string[], orderedIds: readonly string[]) =>
    new Promise<ActionDone>((resolve) => {
      void previousIds
      void orderedIds
      resolveSave = resolve
    }),
)

function PriorityHarness({
  canReorder = true,
  searching = false,
}: {
  readonly canReorder?: boolean
  readonly searching?: boolean
}): React.ReactElement {
  const result = usePriorityRecordTable({
    data: items,
    columns,
    getRowId: (row) => row.id,
    resetKey: "all",
    priorityOrder: { label: "Ordering priority", canReorder, searching, getLabel: (row) => row.name, onReorder },
  })
  React.useEffect(() => {
    priority = result.priority
  })
  return React.createElement(RecordTable<Item>, {
    table: result.table,
    priority: result.priority,
    itemLabel: "records",
    emptyMessage: "None.",
  })
}

function HrefHarness(): React.ReactElement {
  const table = useRecordTable({ data: items.slice(0, 2), columns, getRowId: (row) => row.id, resetKey: "all" })
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
    data: items.slice(0, 3),
    columns: [
      recordSelectionColumn<Item>((row) => row.name),
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => React.createElement("a", { href: `#${row.original.id}`, onClick: (e: React.MouseEvent) => e.preventDefault() }, row.original.name),
      },
      { accessorKey: "amount", header: "Amount" },
      {
        id: "actions",
        header: "",
        cell: () => React.createElement("button", { type: "button" }, "Edit"),
      },
    ],
    getRowId: (row) => row.id,
    resetKey: "all",
    enableSelection: true,
  })
  return React.createElement(RecordTable<Item>, { table, itemLabel: "records", emptyMessage: "None.", onRowOpen })
}

describe("record table priority order mode", () => {
  let root: Root
  let host: HTMLDivElement
  beforeEach(() => {
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true, configurable: true })
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    onReorder.mockClear()
    toastError.mockClear()
    onRowOpen.mockClear()
    push.mockClear()
    resolveSave = null
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  function button(label: string): HTMLButtonElement {
    const found = host.querySelector(`button[aria-label="${label}"]`)
    if (!(found instanceof HTMLButtonElement)) throw new Error(`No button ${label}`)
    return found
  }
  function buttonByText(text: string): HTMLButtonElement | undefined {
    return [...host.querySelectorAll("button")].find((element) => element.textContent?.trim() === text)
  }
  function names(): string[] {
    return [...host.querySelectorAll("tbody tr")].map((row) => row.querySelectorAll("td")[1]?.textContent ?? "")
  }

  it("shows the priority order with a rank and enabled drag controls", async () => {
    await act(async () => root.render(React.createElement(PriorityHarness)))
    expect(host.querySelector("tbody tr td")?.textContent).toContain("1")
    expect(button("Drag to reorder Record 0").disabled).toBe(false)
    expect(button("Move Record 0 up").disabled).toBe(true)
    expect(button("Move Record 0 down").disabled).toBe(false)
    expect(host.textContent).toContain("Shown in ordering priority")
  })

  it("sorting by a column pauses dragging until Back to priority order", async () => {
    await act(async () => root.render(React.createElement(PriorityHarness)))
    const amountHeader = buttonByText("Amount")
    await act(async () => amountHeader?.click())
    await act(async () => amountHeader?.click())
    expect(names()[0]).toBe("Record 29")
    expect(priority.dragEnabled).toBe(false)
    expect(button("Drag to reorder Record 29").disabled).toBe(true)
    expect(host.textContent).toContain("Sorted by Amount")
    // Ranks still show the priority place, not the sorted place.
    expect(host.querySelector("tbody tr td")?.textContent).toContain("30")

    const back = buttonByText("Back to priority order")
    expect(back).toBeDefined()
    await act(async () => back?.click())
    expect(names()[0]).toBe("Record 0")
    expect(priority.dragEnabled).toBe(true)
    expect(buttonByText("Back to priority order")).toBeUndefined()
  })

  it("pauses dragging while searching", async () => {
    await act(async () => root.render(React.createElement(PriorityHarness, { searching: true })))
    expect(priority.dragEnabled).toBe(false)
    expect(button("Move Record 0 down").disabled).toBe(true)
    expect(host.textContent).toContain("Clear the search to change the order")
  })

  it("shows the order read-only without the permission", async () => {
    await act(async () => root.render(React.createElement(PriorityHarness, { canReorder: false })))
    expect(host.querySelector('button[aria-label^="Drag to reorder"]')).toBeNull()
    expect(host.querySelector("tbody tr td")?.textContent).toBe("1")
  })

  it("moves at once, saves the whole order, and rolls back with a toast when the save fails", async () => {
    await act(async () => root.render(React.createElement(PriorityHarness)))
    await act(async () => button("Move Record 0 down").click())
    expect(names().slice(0, 2)).toEqual(["Record 1", "Record 0"])
    expect(onReorder).toHaveBeenCalledTimes(1)
    const [previousIds, orderedIds] = onReorder.mock.calls[0] ?? [[], []]
    expect(previousIds.slice(0, 2)).toEqual(["id-0", "id-1"])
    expect(orderedIds.slice(0, 2)).toEqual(["id-1", "id-0"])
    expect(orderedIds).toHaveLength(30)
    // Further moves wait for the save.
    expect(priority.dragEnabled).toBe(false)

    await act(async () => resolveSave?.({ success: false, error: "The order changed." }))
    expect(names().slice(0, 2)).toEqual(["Record 0", "Record 1"])
    expect(toastError).toHaveBeenCalledWith("The order changed.")
    expect(priority.dragEnabled).toBe(true)
  })

  it("moves a record to the bottom across pages", async () => {
    await act(async () => root.render(React.createElement(PriorityHarness)))
    await act(async () => priority.move("id-0", priority.count - 1))
    const [, orderedIds] = onReorder.mock.calls[0] ?? [[], []]
    expect(orderedIds.at(-1)).toBe("id-0")
    expect(names()[0]).toBe("Record 1")
    await act(async () => resolveSave?.({ success: true }))
    expect(toastError).not.toHaveBeenCalled()
    expect(priority.positionOf("id-0")).toBe(29)
  })
})

describe("whole-row click", () => {
  let root: Root
  let host: HTMLDivElement
  beforeEach(() => {
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true, configurable: true })
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    onRowOpen.mockClear()
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

  it("navigates to the row's link", async () => {
    push.mockClear()
    await act(async () => root.render(React.createElement(HrefHarness)))
    const cell = host.querySelectorAll("tbody tr")[1]?.querySelector("td")
    await act(async () => cell?.dispatchEvent(new MouseEvent("click", { bubbles: true })))
    expect(push).toHaveBeenCalledWith("/records/id-1")
  })
})
