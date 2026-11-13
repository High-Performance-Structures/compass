import { describe, expect, it } from "vitest"

import { isListedImportedInvoiceCopy, listedImportedInvoiceKeys } from "@/lib/domain/financials/rules"

/*
 * A job brought over from Buildertrend has each owner invoice twice: as an
 * invoices row (listed with received payments) and as the promoted cutover
 * row in the financial workflow list. Fictional numbers only.
 */

const invoice = (overrides: Partial<Parameters<typeof listedImportedInvoiceKeys>[0][number]> = {}) => ({
  sourceSystem: "buildertrend",
  sourceExternalId: "bt-inv-1001",
  invoiceNumber: "INV-7",
  status: "paid",
  invoiceKind: null,
  ...overrides,
})

const workflowCopy = (overrides: Partial<Parameters<typeof isListedImportedInvoiceCopy>[0]> = {}) => ({
  sourceSystem: "buildertrend",
  sourceRecordType: "owner_invoice",
  sourceRecordId: "bt-inv-1001",
  sourceRecordNumber: "INV-7",
  ...overrides,
})

describe("imported invoices shown once", () => {
  it("leaves out the workflow copy of a listed Buildertrend invoice, by source id or number", () => {
    const listed = listedImportedInvoiceKeys([invoice()])
    expect(isListedImportedInvoiceCopy(workflowCopy(), listed)).toBe(true)
    expect(isListedImportedInvoiceCopy(workflowCopy({ sourceRecordId: "staging-row-9" }), listed)).toBe(true)
    expect(isListedImportedInvoiceCopy(workflowCopy({ sourceRecordId: null, sourceRecordNumber: " inv-7 " }), listed)).toBe(true)
  })

  it("keeps a workflow invoice whose invoice isn't listed elsewhere", () => {
    // Draft and void invoices, and credit memos, are not listed with received payments.
    for (const hidden of [invoice({ status: "draft" }), invoice({ status: "void" }), invoice({ invoiceKind: "credit_memo" })]) {
      expect(isListedImportedInvoiceCopy(workflowCopy(), listedImportedInvoiceKeys([hidden]))).toBe(false)
    }
    // Another invoice, another source system, or a Compass invoice with the same number.
    const listed = listedImportedInvoiceKeys([invoice({ sourceExternalId: "bt-inv-2002", invoiceNumber: "INV-8" }), invoice({ sourceSystem: "compass" })])
    expect(isListedImportedInvoiceCopy(workflowCopy(), listed)).toBe(false)
    expect(isListedImportedInvoiceCopy(workflowCopy({ sourceSystem: "sage" }), listedImportedInvoiceKeys([invoice()]))).toBe(false)
  })

  it("never hides payments, deposits or pay applications", () => {
    const listed = listedImportedInvoiceKeys([invoice()])
    for (const sourceRecordType of ["payment", "deposit", "credit_memo", "owner_pay_application"]) {
      expect(isListedImportedInvoiceCopy(workflowCopy({ sourceRecordType }), listed)).toBe(false)
    }
  })
})
