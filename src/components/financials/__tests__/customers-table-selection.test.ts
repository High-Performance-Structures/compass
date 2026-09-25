/** @vitest-environment jsdom */

import * as React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { Customer } from "@/db/schema"
import { CustomersTable } from "@/components/financials/customers-table"

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
})

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }))
vi.mock("@/components/developer-mode-provider", () => ({
  useDeveloperMode: () => ({ developerModeEnabled: false }),
}))

function customer(index: number): Customer {
  return {
    id: `customer-${index}`,
    name: `Client ${String(index).padStart(3, "0")}`,
    company: null,
    email: null,
    phone: null,
    address: null,
    addressLine1: null,
    addressLine2: null,
    city: null,
    state: null,
    postalCode: null,
    billingAddressLine1: null,
    billingAddressLine2: null,
    billingCity: null,
    billingState: null,
    billingPostalCode: null,
    primaryEmail: null,
    notes: null,
    netsuiteId: null,
    sageClientId: null,
    sageClientNumber: null,
    sageClientStatusId: null,
    buildertrendContactId: null,
    relationshipType: "client",
    organizationId: "org-1",
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: null,
  }
}

describe("CustomersTable selection", () => {
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

  it("selects client account IDs, not names, when project association is available", async () => {
    const customers = Array.from({ length: 120 }, (_, index) => customer(index))
    const onSelectionChange = vi.fn()
    await act(async () => root.render(React.createElement(CustomersTable, {
      customers, selectedIds: [], onSelectionChange,
    })))

    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="Select Client 000"]')?.click()
    })
    expect(onSelectionChange).toHaveBeenLastCalledWith(["customer-0"])

    await act(async () => root.render(React.createElement(CustomersTable, {
      customers, selectedIds: ["customer-0"], onSelectionChange,
    })))
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="Select all clients on this page"]')?.click()
    })
    expect(onSelectionChange.mock.lastCall?.[0]).toHaveLength(25)
    expect(onSelectionChange.mock.lastCall?.[0]).not.toContain("customer-25")
  })
})
