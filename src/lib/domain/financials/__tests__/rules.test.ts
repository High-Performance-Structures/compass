import { describe, expect, it } from "vitest"

import {
  billTotals,
  creditMemoTotals,
  deriveBillTotals,
  deriveCreditMemoTotals,
  INVALID_LINE_ITEMS,
  lineAmount,
  lineItemsSubtotal,
  parseLineItems,
  parseLineNumber,
  serializeLineItems,
  type LineItem,
} from "../rules"

/** What the dialogs computed before the rules moved here. */
function legacyDialogTotals(lines: readonly LineItem[], tax: number, amountPaid: number) {
  const subtotal = lines.reduce((s, l) => s + l.amount, 0)
  const total = subtotal + tax
  return { subtotal, total, amountDue: total - amountPaid }
}

function editorLine(description: string, quantityText: string, rateText: string): LineItem {
  // The line editor's old math: parseFloat(raw) || 0, amount = quantity * rate.
  const quantity = parseFloat(quantityText) || 0
  const rate = parseFloat(rateText) || 0
  return { description, quantity, rate, amount: quantity * rate }
}

const LINES = [
  editorLine("Framing", "3", "0.1"),
  editorLine("Trim", "1.5", "19.99"),
  editorLine("Blank", "", "abc"),
  editorLine("Concrete", "12", "142.37"),
]

describe("financial line math", () => {
  it("matches the line editor's parsing and amounts", () => {
    expect(parseLineNumber("")).toBe(0)
    expect(parseLineNumber("abc")).toBe(0)
    expect(parseLineNumber("2.5")).toBe(2.5)
    expect(lineAmount(3, 0.1)).toBe(3 * 0.1)
  })

  it("previews the same subtotal, total and amount due as the dialogs did", () => {
    const legacy = legacyDialogTotals(LINES, 12.34, 50)
    expect(billTotals(lineItemsSubtotal(LINES), 12.34, 50)).toEqual(legacy)
    const memo = legacyDialogTotals(LINES, 0, 0).subtotal
    expect(creditMemoTotals(lineItemsSubtotal(LINES), 7)).toEqual({ total: memo, amountRemaining: memo - 7 })
  })

  it("round-trips editor lines through storage unchanged", () => {
    const text = JSON.stringify(LINES)
    expect(serializeLineItems(parseLineItems(text) ?? [])).toBe(text)
  })

  it("rejects line items that are not a list of lines", () => {
    expect(parseLineItems("{")).toBeNull()
    expect(parseLineItems("{}")).toBeNull()
    expect(parseLineItems("[1]")).toBeNull()
    expect(parseLineItems(null)).toEqual([])
  })
})

describe("server-derived totals", () => {
  it("ignores a client-sent total and recomputes from the lines", () => {
    const lineItems = JSON.stringify(LINES)
    const result = deriveBillTotals({ lineItems, tax: 10, amountPaid: 0, subtotal: 999, total: 999, amountDue: 999 }, null)
    const legacy = legacyDialogTotals(LINES, 10, 0)
    expect(result).toEqual({ ok: true, values: { ...legacy, lineItems } })
  })

  it("recomputes a line amount from quantity and rate", () => {
    const forged = JSON.stringify([{ description: "x", quantity: 2, rate: 5, amount: 1_000_000 }])
    const result = deriveBillTotals({ lineItems: forged, tax: 0 }, null)
    expect(result.ok && result.values?.total).toBe(10)
  })

  it("leaves stored totals alone when an update touches none of them", () => {
    const stored = { lineItems: "[]", subtotal: 5, tax: 1, amountPaid: 0 }
    expect(deriveBillTotals({}, stored)).toEqual({ ok: true, values: null })
    expect(deriveCreditMemoTotals({}, { lineItems: null, total: 5, amountApplied: 0 })).toEqual({ ok: true, values: null })
  })

  it("uses stored inputs for fields the update does not send", () => {
    const stored = { lineItems: JSON.stringify(LINES), subtotal: 0, tax: 2, amountPaid: 3 }
    const legacy = legacyDialogTotals(LINES, 2, 10)
    expect(deriveBillTotals({ amountPaid: 10 }, stored)).toEqual({ ok: true, values: legacy })
  })

  it("keeps the stored subtotal for a record without line items", () => {
    const stored = { lineItems: null, subtotal: 100, tax: 0, amountPaid: 0 }
    expect(deriveBillTotals({ tax: 8 }, stored)).toEqual({
      ok: true,
      values: { subtotal: 100, total: 108, amountDue: 108 },
    })
    expect(deriveBillTotals({}, null)).toEqual({ ok: true, values: { subtotal: 0, total: 0, amountDue: 0 } })
  })

  it("derives credit memo totals like the dialog", () => {
    const lineItems = JSON.stringify(LINES)
    const total = legacyDialogTotals(LINES, 0, 0).subtotal
    expect(deriveCreditMemoTotals({ lineItems, amountApplied: 4, total: 1 }, null)).toEqual({
      ok: true,
      values: { total, amountRemaining: total - 4, lineItems },
    })
  })

  it("refuses malformed line items", () => {
    expect(deriveBillTotals({ lineItems: "nope" }, null)).toEqual({ ok: false, error: INVALID_LINE_ITEMS })
    expect(deriveCreditMemoTotals({ lineItems: "{}" }, null)).toEqual({ ok: false, error: INVALID_LINE_ITEMS })
  })
})
