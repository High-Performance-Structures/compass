import { describe, expect, it } from "vitest"

import { defaultRecordStatusList, resolveRecordStatuses } from "@/lib/domain/record-statuses/rules"

import {
  canonicalPurchaseOrderStatus,
  isOpenPurchaseOrder,
  parsePurchaseOrderStatusFilter,
  purchaseOrderFilterOptions,
  purchaseOrderMatchesFilter,
} from "../status-filter"

const DEFAULTS = defaultRecordStatusList("purchase_order")

describe("purchase order status filters (code defaults)", () => {
  it("reads stored spellings as the listed statuses", () => {
    expect(canonicalPurchaseOrderStatus("Partially-Received", DEFAULTS)).toBe("partially_received")
    expect(canonicalPurchaseOrderStatus(" Sent ", DEFAULTS)).toBe("sent")
    expect(canonicalPurchaseOrderStatus("voided", DEFAULTS)).toBe("void")
    expect(canonicalPurchaseOrderStatus("archived", DEFAULTS)).toBe("closed")
    expect(canonicalPurchaseOrderStatus("completed", DEFAULTS)).toBe("complete")
    expect(canonicalPurchaseOrderStatus("open", DEFAULTS)).toBeNull()
  })

  it("treats complete, closed, void, voided and archived as not open", () => {
    for (const status of ["complete", "closed", "void", "voided", "archived", "Canceled", "declined"]) {
      expect(isOpenPurchaseOrder(status, DEFAULTS)).toBe(false)
    }
    for (const status of ["draft", "approved", "sent", "ordered", "Partially-Received", "received", "open"]) {
      expect(isOpenPurchaseOrder(status, DEFAULTS)).toBe(true)
    }
  })

  it("matches a status button to every spelling of it", () => {
    expect(purchaseOrderMatchesFilter("voided", "void", DEFAULTS)).toBe(true)
    expect(purchaseOrderMatchesFilter("archived", "closed", DEFAULTS)).toBe(true)
    expect(purchaseOrderMatchesFilter("draft", "sent", DEFAULTS)).toBe(false)
    expect(purchaseOrderMatchesFilter("anything", "all", DEFAULTS)).toBe(true)
  })

  it("parses the URL filter, defaulting to open", () => {
    expect(parsePurchaseOrderStatusFilter(undefined, DEFAULTS)).toBe("open")
    expect(parsePurchaseOrderStatusFilter("all", DEFAULTS)).toBe("all")
    expect(parsePurchaseOrderStatusFilter(["partially_received"], DEFAULTS)).toBe("partially_received")
    expect(parsePurchaseOrderStatusFilter("bogus", DEFAULTS)).toBe("open")
  })

  it("counts each button from the stored status counts", () => {
    const options = purchaseOrderFilterOptions(
      [
        { status: "draft", count: 2 },
        { status: "voided", count: 3 },
        { status: "archived", count: 1 },
        { status: "Sent", count: 1 },
      ],
      DEFAULTS,
    )
    const counts = Object.fromEntries(options.map((option) => [option.value, option.count]))
    expect(counts).toMatchObject({ open: 3, draft: 2, sent: 1, void: 3, closed: 1, received: 0, all: 7 })
    expect(options.filter((option) => option.pinned).map((option) => option.value)).toEqual(["open", "all"])
    expect(options.map((option) => option.value)).toEqual([
      "open", "draft", "approved", "sent", "ordered", "partially_received", "received", "complete", "closed", "void", "all",
    ])
  })
})

describe("purchase order status filters (company statuses)", () => {
  const row = (statusKey: string, sortOrder: number, extra: Partial<{ label: string; statusGroup: string; hidden: boolean; showAsButton: boolean; builtIn: boolean }> = {}) => ({
    statusKey,
    label: extra.label ?? statusKey,
    color: "gray",
    statusGroup: extra.statusGroup ?? "open",
    sortOrder,
    showAsButton: extra.showAsButton ?? true,
    hidden: extra.hidden ?? false,
    builtIn: extra.builtIn ?? true,
  })

  it("follows the company's order, labels, hidden statuses and Open group", () => {
    const company = resolveRecordStatuses("purchase_order", [
      row("received", 0, { label: "Delivered", statusGroup: "closed" }),
      row("draft", 1),
      row("backordered", 2, { label: "Backordered", builtIn: false }),
      row("void", 3, { statusGroup: "void", showAsButton: false }),
      row("ordered", 4, { hidden: true }),
    ])
    const options = purchaseOrderFilterOptions(
      [
        { status: "received", count: 2 },
        { status: "backordered", count: 1 },
        { status: "draft", count: 4 },
      ],
      company,
    )
    const values = options.map((option) => option.value)
    expect(values[0]).toBe("open")
    expect(values.indexOf("received")).toBeLessThan(values.indexOf("draft"))
    expect(values.indexOf("draft")).toBeLessThan(values.indexOf("backordered"))
    expect(values).not.toContain("void")
    expect(values).not.toContain("ordered")
    expect(options.find((option) => option.value === "received")?.label).toBe("Delivered")
    // Received now counts as Closed, so Open is draft + backordered.
    expect(options[0]?.count).toBe(5)
    expect(isOpenPurchaseOrder("received", company)).toBe(false)
    expect(parsePurchaseOrderStatusFilter("backordered", company)).toBe("backordered")
  })
})
