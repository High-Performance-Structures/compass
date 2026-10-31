/** @vitest-environment jsdom */

import * as React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { Invoice } from "@/db/schema-netsuite"
import { InvoicesTable } from "@/components/financials/invoices-table"

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
})

const mobile = vi.hoisted(() => ({ value: false }))
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mobile.value }))

function invoice(index: number, overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: `invoice-${index}`,
    netsuiteId: null,
    organizationId: "org-1",
    customerId: "customer-1",
    projectId: "project-1",
    sourceSystem: "compass",
    sourceExternalId: null,
    invoiceNumber: `INV-${String(index).padStart(3, "0")}`,
    status: "partially_paid",
    issueDate: "2026-09-01T12:00:00.000Z",
    dueDate: null,
    subtotal: 1200,
    tax: 34.5,
    total: 1234.5,
    amountPaid: 0,
    amountDue: 1234.5,
    memo: null,
    lineItems: null,
    billingScope: "construction",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  }
}

describe("InvoicesTable", () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    mobile.value = false
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    document.body.replaceChildren()
  })

  const props = {
    customerMap: { "customer-1": "Acme Homes" },
    projectMap: { "project-1": "Ridge Remodel" },
  }

  it("renders every column with the same text as before", async () => {
    await act(async () => root.render(React.createElement(InvoicesTable, { ...props, invoices: [invoice(1)] })))
    const headers = [...host.querySelectorAll("thead th")].map((th) => th.textContent)
    expect(headers).toEqual(["", "Invoice #", "Customer", "Project", "Status", "Issue Date", "Due Date", "Total", "Amount Due", ""])
    const cells = [...host.querySelectorAll("tbody td")].map((td) => td.textContent)
    expect(cells.slice(1, 9)).toEqual([
      "INV-001",
      "Acme Homes",
      "Ridge Remodel",
      "partially paid",
      new Date("2026-09-01T12:00:00.000Z").toLocaleDateString(),
      "-",
      "$1,234.50",
      "$1,234.50",
    ])
  })

  it("filters by invoice number and shows the empty text", async () => {
    await act(async () => root.render(React.createElement(InvoicesTable, { ...props, invoices: [invoice(1), invoice(2)] })))
    const input = host.querySelector<HTMLInputElement>('input[placeholder="Search by invoice number..."]')
    expect(input).not.toBeNull()
    expect(host.querySelectorAll("tbody tr")).toHaveLength(2)

    await act(async () => root.render(React.createElement(InvoicesTable, { ...props, invoices: [] })))
    expect(host.textContent).toContain("No invoices found")
  })

  it("shows the phone list and its empty state", async () => {
    mobile.value = true
    await act(async () => root.render(React.createElement(InvoicesTable, {
      ...props,
      invoices: [invoice(1, { dueDate: "2026-10-01T12:00:00.000Z" })],
    })))
    expect(host.textContent).toContain("INV-001")
    expect(host.textContent).toContain(`Acme Homes · Due ${new Date("2026-10-01T12:00:00.000Z").toLocaleDateString()}`)
    expect(host.textContent).toContain("$1,234.50")

    await act(async () => root.render(React.createElement(InvoicesTable, { ...props, invoices: [] })))
    expect(host.textContent).toContain("No invoices yet")
    expect(host.textContent).toContain("Create an invoice to bill a customer for project work.")
  })
})
