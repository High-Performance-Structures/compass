// @vitest-environment jsdom
import * as React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ColumnDef } from "@tanstack/react-table"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

import { ListSheetProvider } from "../list-sheets/list-sheet-provider"
import { RecordTable, useRecordTable } from "../record-table"
import { EMPTY_LIST_SHEET_PREFERENCES, type ListSheetPreferences } from "@/lib/domain/settings/list-sheet-rules"

type Todo = { readonly id: string; readonly title: string; readonly description: string; readonly author: string }
const items: readonly Todo[] = [
  { id: "1", title: "Order trusses", description: "Confirm the count", author: "Pat" },
  { id: "2", title: "Call the inspector", description: "Framing", author: "Sam" },
]
const columns: ColumnDef<Todo>[] = [
  { accessorKey: "title", header: "Name" },
  { id: "description", accessorFn: (item) => item.description, header: "Description" },
  { id: "author", accessorFn: (item) => item.author, header: "Author" },
  { id: "actions", header: "", cell: () => React.createElement("button", { type: "button" }, "Edit") },
]

function Sheet(): React.ReactElement {
  const table = useRecordTable({ data: items, columns, getRowId: (item) => item.id, resetKey: "all", sheetId: "todos.job" })
  return React.createElement(RecordTable<Todo>, { table, itemLabel: "to-dos", emptyMessage: "None." })
}

function headers(host: HTMLElement): readonly string[] {
  return Array.from(host.querySelectorAll("thead th")).map((cell) => cell.textContent?.trim() ?? "")
}

function byText(text: string): HTMLElement {
  const element = Array.from(document.body.querySelectorAll<HTMLElement>("button, label")).find((candidate) => candidate.textContent?.trim().startsWith(text))
  if (!element) throw new Error(`No control "${text}"`)
  return element
}

function checkboxFor(label: string): HTMLElement {
  const popover = document.body.querySelector("[data-slot='popover-content']")
  const forId = Array.from(popover?.querySelectorAll("label") ?? []).find((candidate) => candidate.textContent?.trim().startsWith(label))?.getAttribute("for")
  const box = forId ? document.getElementById(forId) : null
  if (!box) throw new Error(`No checkbox for "${label}"`)
  return box
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }))
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }))
  })
}

describe("the Columns button", () => {
  let root: Root
  let host: HTMLDivElement
  beforeEach(() => {
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true, configurable: true })
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    document.body.innerHTML = ""
  })

  it("hides a column for this person and Reset brings back the company default", async () => {
    const savePersonal = vi.fn().mockResolvedValue({ success: true, data: null })
    const preferences: ListSheetPreferences = { ...EMPTY_LIST_SHEET_PREFERENCES, canSavePersonal: true }
    await act(async () => root.render(React.createElement(ListSheetProvider, { preferences, savePersonal }, React.createElement(Sheet))))
    expect(headers(host)).toEqual(["Name", "Description", "Author", ""])

    await click(byText("Columns"))
    // The column that opens the record cannot be hidden.
    expect(checkboxFor("Name").hasAttribute("disabled")).toBe(true)
    await click(checkboxFor("Description"))
    expect(headers(host)).toEqual(["Name", "Author", ""])
    expect(savePersonal).toHaveBeenLastCalledWith({ sheetId: "todos.job", hiddenColumnIds: ["description"], shownColumnIds: [] })

    await click(byText("Reset to company default"))
    expect(headers(host)).toEqual(["Name", "Description", "Author", ""])
    expect(savePersonal).toHaveBeenLastCalledWith({ sheetId: "todos.job", hiddenColumnIds: [], shownColumnIds: [] })
  })

  it("follows the company layout's order and hidden columns", async () => {
    const preferences: ListSheetPreferences = {
      ...EMPTY_LIST_SHEET_PREFERENCES,
      company: {
        "todos.job": {
          columns: ["author", "title", "description", "status", "assignedTo", "dueDate", "priority"].map((id) => ({ id, visible: id !== "description" })),
          sort: null,
          startFilter: null,
        },
      },
    }
    await act(async () => root.render(React.createElement(ListSheetProvider, { preferences, savePersonal: vi.fn() }, React.createElement(Sheet))))
    expect(headers(host)).toEqual(["Author", "Name", ""])
  })
})
