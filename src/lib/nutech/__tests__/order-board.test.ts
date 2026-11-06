import { describe, expect, it } from "vitest"

import {
  buildNuTechOrderBoard,
  businessDaysBetween,
  matchesNuTechBoardStatus,
  nuTechBoardQueues,
  type NuTechBoardOrderInput,
} from "@/lib/nutech/order-board"

const SETTINGS = { shipsWithinDays: 7, confirmationBusinessDays: 1, invoiceAfterDeliveryDays: 3 }
// A Thursday.
const TODAY = "2026-11-05"

function order(overrides: Partial<NuTechBoardOrderInput> = {}): NuTechBoardOrderInput {
  return {
    orderId: "o1",
    orderNumber: 1,
    orderTitle: null,
    projectId: "p1",
    projectNumber: "N-997-00",
    projectName: "Hartman Fox Blocks",
    clientName: "Brian Hartman",
    orderStatus: "intake",
    deliveryMethod: "delivery",
    requestedDeliveryDate: null,
    confirmedDeliveryDate: null,
    confirmedDeliveryTime: null,
    carrier: null,
    customerPaidAt: null,
    purchaseOrderReleasedAt: null,
    vendorConfirmationNumber: null,
    vendorInvoiceNumber: null,
    vendorInvoiceStatus: "not_received",
    updatedAt: "2026-11-01T00:00:00.000Z",
    ...overrides,
  }
}

describe("businessDaysBetween", () => {
  it("skips weekends", () => {
    // Fri Nov 6 → Mon Nov 9 is one business day.
    expect(businessDaysBetween("2026-11-06", "2026-11-09")).toBe(1)
    expect(businessDaysBetween("2026-11-05", "2026-11-05")).toBe(0)
    expect(businessDaysBetween("2026-11-09", "2026-11-05")).toBe(0)
  })
})

describe("nuTechBoardQueues", () => {
  it("flags a requested date within the window, not past or beyond it", () => {
    expect(nuTechBoardQueues(order({ requestedDeliveryDate: "2026-11-11" }), TODAY, SETTINGS)).toContain("ships_soon")
    expect(nuTechBoardQueues(order({ requestedDeliveryDate: "2026-11-13" }), TODAY, SETTINGS)).not.toContain("ships_soon")
    expect(nuTechBoardQueues(order({ requestedDeliveryDate: "2026-11-04" }), TODAY, SETTINGS)).not.toContain("ships_soon")
  })

  it("asks for payment only once the customer has approved", () => {
    expect(nuTechBoardQueues(order({ orderStatus: "estimate_ready" }), TODAY, SETTINGS)).not.toContain("approved_unpaid")
    expect(nuTechBoardQueues(order({ orderStatus: "customer_approved" }), TODAY, SETTINGS)).toContain("approved_unpaid")
    expect(
      nuTechBoardQueues(order({ orderStatus: "customer_approved", customerPaidAt: "2026-11-02" }), TODAY, SETTINGS),
    ).not.toContain("approved_unpaid")
  })

  it("flags a released PO with no confirmation after the business-day wait", () => {
    const released = order({ orderStatus: "po_released", customerPaidAt: "2026-10-13", purchaseOrderReleasedAt: "2026-10-14T16:00:00.000Z" })
    expect(nuTechBoardQueues(released, TODAY, SETTINGS)).toEqual(["unconfirmed"])
    expect(nuTechBoardQueues({ ...released, purchaseOrderReleasedAt: TODAY }, TODAY, SETTINGS)).toEqual([])
    expect(nuTechBoardQueues({ ...released, vendorConfirmationNumber: "128651-EPS" }, TODAY, SETTINGS)).toEqual([])
  })

  it("flags a confirmed order past its date with no invoice", () => {
    const confirmed = order({
      orderStatus: "vendor_confirmed",
      customerPaidAt: "2026-10-22",
      vendorConfirmationNumber: "128651-EPS",
      requestedDeliveryDate: "2026-10-28",
    })
    expect(nuTechBoardQueues(confirmed, TODAY, SETTINGS)).toEqual(["no_invoice"])
    expect(nuTechBoardQueues({ ...confirmed, requestedDeliveryDate: "2026-11-04" }, TODAY, SETTINGS)).toEqual([])
    expect(nuTechBoardQueues({ ...confirmed, vendorInvoiceStatus: "received" }, TODAY, SETTINGS)).toEqual([])
  })

  it("never flags closed orders", () => {
    expect(nuTechBoardQueues(order({ orderStatus: "complete", requestedDeliveryDate: "2026-11-06" }), TODAY, SETTINGS)).toEqual([])
    expect(nuTechBoardQueues(order({ orderStatus: "cancelled" }), TODAY, SETTINGS)).toEqual([])
  })

  it("follows the company's settings", () => {
    const soon = order({ requestedDeliveryDate: "2026-11-13" })
    expect(nuTechBoardQueues(soon, TODAY, { ...SETTINGS, shipsWithinDays: 10 })).toContain("ships_soon")
  })
})

describe("buildNuTechOrderBoard", () => {
  it("counts queues and statuses and names the manufacturer in next steps", () => {
    const board = buildNuTechOrderBoard({
      today: TODAY,
      settings: SETTINGS,
      manufacturerName: "Fox Blocks",
      orders: [
        order({ orderId: "a", orderStatus: "po_released", customerPaidAt: "2026-10-13", purchaseOrderReleasedAt: "2026-10-14" }),
        order({ orderId: "b", orderStatus: "customer_approved", requestedDeliveryDate: "2026-11-11" }),
        order({ orderId: "c", orderStatus: "complete" }),
      ],
    })
    expect(board.queueCounts).toEqual({ no_date: 0, ships_soon: 1, approved_unpaid: 1, unconfirmed: 1, no_invoice: 0 })
    expect(board.statusCounts).toEqual({ open: 2, complete: 1, cancelled: 0, all: 3 })
    const [unconfirmed, unpaid, done] = board.rows
    expect(unconfirmed?.nextStep).toBe("Call Fox Blocks: no confirmation since Oct 14.")
    expect(unconfirmed?.nextStepUrgent).toBe(true)
    expect(unpaid?.nextStep).toBe("Collect payment before Nov 11.")
    expect(unpaid?.unpaidBeforeShipping).toBe(true)
    expect(done?.nextStep).toBe("")
  })

  it("falls back to a generic name when no manufacturer is set", () => {
    const board = buildNuTechOrderBoard({
      today: TODAY,
      settings: SETTINGS,
      manufacturerName: " ",
      orders: [order({ orderStatus: "po_ready", customerPaidAt: "2026-11-01" })],
    })
    expect(board.rows[0]?.nextStep).toBe("Send the PO to the manufacturer.")
  })
})

describe("matchesNuTechBoardStatus", () => {
  it("keeps open orders on Open and closed ones on their own filters", () => {
    expect(matchesNuTechBoardStatus({ orderStatus: "po_released" }, "open")).toBe(true)
    expect(matchesNuTechBoardStatus({ orderStatus: "complete" }, "open")).toBe(false)
    expect(matchesNuTechBoardStatus({ orderStatus: "complete" }, "complete")).toBe(true)
    expect(matchesNuTechBoardStatus({ orderStatus: "cancelled" }, "all")).toBe(true)
  })
})

describe("confirmed pickup or delivery", () => {
  it("asks for the date once the manufacturer confirms, until it is set", () => {
    const confirmed = order({ orderStatus: "vendor_confirmed", vendorConfirmationNumber: "258670-EPS", customerPaidAt: "2026-10-22" })
    expect(nuTechBoardQueues(confirmed, TODAY, SETTINGS)).toEqual(["no_date"])
    expect(nuTechBoardQueues({ ...confirmed, confirmedDeliveryDate: "2026-11-20" }, TODAY, SETTINGS)).toEqual([])
    // Past the requested date it has shipped; no date is no longer the problem.
    expect(nuTechBoardQueues({ ...confirmed, requestedDeliveryDate: "2026-10-01" }, TODAY, SETTINGS)).not.toContain("no_date")
  })

  it("times ships-soon and the invoice chase from the confirmed date over the requested one", () => {
    const shipped = order({
      orderStatus: "vendor_confirmed",
      customerPaidAt: "2026-10-22",
      requestedDeliveryDate: "2026-10-20",
      confirmedDeliveryDate: "2026-11-09",
    })
    expect(nuTechBoardQueues(shipped, TODAY, SETTINGS)).toEqual(["ships_soon"])
  })

  it("shows the confirmed date, time and carrier as the next step", () => {
    const board = buildNuTechOrderBoard({
      today: TODAY,
      settings: SETTINGS,
      manufacturerName: "Fox Blocks",
      orders: [
        order({
          orderStatus: "vendor_confirmed",
          customerPaidAt: "2026-10-22",
          confirmedDeliveryDate: "2026-11-20",
          confirmedDeliveryTime: "dock time 2:00 PM",
          carrier: "Open Wheel Logistics",
        }),
      ],
    })
    expect(board.rows[0]?.nextStep).toMatch(/^Delivery .+, dock time 2:00 PM, via Open Wheel Logistics\.$/)
    expect(board.rows[0]?.nextStepUrgent).toBe(false)
  })
})
