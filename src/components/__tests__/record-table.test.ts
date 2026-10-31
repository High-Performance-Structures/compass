// @vitest-environment jsdom
import * as React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { ColumnDef, Table } from "@tanstack/react-table"
import { RecordTable, recordSelectionColumn, useRecordTable } from "../record-table"

type Item = {
  readonly id: string
  readonly name: string
  readonly date: string | undefined
  readonly amount: number
}
const items: readonly Item[] = Array.from({ length: 56 }, (_, i) => ({
  id: `id-${i}`,
  name: `Record ${i}`,
  date: i === 0 ? undefined : `2026-11-${String((i % 28) + 1).padStart(2, "0")}`,
  amount: 100 - i,
}))
const columns: ColumnDef<Item>[] = [
  recordSelectionColumn((item: Item) => item.name),
  { accessorKey: "name", header: "Name" },
  { accessorKey: "date", header: "Date" },
  { accessorKey: "amount", header: "Amount" },
]
let current: Table<Item>
function Harness({
  data = items,
  resetKey = "all",
  initialItemId = null,
  revealReady = true,
}: {
  readonly data?: readonly Item[]
  readonly resetKey?: string
  readonly initialItemId?: string | null
  readonly revealReady?: boolean
}): React.ReactElement {
  const table = useRecordTable({
    data,
    columns,
    getRowId: (row) => row.id,
    resetKey,
    enableSelection: true,
    initialItemId,
    revealReady,
  })
  React.useEffect(() => { current = table }, [table])
  return React.createElement(RecordTable<Item>, {
    table,
    itemLabel: "records",
    emptyMessage: "No matching records.",
  })
}

describe("shared growing record table behavior", () => {
  let root: Root
  let host: HTMLDivElement
  beforeEach(() => {
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
      value: true,
      configurable: true,
    })
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })
  async function render(props: React.ComponentProps<typeof Harness> = {}): Promise<void> {
    await act(async () => root.render(React.createElement(Harness, props)))
  }

  it("preserves the current page after a record edit and clamps it after deletion", async () => {
    await render()
    await act(async () => current.setPageIndex(2))
    await render({
      data: items.map((item) => (item.id === "id-52" ? { ...item, name: "Edited" } : item)),
    })
    expect(current.getState().pagination.pageIndex).toBe(2)
    expect(host.textContent).toContain("Edited")
    await render({ data: items.slice(0, 26) })
    expect(current.getState().pagination.pageIndex).toBe(1)
    expect(host.textContent).toContain("Page 2 of 2")
  })

  it("reveals a deep-linked item beyond the first page", async () => {
    await render({ initialItemId: "id-52" })
    expect(current.getState().pagination.pageIndex).toBe(2)
    expect(host.textContent).toContain("Record 52")
  })

  it("waits for the destination filter before consuming a new deep link", async () => {
    await render({ resetKey: "all" })
    await render({ resetKey: "all", initialItemId: "id-52", revealReady: false })
    await render({ data: items.slice(10), resetKey: "active", initialItemId: "id-52", revealReady: true })
    expect(current.getState().pagination.pageIndex).toBe(1)
    expect(host.textContent).toContain("Record 52")
  })

  it("clears hidden selections and resets the page when the view changes", async () => {
    await render()
    await act(async () => {
      current.setPageIndex(1)
      current.getRow("id-30").toggleSelected(true)
    })
    await render({ data: items.slice(0, 4), resetKey: "search:changed" })
    expect(current.getState().pagination.pageIndex).toBe(0)
    expect(current.getSelectedRowModel().rows).toHaveLength(0)
  })

  it("selects only the visible page", async () => {
    await render()
    await act(async () => current.toggleAllPageRowsSelected(true))
    expect(current.getSelectedRowModel().rows).toHaveLength(25)
    expect(current.getRow("id-30").getIsSelected()).toBe(false)
  })

  it("sorts natural names, numeric amounts and date blanks correctly in both directions", async () => {
    await render()
    await act(async () => current.getColumn("name")?.toggleSorting())
    expect(
      current
        .getSortedRowModel()
        .rows.slice(0, 3)
        .map((r) => r.original.name),
    ).toEqual(["Record 0", "Record 1", "Record 2"])
    await act(async () => current.getColumn("amount")?.toggleSorting())
    expect(current.getSortedRowModel().rows[0]?.original.amount).toBe(45)
    await act(async () => current.getColumn("date")?.toggleSorting())
    expect(current.getSortedRowModel().rows.at(-1)?.id).toBe("id-0")
    await act(async () => current.getColumn("date")?.toggleSorting())
    expect(current.getSortedRowModel().rows.at(-1)?.id).toBe("id-0")
    await act(async () => current.getColumn("date")?.toggleSorting())
    expect(current.getState().sorting).toHaveLength(0)
  })
})
