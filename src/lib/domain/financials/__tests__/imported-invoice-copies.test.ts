import { describe, expect, it } from "vitest"

import { billSequence, listedBillFor, ownerPayApplicationHistory, ownerPayApplicationsOnce, receivablesOncePerBill, type BillRef } from "@/lib/domain/financials/rules"

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
    expect(listedBillFor(payRequest("H-329-9607-01", 56_738.83), listed)?.bill.label).toBe("Invoice H-329-9607-01")
    expect(listedBillFor(payRequest("H-329-9607-02", 90_348.13), listed)?.bill.label).toBe("Invoice H-329-9607-02")
    // A different amount is a different bill.
    expect(listedBillFor(payRequest("H-329-9607-02", 90_348.14), listed)).toBeNull()
  })

  it("matches an invoice only to an invoice and a pay request only to a draw", () => {
    const invoice: Listed = { kind: "invoice", ids: ["inv-1", "bt-inv-1001"], number: "INV-7", cents: 123_450, label: "Invoice INV-7" }
    const draw: Listed = { kind: "draw", ids: ["app-4", "drive-file-4"], number: "PA-004", cents: 123_450, label: "Pay application PA-004" }
    expect(listedBillFor(workflow({}), [invoice, draw])?.bill.label).toBe("Invoice INV-7")
    expect(listedBillFor(workflow({ sourceRecordId: "staging-9" }), [draw])).toBeNull()
    // A Drive draw's workflow row matches its listed pay application by id or sequence ("4" is PA-004).
    const drivePayRequest = { sourceSystem: "google_drive_g702_g703", sourceRecordType: "owner_pay_application", sourceRecordNumber: "4" }
    expect(listedBillFor(workflow({ ...drivePayRequest, sourceRecordId: null }), [invoice, draw])?.bill.label).toBe("Pay application PA-004")
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

// ---------------------------------------------------------------------------
// Production shapes the owner pointed at (read-only data, 2026-11-12).
// ---------------------------------------------------------------------------

const dollars = (value: number): number => Math.round(value * 100)

describe("Loomis (O-170-2684), staff side", () => {
  const invoice = (number: string, amount: number): Listed => ({ kind: "invoice", ids: [`inv-${number}`], number, cents: dollars(amount), label: `Invoice ${number}` })
  const invoices: Listed[] = [
    invoice("O-170-0001", 6178.75), invoice("O-170-0002", 1425), invoice("O-170-0003", 50322.11), invoice("O-170-002", 18460.77),
    invoice("O-170-003", 127452.82), invoice("O-170-004", 109097.63), invoice("O-170-005", 93632.88), invoice("O-170-O-170-001", 1576.25),
    invoice("O-170-PR5-31Aug26", 68614.43), invoice("O-170-PR6-FINAL", 30944.17),
  ]
  // Drive draws 1-6: amount due, and total earned less retainage.
  const draws: Listed[] = [
    [18460.77, 68782.88], [133149.11, 199584.37], [109097.63, 307605.58], [99936.54, 407542.12], [68614.43, 476156.55], [0, 507100.72],
  ].map(([due, earned], index) => ({
    kind: "draw", ids: [`draw-${index + 1}`, `drive-file-${index + 1}`], number: String(index + 1),
    cents: dollars(due ?? 0), otherCents: [dollars(earned ?? 0)], label: `Pay application ${index + 1}`,
  }))
  const listed = [...invoices, ...draws]

  it("hides every Buildertrend owner invoice copy, noting the two whose amounts differ", () => {
    const buildertrend: [string, number][] = [
      ["O-170-0001", 6178.75], ["O-170-0002", 1425], ["O-170-002", 18460.77], ["O-170-003", 133149.12],
      ["O-170-004", 109097.63], ["O-170-005", 99936.54], ["O-170-O-170-001", 1576.25],
    ]
    const matches = buildertrend.map(([number, amount]) => listedBillFor(workflow({ sourceRecordId: `bt-${number}`, sourceRecordNumber: number, amount }), listed))
    expect(matches.map((match) => match?.bill.label)).toEqual(buildertrend.map(([number]) => `Invoice ${number}`))
    const differing = matches.filter((match) => match && match.recordedCents !== match.bill.cents)
    expect(differing.map((match) => [match?.bill.label, match?.recordedCents])).toEqual([
      ["Invoice O-170-003", 13_314_912],
      ["Invoice O-170-005", 9_993_654],
    ])
  })

  it("a bare number still needs equal cents", () => {
    expect(listedBillFor(workflow({ sourceRecordId: "bt-3", sourceRecordNumber: "3", amount: 1 }), [invoice("3", 2)])).toBeNull()
  })

  it("hides the Drive PAYAPP copies: by amount due, or by total earned (PAYAPP-001 is draw 1)", () => {
    const drive = (number: string, amount: number) =>
      workflow({ sourceSystem: "google_drive_g702_g703", sourceRecordType: "owner_pay_application", sourceRecordId: `op-${number}`, sourceRecordNumber: number, amount })
    expect(listedBillFor(drive("O-170-2684-PAYAPP-001", 68782.88), listed)?.bill.label).toBe("Pay application 1")
    expect(listedBillFor(drive("O-170-2684-PAYAPP-002", 133149.11), listed)?.bill.label).toBe("Pay application 2")
    expect(listedBillFor(drive("O-170-2684-PAYAPP-003", 109097.63), listed)?.bill.label).toBe("Pay application 3")
    // Never matched to an invoice, even one with the same amount (O-170-004 is $109,097.63 too).
    expect(listedBillFor(drive("O-170-2684-PAYAPP-003", 109097.63), invoices)).toBeNull()
  })
})

describe("Loeffler (O-202-595)", () => {
  const due = [58064.24, 172958.05, 169104.24, 177307.15, 41847.62]
  const draws: Listed[] = due.map((amount, index) => ({
    kind: "draw", ids: [`draw-${index + 1}`], number: String(index + 1), cents: dollars(amount), label: `Pay application ${index + 1}`,
  }))

  it("staff: the Drive PAYAPP-001..005 copies are draws 1-5", () => {
    const labels = due.map((amount, index) =>
      listedBillFor(workflow({ sourceSystem: "google_drive_g702_g703", sourceRecordType: "owner_pay_application", sourceRecordId: `op-${index}`, sourceRecordNumber: `O-202-595-PAYAPP-00${index + 1}`, amount }), draws)?.bill.label
    )
    expect(labels).toEqual(draws.map((draw) => draw.label))
  })

  it("owner: no contract budget revisions in the pay application history", () => {
    const revision = (number: number, status: string) => ({
      id: `rev-${number}`, sourceSystem: "compass_contract_budget_projection", status, applicationNumber: `Contract Budget R${number}`, currentPaymentDue: 0,
    })
    const draw = (number: number) => ({
      id: `draw-${number}`, sourceSystem: "google_drive_g702_g703", status: "current", applicationNumber: String(number), currentPaymentDue: due[number - 1] ?? 0,
    })
    const rows = [revision(6, "budget_current"), ...[5, 4, 3, 2, 1].map((number) => revision(number, "budget_superseded")), ...[5, 4, 3, 2, 1].map(draw)]
    expect(ownerPayApplicationHistory(rows).map((row) => row.id)).toEqual(["draw-5", "draw-4", "draw-3", "draw-2", "draw-1"])
  })
})

