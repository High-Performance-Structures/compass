import { describe, expect, it } from "vitest"

import {
  drawPaymentTarget,
  focusCustomerId,
  importedDrawSourceLabel,
  invoiceAcceptsPayments,
  isImportedDraw,
  invoicePaidValues,
  invoiceUnpaidStatus,
  paidCentsAfterRelease,
  parseVoidReason,
  paymentVoidBlocker,
  planPaymentAllocations,
  receivableOpenCents,
  receivablePaidState,
  receivablesForCustomer,
  storedDollarsToCents,
  type ReceivableItem,
} from "@/lib/domain/financials/rules"

const draw: ReceivableItem = {
  kind: "pay_application", id: "app-1", label: "Pay application 3",
  billedCents: 1_000_000, paidCents: 250_000, billingScope: "construction", sourceSystem: "compass_contract_budget",
}
const invoice: ReceivableItem = {
  kind: "invoice", id: "inv-1", label: "Invoice 1001",
  billedCents: 50_000, paidCents: 0, billingScope: "construction", sourceSystem: "compass",
}
const design: ReceivableItem = {
  kind: "invoice", id: "inv-2", label: "Invoice D-7",
  billedCents: 30_000, paidCents: 0, billingScope: "preconstruction", sourceSystem: "compass",
}

describe("received payment balances", () => {
  it("reads stored dollars as whole cents", () => {
    expect(storedDollarsToCents(1234.565)).toBe(123457)
    expect(storedDollarsToCents(0.1 + 0.2)).toBe(30)
    expect(storedDollarsToCents(null)).toBe(0)
  })

  it("never shows a negative open balance", () => {
    expect(receivableOpenCents(draw)).toBe(750_000)
    expect(receivableOpenCents({ billedCents: 100, paidCents: 150 })).toBe(0)
  })

  it("derives open, partially paid and paid", () => {
    expect(receivablePaidState(100, 0)).toBe("open")
    expect(receivablePaidState(100, 1)).toBe("partially_paid")
    expect(receivablePaidState(100, 100)).toBe("paid")
    expect(receivablePaidState(0, 0)).toBe("open")
  })
})

describe("planPaymentAllocations", () => {
  const openItems = [draw, invoice, design]

  it("applies a payment to one item and keeps the rest unapplied", () => {
    const plan = planPaymentAllocations({
      paymentCents: 800_000, alreadyAppliedCents: 0, openItems,
      requested: [{ kind: "pay_application", id: "app-1", cents: 750_000 }],
    })
    expect(plan).toMatchObject({ ok: true, appliedCents: 750_000, unappliedCents: 50_000 })
  })

  it("splits one payment across several of the customer's open items", () => {
    const plan = planPaymentAllocations({
      paymentCents: 800_000, alreadyAppliedCents: 0, openItems,
      requested: [
        { kind: "pay_application", id: "app-1", cents: 750_000 },
        { kind: "invoice", id: "inv-1", cents: 50_000 },
      ],
    })
    expect(plan.ok && plan.allocations.map((allocation) => allocation.cents)).toEqual([750_000, 50_000])
    expect(plan.ok && plan.unappliedCents).toBe(0)
  })

  it("blocks applying more than an item's open balance", () => {
    const plan = planPaymentAllocations({
      paymentCents: 2_000_000, alreadyAppliedCents: 0, openItems,
      requested: [{ kind: "pay_application", id: "app-1", cents: 750_001 }],
    })
    expect(plan).toEqual({ ok: false, error: "Pay application 3 has only $7,500.00 open. Apply no more than that." })
  })

  it("blocks applying more than the payment has unapplied", () => {
    expect(planPaymentAllocations({
      paymentCents: 100_000, alreadyAppliedCents: 0, openItems,
      requested: [
        { kind: "pay_application", id: "app-1", cents: 80_000 },
        { kind: "invoice", id: "inv-1", cents: 30_000 },
      ],
    })).toEqual({ ok: false, error: "The applied amounts total $1,100.00, more than the $1,000.00 this payment has unapplied." })
    expect(planPaymentAllocations({
      paymentCents: 100_000, alreadyAppliedCents: 90_000, openItems,
      requested: [{ kind: "invoice", id: "inv-1", cents: 10_001 }],
    }).ok).toBe(false)
  })

  it("rejects items that are not open for the customer, duplicates, and non-positive amounts", () => {
    const base = { paymentCents: 100_000, alreadyAppliedCents: 0, openItems }
    expect(planPaymentAllocations({ ...base, requested: [{ kind: "invoice", id: "other", cents: 1 }] }).ok).toBe(false)
    expect(planPaymentAllocations({
      ...base,
      requested: [{ kind: "invoice", id: "inv-1", cents: 1 }, { kind: "invoice", id: "inv-1", cents: 1 }],
    })).toEqual({ ok: false, error: "Each pay application or invoice can be listed only once." })
    expect(planPaymentAllocations({ ...base, requested: [{ kind: "invoice", id: "inv-1", cents: -5 }] }).ok).toBe(false)
    expect(planPaymentAllocations({ ...base, requested: [{ kind: "invoice", id: "inv-1", cents: 1.5 }] }).ok).toBe(false)
    expect(planPaymentAllocations({ ...base, requested: [] })).toEqual({
      ok: false, error: "Apply the payment to at least one pay application or invoice.",
    })
    expect(planPaymentAllocations({ ...base, paymentCents: 0, requested: [{ kind: "invoice", id: "inv-1", cents: 1 }] }).ok).toBe(false)
  })

  it("keeps one payment on one billing scope", () => {
    expect(planPaymentAllocations({
      paymentCents: 100_000, alreadyAppliedCents: 0, openItems,
      requested: [{ kind: "invoice", id: "inv-1", cents: 1 }, { kind: "invoice", id: "inv-2", cents: 1 }],
    }).ok).toBe(false)
  })
})

describe("customer items", () => {
  const rows = [
    { kind: "pay_application" as const, customerId: "client-1" },
    { kind: "invoice" as const, customerId: "client-1" },
    { kind: "invoice" as const, customerId: "client-2" },
  ]

  it("pairs the project's client with its pay applications and invoices", () => {
    expect(receivablesForCustomer(rows, "client-1", "client-1")).toEqual(rows.slice(0, 2))
    expect(receivablesForCustomer(rows, "client-1", "client-2")).toEqual([rows[2]])
    expect(receivablesForCustomer(rows, "client-1", "client-3")).toBeNull()
  })

  it("lets pay applications count for any customer while the project has no directory client", () => {
    expect(receivablesForCustomer(rows, null, null)).toEqual([rows[0]])
    expect(receivablesForCustomer(rows, null, "client-2")).toEqual([rows[0], rows[2]])
  })

  it("credits a payment to the invoice's customer or the project's client", () => {
    expect(focusCustomerId({ kind: "invoice", customerId: "client-2" }, "client-1")).toBe("client-2")
    expect(focusCustomerId({ kind: "pay_application", customerId: "client-1" }, "client-9")).toBe("client-9")
  })
})

describe("invoice paid values", () => {
  it("updates amount paid, amount due and status from cents", () => {
    expect(invoicePaidValues({ totalDollars: 500, paidCents: 20_000, unpaidStatus: "sent" }))
      .toEqual({ amountPaid: 200, amountDue: 300, status: "partially_paid" })
    expect(invoicePaidValues({ totalDollars: 500, paidCents: 50_000, unpaidStatus: "sent" }))
      .toEqual({ amountPaid: 500, amountDue: 0, status: "paid" })
    expect(invoicePaidValues({ totalDollars: 500, paidCents: 0, unpaidStatus: "open" }))
      .toEqual({ amountPaid: 0, amountDue: 500, status: "open" })
  })

  it("returns an invoice to its unpaid status by source", () => {
    expect(invoiceUnpaidStatus("sage")).toBe("open")
    expect(invoiceUnpaidStatus("compass")).toBe("sent")
  })

  it("only takes payments on sent invoices, billed Compass draws and imported draws with an amount due", () => {
    expect(invoiceAcceptsPayments("draft")).toBe(false)
    expect(invoiceAcceptsPayments("void")).toBe(false)
    expect(invoiceAcceptsPayments("sent")).toBe(true)
    const due = { currentPaymentDue: 100 }
    const payApplicationAcceptsPayments = (draw: Parameters<typeof drawPaymentTarget>[0]): boolean => {
      const target = drawPaymentTarget(draw)
      return target.listed && target.blocker === null
    }
    expect(payApplicationAcceptsPayments({ ...due, sourceSystem: "compass_contract_budget", status: "billed" })).toBe(true)
    expect(payApplicationAcceptsPayments({ ...due, sourceSystem: "compass_contract_budget", status: "internal_review" })).toBe(false)
    expect(payApplicationAcceptsPayments({ ...due, sourceSystem: "sage", status: "current" })).toBe(true)
    expect(payApplicationAcceptsPayments({ ...due, sourceSystem: "google_drive_g702_g703", status: "paid_in_full" })).toBe(true)
    expect(payApplicationAcceptsPayments({ ...due, sourceSystem: "sage_read_snapshot", status: "imported_draft" })).toBe(true)
    expect(payApplicationAcceptsPayments({ currentPaymentDue: 0, sourceSystem: "sage", status: "current" })).toBe(false)
  })
})

describe("imported draws", () => {
  it("tells imported draws from Compass draws and budget views", () => {
    expect(isImportedDraw({ sourceSystem: "compass_contract_budget" })).toBe(false)
    expect(isImportedDraw({ sourceSystem: "compass_contract_budget_projection" })).toBe(false)
    expect(isImportedDraw({ sourceSystem: "sage" })).toBe(true)
    expect(isImportedDraw({ sourceSystem: "google_drive_g702_g703" })).toBe(true)
    expect(importedDrawSourceLabel("sage_read_snapshot")).toBe("Imported from Sage")
    expect(importedDrawSourceLabel("google_drive_g702_g703")).toBe("Imported from Drive")
    expect(importedDrawSourceLabel("spreadsheet")).toBe("Imported")
    expect(importedDrawSourceLabel("compass_contract_budget")).toBeNull()
  })

  it("lists only billed Compass draws, and leaves out drafts, budget views and void imports", () => {
    expect(drawPaymentTarget({ sourceSystem: "compass_contract_budget", status: "billed", currentPaymentDue: 50 }))
      .toEqual({ listed: true, billedCents: 5000, blocker: null })
    for (const status of ["building", "internal_review", "draft"]) {
      expect(drawPaymentTarget({ sourceSystem: "compass_contract_budget", status, currentPaymentDue: 50 })).toEqual({ listed: false })
    }
    expect(drawPaymentTarget({ sourceSystem: "compass_contract_budget_projection", status: "budget_current", currentPaymentDue: 50 }))
      .toEqual({ listed: false })
    for (const status of ["void", "superseded", "building", "budget_current", "budget_superseded"]) {
      expect(drawPaymentTarget({ sourceSystem: "sage", status, currentPaymentDue: 50 })).toEqual({ listed: false })
    }
  })

  it("takes the current payment due as an imported draw's billed amount", () => {
    expect(drawPaymentTarget({ sourceSystem: "google_drive_g702_g703", status: "current", currentPaymentDue: 1234.565 }))
      .toEqual({ listed: true, billedCents: 123_457, blocker: null })
  })

  it("lists an imported draw without a usable billed amount, with the reason, rather than guessing", () => {
    const zero = drawPaymentTarget({ sourceSystem: "google_drive_g702_g703", status: "paid_in_full", currentPaymentDue: 0 })
    expect(zero).toMatchObject({ listed: true, billedCents: 0, blocker: expect.stringMatching(/no current payment due/) })
    const negative = drawPaymentTarget({ sourceSystem: "sage", status: "current", currentPaymentDue: -12.5 })
    expect(negative).toMatchObject({ listed: true, blocker: expect.stringMatching(/negative current payment due/) })
    const missing = drawPaymentTarget({ sourceSystem: "sage", status: "current", currentPaymentDue: null })
    expect(missing).toMatchObject({ listed: true, billedCents: 0, blocker: expect.stringMatching(/No current payment due was imported/) })
    expect(drawPaymentTarget({ sourceSystem: "sage", status: "current", currentPaymentDue: Number.NaN }))
      .toMatchObject({ blocker: expect.stringMatching(/No current payment due was imported/) })
  })

  it("keeps the same guards: an imported draw is the project client's construction billing", () => {
    const imported: ReceivableItem = { ...draw, id: "imp", label: "Pay application 5", sourceSystem: "google_drive_g702_g703" }
    expect(receivablesForCustomer([{ ...imported, customerId: null }], "client-1", "someone-else")).toBeNull()
    const plan = planPaymentAllocations({
      paymentCents: 2_000_000,
      alreadyAppliedCents: 0,
      openItems: [imported],
      requested: [{ kind: "pay_application", id: "imp", cents: imported.billedCents + 1 }],
    })
    expect(plan).toMatchObject({ ok: false, error: expect.stringMatching(/has only/) })
  })
})

describe("voiding", () => {
  it("needs a reason", () => {
    expect(parseVoidReason("  ")).toEqual({ ok: false, error: "Say why the payment is being voided." })
    expect(parseVoidReason(" Check returned ")).toEqual({ ok: true, reason: "Check returned" })
    expect(parseVoidReason("x".repeat(600))).toMatchObject({ ok: true, reason: "x".repeat(500) })
  })

  it("voids Compass payments once, never Square payments from Sage", () => {
    expect(paymentVoidBlocker({ sourceSystem: "compass", voidedAt: null })).toBeNull()
    expect(paymentVoidBlocker({ sourceSystem: "compass", voidedAt: "2026-10-31" })).toBe("This payment is already void.")
    expect(paymentVoidBlocker({ sourceSystem: "sage", voidedAt: null })).toMatch(/Square/)
  })

  it("releases a voided payment without going below zero", () => {
    expect(paidCentsAfterRelease(50_000, 20_000)).toBe(30_000)
    expect(paidCentsAfterRelease(10_000, 20_000)).toBe(0)
  })
})
