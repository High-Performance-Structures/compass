/** @vitest-environment jsdom */

import * as React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { VendorDirectoryCompany } from "@/app/actions/vendors"
import { VendorsTable } from "@/components/financials/vendors-table"

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
})

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }))
vi.mock("@/components/searchable-combobox", () => ({
  SearchableCombobox: () => React.createElement("div"),
}))

function vendor(index: number): VendorDirectoryCompany {
  return {
    id: `vendor-${index}`,
    name: `Vendor ${String(index).padStart(3, "0")}`,
    category: "Supplier",
    email: null,
    phone: null,
    address: null,
    ownerName: null,
    addressLine1: null,
    addressLine2: null,
    city: null,
    state: null,
    postalCode: null,
    primaryEmail: null,
    sageVendorId: null,
    sageVendorNumber: null,
    netsuiteId: null,
    sourceSystem: "manual",
    sourceRecordId: null,
    sourceRecordNumber: null,
    sourceMetadata: null,
    directoryStatus: "active",
    syncStatus: "manual",
    lastSyncedAt: null,
    organizationId: "org-1",
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: null,
    contacts: [],
  }
}

describe("VendorsTable", () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    document.body.replaceChildren()
  })

  it("renders a paginated directory without a selection control that has no action", async () => {
    const vendors = Array.from({ length: 576 }, (_, index) => vendor(index))

    await act(async () => {
      root.render(React.createElement(VendorsTable, { vendors, categories: ["Supplier"] }))
    })

    expect(host.querySelectorAll("tbody tr")).toHaveLength(25)
    expect(host.querySelector('button[aria-label="select all"]')).toBeNull()
    expect(host.textContent).toContain("Vendor 000")
    expect(host.textContent).toContain("576 vendors")

    const next = host.querySelector<HTMLButtonElement>('button[aria-label="Go to next page"]')
    expect(next).not.toBeNull()
    await act(async () => next?.click())
    expect(host.textContent).toContain("Vendor 025")

    await act(async () => {
      root.render(React.createElement(VendorsTable, { vendors, categories: ["Supplier"] }))
    })
    expect(host.querySelectorAll("tbody tr")).toHaveLength(25)
  })

  it("selects stable vendor IDs only when a bulk action is available", async () => {
    const vendors = Array.from({ length: 120 }, (_, index) => vendor(index))
    const onSelectionChange = vi.fn()
    await act(async () => {
      root.render(React.createElement(VendorsTable, {
        vendors, categories: ["Supplier"], selectedIds: [], onSelectionChange,
      }))
    })

    const first = host.querySelector<HTMLButtonElement>('button[aria-label="Select Vendor 000"]')
    expect(first).not.toBeNull()
    await act(async () => first?.click())
    expect(onSelectionChange).toHaveBeenLastCalledWith(["vendor-0"])

    await act(async () => {
      root.render(React.createElement(VendorsTable, {
        vendors, categories: ["Supplier"], selectedIds: ["vendor-0"], onSelectionChange,
      }))
    })
    expect(host.querySelector('button[aria-label="Select Vendor 000"]')?.getAttribute("aria-checked")).toBe("true")

    const selectPage = host.querySelector<HTMLButtonElement>('button[aria-label="Select all vendors on this page"]')
    await act(async () => selectPage?.click())
    expect(onSelectionChange.mock.lastCall?.[0]).toHaveLength(25)
    expect(onSelectionChange.mock.lastCall?.[0]).not.toContain("vendor-25")
  })
})
