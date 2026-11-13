import { describe, expect, it } from "vitest"

import { billSequence, listedBillFor, ownerPayApplicationsOnce, receivablesOncePerBill, type BillRef } from "@/lib/domain/financials/rules"

/*
 * A job brought over from another system has bills twice: once as an
 * invoice or pay application (listed with received payments) and once as the
 * promoted cutover row in the financial workflow list, not always under the
 * same source system. Two records are the same bill only when the amounts
 * agree to the cent and an id or the number matches. Shapes from production;
 * ids fictional.
 */

type Listed = BillRef & { readonly label: string }

const workflow = (overrides: Partial<Parameters<typeof listedBillFor>[0]>) => ({
  sourceSystem: "buildertrend",
  sourceRecordType: "owner_invoice",
  sourceRecordId: "bt-inv-1001",
  sourceRecordNumber: "INV-7",
  amount: 1234.5,
  ...overrides,
})

describe("imported workflow copies of listed bills", () => {
  it("H-329-9607: the buildertrend_import pay requests are the Compass invoices -01 and -02", () => {
    const listed: Listed[] = [
      { kind: "invoice", ids: ["inv-a", null], number: "H-329-9607-01", cents: 5_673_883, label: "Invoice H-329-9607-01" },
      { kind: "invoice", ids: ["inv-b", null], number: "H-329-9607-02", cents: 9_034_813, label: "Invoice H-329-9607-02" },
    ]
    const payRequest = (number: string, amount: number) =>
      workflow({ sourceSystem: "buildertrend_import", sourceRecordType: "owner_pay_application", sourceRecordId: `bt-${number}`, sourceRecordNumber: number, amount })
    expect(listedBillFor(payRequest("H-329-9607-01", 56_738.83), listed)?.label).toBe("Invoice H-329-9607-01")
    expect(listedBillFor(payRequest("H-329-9607-02", 90_348.13), listed)?.label).toBe("Invoice H-329-9607-02")
    // A different amount is a different bill.
    expect(listedBillFor(payRequest("H-329-9607-02", 90_348.14), listed)).toBeNull()
  })

  it("matches an invoice only to an invoice and a pay request only to a draw", () => {
    const invoice: Listed = { kind: "invoice", ids: ["inv-1", "bt-inv-1001"], number: "INV-7", cents: 123_450, label: "Invoice INV-7" }
    const draw: Listed = { kind: "draw", ids: ["app-4", "drive-file-4"], number: "PA-004", cents: 123_450, label: "Pay application PA-004" }
    expect(listedBillFor(workflow({}), [invoice, draw])?.label).toBe("Invoice INV-7")
    expect(listedBillFor(workflow({ sourceRecordId: "staging-9" }), [draw])).toBeNull()
    // A Drive draw's workflow row matches its listed pay application by id or sequence ("4" is PA-004).
    const drivePayRequest = { sourceSystem: "google_drive_g702_g703", sourceRecordType: "owner_pay_application", sourceRecordNumber: "4" }
    expect(listedBillFor(workflow({ ...drivePayRequest, sourceRecordId: null }), [invoice, draw])?.label).toBe("Pay application PA-004")
    expect(listedBillFor(workflow({ ...drivePayRequest, sourceSystem: "buildertrend", sourceRecordId: null, sourceRecordNumber: "INV-7" }), [invoice])).toBeNull()
  })

  it("keeps bills not listed elsewhere, Compass's own workflow items, and payments", () => {
    const listed: Listed[] = [{ kind: "draw", ids: ["app-1"], number: "1", cents: 123_450, label: "Pay application 1" }]
    expect(listedBillFor(workflow({ sourceRecordType: "owner_pay_application", sourceRecordId: "bt-2", sourceRecordNumber: "9" }), listed)).toBeNull()
    expect(listedBillFor(workflow({ sourceSystem: "compass", sourceRecordType: "owner_pay_application", sourceRecordId: "app-1" }), listed)).toBeNull()
    for (const sourceRecordType of ["payment", "deposit", "credit_memo"]) {
      expect(listedBillFor(workflow({ sourceRecordType, sourceRecordId: "app-1" }), listed)).toBeNull()
    }
  })

  it("reads a draw's sequence from the end of its number", () => {
    expect(billSequence("PA-009")).toBe("9")
    expect(billSequence("H-329-9607-01")).toBe("1")
    expect(billSequence("Contract Budget R2")).toBe("2")
    expect(billSequence("Final")).toBeNull()
  })
})

describe("received payments list each bill once", () => {
  const item = (label: string, overrides: Partial<{ bill: BillRef; sourceSystem: string; paidCents: number; prepaid: unknown }>) => ({
    label,
    bill: { kind: "invoice" as const, ids: [], number: "H-1-01", cents: 100_000 },
    sourceSystem: "buildertrend",
    paidCents: 0,
    prepaid: null,
    ...overrides,
  })

  it("a Buildertrend invoice and a Drive G702 for the same bill show once, as the draw", () => {
    const invoice = item("Invoice H-1-01", {})
    const draw = item("Pay application 1", { bill: { kind: "draw", ids: [], number: "1", cents: 100_000 }, sourceSystem: "google_drive_g702_g703" })
    expect(receivablesOncePerBill([invoice, draw])).toEqual([{ row: draw, sameBillAs: "Invoice H-1-01" }])
  })

  it("never leaves out a copy with payments, a Compass or Sage record, or a different amount", () => {
    const paid = item("Invoice H-1-01", { paidCents: 5_000 })
    const draw = item("Pay application 1", { bill: { kind: "draw", ids: [], number: "1", cents: 100_000 }, sourceSystem: "google_drive_g702_g703" })
    expect(receivablesOncePerBill([paid, draw]).map((entry) => entry.row)).toEqual([paid])
    const compassDraw = item("Pay application 1", { bill: { kind: "draw", ids: [], number: "1", cents: 100_000 }, sourceSystem: "compass_contract_budget" })
    const compassInvoice = item("Invoice H-1-01", { sourceSystem: "compass" })
    expect(receivablesOncePerBill([compassInvoice, compassDraw])).toHaveLength(2)
    const other = item("Pay application 1", { bill: { kind: "draw", ids: [], number: "1", cents: 100_001 }, sourceSystem: "google_drive_g702_g703" })
    expect(receivablesOncePerBill([item("Invoice H-1-01", {}), other])).toHaveLength(2)
  })
})

describe("owner pay applications", () => {
  it("show each bill once, keeping the live record, matched by sequence and amount", () => {
    const rows = [
      { id: "drive-9", sourceSystem: "google_drive_g702_g703", applicationNumber: "9", currentPaymentDue: 1200 },
      { id: "compass-9", sourceSystem: "compass_contract_budget", applicationNumber: "PA-009", currentPaymentDue: 1200 },
      { id: "sage-8", sourceSystem: "sage_pay_request", applicationNumber: "8", currentPaymentDue: 900 },
      { id: "drive-8", sourceSystem: "google_drive_g702_g703", applicationNumber: "8", currentPaymentDue: 900 },
      // Same number, different amount: not the same bill.
      { id: "drive-7", sourceSystem: "google_drive_g702_g703", applicationNumber: "7", currentPaymentDue: 700 },
      { id: "drive-7b", sourceSystem: "google_drive_g702_g703", applicationNumber: "7", currentPaymentDue: 701 },
      { id: "budget", sourceSystem: "compass_contract_budget_projection", applicationNumber: "Contract Budget R9", currentPaymentDue: 0 },
    ]
    expect(ownerPayApplicationsOnce(rows).map((row) => row.id)).toEqual(["compass-9", "sage-8", "drive-7", "drive-7b", "budget"])
  })
})
