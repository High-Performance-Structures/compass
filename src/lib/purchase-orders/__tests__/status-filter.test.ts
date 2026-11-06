import { describe, expect, it } from "vitest"

import {
  canonicalPurchaseOrderStatus,
  isOpenPurchaseOrder,
  parsePurchaseOrderStatusFilter,
  purchaseOrderFilterOptions,
  purchaseOrderMatchesFilter,
} from "../status-filter"

describe("purchase order status filters", () => {
  it("reads stored spellings as the listed statuses", () => {
    expect(canonicalPurchaseOrderStatus("Partially-Received")).toBe("partially_received")
    expect(canonicalPurchaseOrderStatus(" Sent ")).toBe("sent")
    expect(canonicalPurchaseOrderStatus("voided")).toBe("void")
    expect(canonicalPurchaseOrderStatus("archived")).toBe("closed")
    expect(canonicalPurchaseOrderStatus("completed")).toBe("complete")
    expect(canonicalPurchaseOrderStatus("open")).toBeNull()
  })

  it("treats complete, closed, void, voided and archived as not open", () => {
    for (const status of ["complete", "closed", "void", "voided", "archived", "Canceled", "declined"]) {
      expect(isOpenPurchaseOrder(status)).toBe(false)
    }
    for (const status of ["draft", "approved", "sent", "ordered", "Partially-Received", "received", "open"]) {
      expect(isOpenPurchaseOrder(status)).toBe(true)
    }
  })

  it("matches a status button to every spelling of it", () => {
    expect(purchaseOrderMatchesFilter("voided", "void")).toBe(true)
    expect(purchaseOrderMatchesFilter("archived", "closed")).toBe(true)
    expect(purchaseOrderMatchesFilter("draft", "sent")).toBe(false)
    expect(purchaseOrderMatchesFilter("anything", "all")).toBe(true)
  })

  it("parses the URL filter, defaulting to open", () => {
    expect(parsePurchaseOrderStatusFilter(undefined)).toBe("open")
    expect(parsePurchaseOrderStatusFilter("all")).toBe("all")
    expect(parsePurchaseOrderStatusFilter(["partially_received"])).toBe("partially_received")
    expect(parsePurchaseOrderStatusFilter("bogus")).toBe("open")
  })

  it("counts each button from the stored status counts", () => {
    const options = purchaseOrderFilterOptions([
      { status: "draft", count: 2 },
      { status: "voided", count: 3 },
      { status: "archived", count: 1 },
      { status: "Sent", count: 1 },
    ])
    const counts = Object.fromEntries(options.map((option) => [option.value, option.count]))
    expect(counts).toMatchObject({ open: 3, draft: 2, sent: 1, void: 3, closed: 1, received: 0, all: 7 })
    expect(options.filter((option) => option.pinned).map((option) => option.value)).toEqual(["open", "all"])
  })
})
