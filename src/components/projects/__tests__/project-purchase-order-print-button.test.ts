/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest"

import { printProjectPurchaseOrder } from "@/components/projects/project-purchase-order-print-button"

vi.mock("@/lib/print/ios-print", () => ({
  requiresSynchronousPrint: () => false,
}))

vi.mock("@/lib/print/readiness", () => ({
  IOS_PRINT_STATE_TIMEOUT_MS: 120_000,
  PRINT_STATE_TIMEOUT_MS: 5_000,
  waitForPrintLayout: vi.fn(async () => undefined),
}))

describe("purchase order printing", () => {
  afterEach(() => {
    document.body.className = ""
    document.body.replaceChildren()
    vi.restoreAllMocks()
  })

  it("prints a body-level copy that can flow across multiple pages", async () => {
    const appShell = document.createElement("main")
    const purchaseOrder = document.createElement("article")
    purchaseOrder.dataset.poId = "po-white-cap"
    purchaseOrder.append(
      ...Array.from({ length: 75 }, (_, index) => {
        const line = document.createElement("div")
        line.dataset.purchaseOrderLine = "true"
        line.textContent = `Line ${index + 1}`
        return line
      })
    )
    appShell.appendChild(purchaseOrder)
    document.body.appendChild(appShell)
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => undefined)

    await printProjectPurchaseOrder("po-white-cap")

    const printRoot = document.querySelector(
      '[data-purchase-order-print-root="true"]'
    )
    expect(printRoot?.parentElement).toBe(document.body)
    expect(
      printRoot?.querySelectorAll('[data-purchase-order-line="true"]')
    ).toHaveLength(75)
    expect(printRoot).not.toBe(purchaseOrder)
    expect(document.body.classList.contains("po-printing-selected")).toBe(true)
    expect(printSpy).toHaveBeenCalledOnce()

    window.dispatchEvent(new Event("afterprint"))
    expect(document.body.classList.contains("po-printing-selected")).toBe(false)
    expect(
      document.querySelector('[data-purchase-order-print-root="true"]')
    ).toBeNull()
  })
})
