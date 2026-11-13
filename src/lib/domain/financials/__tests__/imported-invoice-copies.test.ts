import { describe, expect, it } from "vitest"

import { isListedImportedBillCopy, listedBillKeys, ownerPayApplicationsOnce } from "@/lib/domain/financials/rules"

/*
 * A job brought over from another system has bills twice: once as an
 * invoice or pay application (listed with received payments) and once as the
 * promoted cutover row in the financial workflow list, not always under the
 * same source system. Shapes from production; amounts and ids fictional.
 */

type WorkflowRow = Parameters<typeof isListedImportedBillCopy>[0]

const workflow = (overrides: Partial<WorkflowRow>): WorkflowRow => ({
  sourceSystem: "buildertrend",
  sourceRecordType: "owner_invoice",
  sourceRecordId: "bt-inv-1001",
  sourceRecordNumber: "INV-7",
  ...overrides,
})

describe("imported bills shown once", () => {
  it("hides the 'buildertrend_import' pay requests of a job whose Compass invoices carry the same numbers", () => {
    // H-329-9607: invoices (source compass) -01 and -02, and two workflow pay requests imported from Buildertrend.
    const listed = listedBillKeys([
      { ids: ["inv-a", null], numbers: ["H-329-9607-01"] },
      { ids: ["inv-b", null], numbers: ["H-329-9607-02"] },
    ])
    const payRequest = (number: string) =>
      workflow({ sourceSystem: "buildertrend_import", sourceRecordType: "owner_pay_application", sourceRecordId: `bt-${number}`, sourceRecordNumber: number })
    expect(isListedImportedBillCopy(payRequest("H-329-9607-01"), listed)).toBe(true)
    expect(isListedImportedBillCopy(payRequest("h-329-9607-02 "), listed)).toBe(true)
    expect(isListedImportedBillCopy(payRequest("H-329-9607-03"), listed)).toBe(false)
  })

  it("matches an imported invoice by source id or number, whatever system each came from", () => {
    const listed = listedBillKeys([{ ids: ["inv-1", "bt-inv-1001"], numbers: ["INV-7"] }])
    expect(isListedImportedBillCopy(workflow({}), listed)).toBe(true)
    expect(isListedImportedBillCopy(workflow({ sourceRecordId: "staging-9" }), listed)).toBe(true)
    expect(isListedImportedBillCopy(workflow({ sourceSystem: "sage", sourceRecordId: null }), listed)).toBe(true)
    // A Drive draw's workflow row matches its listed pay application by id.
    const draws = listedBillKeys([{ ids: ["app-4", "drive-file-4"], numbers: ["4"] }])
    expect(isListedImportedBillCopy(workflow({ sourceSystem: "google_drive_g702_g703", sourceRecordType: "owner_pay_application", sourceRecordId: "app-4", sourceRecordNumber: null }), draws)).toBe(true)
  })

  it("keeps bills not listed elsewhere, Compass's own workflow items, and payments", () => {
    const listed = listedBillKeys([{ ids: ["app-1"], numbers: ["INV-7", "1"] }])
    // Nothing listed for this one (e.g. LaCasse's Buildertrend pay requests with no invoice).
    expect(isListedImportedBillCopy(workflow({ sourceRecordId: "bt-2", sourceRecordNumber: "INV-9" }), listed)).toBe(false)
    expect(isListedImportedBillCopy(workflow({ sourceSystem: "compass", sourceRecordType: "owner_pay_application", sourceRecordId: "app-1", sourceRecordNumber: "1" }), listed)).toBe(false)
    for (const sourceRecordType of ["payment", "deposit", "credit_memo"]) {
      expect(isListedImportedBillCopy(workflow({ sourceRecordType }), listed)).toBe(false)
    }
  })

  it("owners see each pay application once, keeping the live record", () => {
    const rows = [
      { id: "drive-9", sourceSystem: "google_drive_g702_g703", applicationNumber: "9" },
      { id: "compass-9", sourceSystem: "compass_contract_budget", applicationNumber: " 9" },
      { id: "sage-8", sourceSystem: "sage_pay_request", applicationNumber: "8" },
      { id: "drive-8", sourceSystem: "google_drive_g702_g703", applicationNumber: "8" },
      { id: "drive-7", sourceSystem: "google_drive_g702_g703", applicationNumber: "7" },
    ]
    expect(ownerPayApplicationsOnce(rows).map((row) => row.id)).toEqual(["compass-9", "sage-8", "drive-7"])
  })
})
