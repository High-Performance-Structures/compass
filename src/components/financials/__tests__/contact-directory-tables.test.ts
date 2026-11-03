/** @vitest-environment jsdom */

import * as React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { VendorDirectoryPage } from "@/app/actions/contact-directory"
import type { VendorDirectoryRow } from "@/lib/domain/contacts/directory-page"
import type { RecordPageQuery } from "@/lib/record-page"

const mocks = vi.hoisted(() => ({ vendorPage: vi.fn(), customerPage: vi.fn() }))
vi.mock("@/app/actions/contact-directory", () => ({
  getVendorDirectoryPage: mocks.vendorPage,
  getCustomerDirectoryPage: mocks.customerPage,
}))
vi.mock("@/components/searchable-combobox", () => ({ SearchableCombobox: () => React.createElement("div") }))
vi.mock("@/components/developer-mode-provider", () => ({ useDeveloperMode: () => ({ developerModeEnabled: false }) }))

import { CustomersTable } from "@/components/financials/customers-table"
import { VendorsTable } from "@/components/financials/vendors-table"

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true })

function vendor(index: number): VendorDirectoryRow {
  return {
    id: `vendor-${index}`,
    name: `Vendor ${String(index).padStart(3, "0")}`,
    category: "Supplier",
    email: null,
    primaryEmail: null,
    phone: null,
    sourceSystem: "manual",
    syncStatus: "manual",
    peopleCount: 1,
    primaryPersonName: `Person ${index}`,
  }
}
const ALL = Array.from({ length: 120 }, (_, index) => vendor(index))

/** A stand-in for the server: filters by name, sorts by name, and pages. */
function serverPage(query: RecordPageQuery): VendorDirectoryPage {
  const matching = ALL.filter((row) => row.name.toLowerCase().includes(query.search.toLowerCase()))
  const sorted = query.sortDesc ? [...matching].reverse() : matching
  const start = query.pageIndex * query.pageSize
  return { rows: sorted.slice(start, start + query.pageSize), total: matching.length, tradeDocStatuses: null }
}

async function settle(ms = 0): Promise<void> {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
}

function typeInto(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

describe("server-paged vendor directory", () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.vendorPage.mockImplementation(async (query: RecordPageQuery) => ({ success: true, data: serverPage(query) }))
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    document.body.replaceChildren()
  })

  function render(props: Partial<React.ComponentProps<typeof VendorsTable>> = {}): Promise<void> {
    return act(async () => {
      root.render(React.createElement(VendorsTable, {
        categories: ["Supplier"],
        initialPage: serverPage({ search: "", sortId: null, sortDesc: false, pageIndex: 0, pageSize: 25 }),
        reloadToken: 0,
        ...props,
      }))
    })
  }

  it("shows the server's first page and total, then reads later pages one at a time", async () => {
    await render()
    expect(mocks.vendorPage).not.toHaveBeenCalled()
    expect(host.querySelectorAll("tbody tr")).toHaveLength(25)
    expect(host.textContent).toContain("120 vendors")
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Go to next page"]')?.click())
    await settle()
    expect(mocks.vendorPage).toHaveBeenLastCalledWith(expect.objectContaining({ pageIndex: 1, pageSize: 25, search: "" }), null)
    expect(host.textContent).toContain("Vendor 025")
    expect(host.textContent).not.toContain("Vendor 000")
  })

  it("searches on the server and goes back to page 1", async () => {
    await render()
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Go to next page"]')?.click())
    await settle()
    const search = host.querySelector<HTMLInputElement>('input[aria-label="Search vendors"]')
    expect(search).not.toBeNull()
    if (!search) return
    await act(async () => typeInto(search, "Vendor 11"))
    await settle(300)
    expect(mocks.vendorPage).toHaveBeenLastCalledWith(expect.objectContaining({ search: "Vendor 11", pageIndex: 0 }), null)
    expect(host.querySelectorAll("tbody tr")).toHaveLength(10)
    expect(host.textContent).toContain("10 vendors")
  })

  it("sorts on the server from the column header", async () => {
    await render()
    const nameHeader = Array.from(host.querySelectorAll<HTMLButtonElement>("thead button")).find((button) => button.textContent?.includes("Name"))
    await act(async () => nameHeader?.click())
    await settle()
    expect(mocks.vendorPage).toHaveBeenLastCalledWith(expect.objectContaining({ sortId: "name", sortDesc: false, pageIndex: 0 }), null)
    await act(async () => nameHeader?.click())
    await settle()
    expect(mocks.vendorPage).toHaveBeenLastCalledWith(expect.objectContaining({ sortId: "name", sortDesc: true }), null)
    expect(host.textContent).toContain("Vendor 119")
  })

  it("keeps selected vendors across pages so two duplicates on different pages can be merged", async () => {
    const onSelectionChange = vi.fn()
    await render({ onSelectionChange })
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Select Vendor 000"]')?.click())
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Go to next page"]')?.click())
    await settle()
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Select Vendor 030"]')?.click())
    const last: readonly VendorDirectoryRow[] = onSelectionChange.mock.lastCall?.[0] ?? []
    expect(last.map((row) => row.id).sort()).toEqual(["vendor-0", "vendor-30"])
    expect(host.textContent).toContain("2 of 120 vendors selected")
  })

  it("re-reads the current page when the reload token changes", async () => {
    await render()
    await render({ reloadToken: 1 })
    await settle()
    expect(mocks.vendorPage).toHaveBeenCalledTimes(1)
    expect(mocks.vendorPage).toHaveBeenLastCalledWith(expect.objectContaining({ pageIndex: 0 }), null)
  })

  it("offers Merge with… in the row menu and hands over that row", async () => {
    const onMergeWith = vi.fn()
    await render({ onMergeWith })
    const trigger = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Actions for Vendor 003")
    expect(trigger).toBeDefined()
    await act(async () => {
      trigger?.focus()
      trigger?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    })
    const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((element) => element.textContent === "Merge with…")
    expect(item).toBeDefined()
    await act(async () => item?.click())
    expect(onMergeWith).toHaveBeenCalledWith(expect.objectContaining({ id: "vendor-3", name: "Vendor 003" }))
  })
})

describe("server-paged client and lead directory", () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.customerPage.mockResolvedValue({ success: true, data: { rows: [], total: 0 } })
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    document.body.replaceChildren()
  })

  it("reads its first page from the server when none was preloaded, and searches people too", async () => {
    await act(async () => {
      root.render(React.createElement(CustomersTable, { initialPage: null, reloadToken: 0 }))
    })
    await settle()
    expect(mocks.customerPage).toHaveBeenCalledTimes(1)
    expect(host.textContent).toContain("No client or lead contacts yet.")
    const search = host.querySelector<HTMLInputElement>('input[aria-label="Search clients and leads"]')
    expect(search?.placeholder).toContain("person")
    if (!search) return
    await act(async () => typeInto(search, "spouse@home"))
    await settle(300)
    expect(mocks.customerPage).toHaveBeenLastCalledWith(expect.objectContaining({ search: "spouse@home", pageIndex: 0 }))
    expect(host.textContent).toContain("No clients or leads match this search.")
  })
})
