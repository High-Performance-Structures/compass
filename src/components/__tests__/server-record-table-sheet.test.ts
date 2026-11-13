// @vitest-environment jsdom
import * as React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ColumnDef } from "@tanstack/react-table"

import { ListSheetProvider } from "../list-sheets/list-sheet-provider"
import { useServerRecordTable } from "../use-server-record-table"
import { EMPTY_LIST_SHEET_PREFERENCES, type ListSheetPreferences } from "@/lib/domain/settings/list-sheet-rules"
import { DEFAULT_RECORD_PAGE_QUERY, type RecordPage, type RecordPageQuery } from "@/lib/record-page"

type Customer = { readonly id: string; readonly name: string }
const columns: ColumnDef<Customer>[] = [
  { id: "name", accessorFn: (row) => row.name, header: "Name" },
  { id: "createdAt", accessorFn: (row) => row.id, header: "Added" },
]
const page: RecordPage<Customer> = { rows: [{ id: "c1", name: "Client" }], total: 1 }

const preferences: ListSheetPreferences = {
  ...EMPTY_LIST_SHEET_PREFERENCES,
  company: {
    customers: {
      columns: ["name", "email", "phone", "people", "relationshipType", "createdAt"].map((id) => ({ id, visible: true })),
      sort: { kind: "column", columnId: "createdAt", desc: true },
      startFilter: null,
    },
  },
}

describe("a server-paged sheet with a company sort", () => {
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
  })

  async function renderWith(initialQuery: RecordPageQuery): Promise<ReturnType<typeof vi.fn>> {
    const load = vi.fn().mockResolvedValue({ success: true, data: page })
    function Sheet(): React.ReactElement {
      useServerRecordTable({ columns, getRowId: (row) => row.id, load, initialPage: page, initialQuery, sheetId: "customers" })
      return React.createElement("div")
    }
    await act(async () => root.render(React.createElement(ListSheetProvider, { preferences, savePersonal: vi.fn(), children: React.createElement(Sheet) })))
    return load
  }

  it("uses the server's first page when it was read in the sheet's sort", async () => {
    const load = await renderWith({ ...DEFAULT_RECORD_PAGE_QUERY, sortId: "createdAt", sortDesc: true })
    expect(load).not.toHaveBeenCalled()
  })

  it("reads the first page again in the sheet's sort when the server used another", async () => {
    const load = await renderWith(DEFAULT_RECORD_PAGE_QUERY)
    expect(load).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ sortId: "createdAt", sortDesc: true, pageIndex: 0 }))
  })
})
