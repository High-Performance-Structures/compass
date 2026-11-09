import { describe, expect, it } from "vitest"

import { choiceLineRefs, choicePricesFromResponse, choiceRfqScopeLine, mergeChoiceLineRefs } from "@/lib/selections/choice-rfq"
import { ownerBoardTotals } from "@/lib/selections/owner-board"
import { parseSelectionListFilter, selectionMatchesFilter, selectionSheetRows, type SelectionSheetInput } from "@/lib/selections/sheet"

const base = { category: "Finish", costCode: null, sourceSystem: "compass", sortOrder: 0, legacyParentId: null, allowanceCents: null, dueDate: null, published: false } as const

describe("selectionSheetRows", () => {
  const input: SelectionSheetInput = {
    selections: [
      { ...base, id: "top", roomName: "Bath", name: "Top", status: "needed", legacyParentId: "vanity" },
      { ...base, id: "vanity", roomName: "Bath", name: "Vanity", status: "owner_review", allowanceCents: 100000 },
      { ...base, id: "hw", roomName: "Bath", name: "Hardware", status: "needed" },
      { ...base, id: "sink", roomName: "Kitchen", name: "Sink", status: "installed" },
    ],
    choices: [
      { selectionId: "vanity", title: "Oak", chosen: true, priceCents: 80000, ownerPriceCents: 112500 },
      { selectionId: "vanity", title: "Walnut", chosen: false, priceCents: null, ownerPriceCents: null },
    ],
    dependents: [{ selectionId: "hw", parentId: "vanity" }],
  }

  it("indents follow-ups (choice links and older sheet links) right under the parent", () => {
    const rows = selectionSheetRows(input)
    expect([...rows].sort((a, b) => a.orderKey.localeCompare(b.orderKey)).map((row) => [row.id, row.parentId])).toEqual([
      ["vanity", null],
      ["top", "vanity"],
      ["hw", "vanity"],
      ["sink", null],
    ])
    expect(rows.find((row) => row.id === "vanity")).toMatchObject({ followUpCount: 2, choiceCount: 2, pickTitle: "Oak", deltaCents: 12500 })
  })

  it("filters by status group, Open leaving out installed", () => {
    const rows = selectionSheetRows(input)
    expect(rows.filter((row) => selectionMatchesFilter(row, "open")).map((row) => row.id)).toEqual(["top", "vanity", "hw"])
    expect(rows.filter((row) => selectionMatchesFilter(row, "with_owner")).map((row) => row.id)).toEqual(["vanity"])
    expect(parseSelectionListFilter("bogus")).toBe("open")
    expect(parseSelectionListFilter("installed")).toBe("installed")
  })
})

describe("choice RFQ lines", () => {
  it("builds one scope line per choice, keeping a non-catalog cost code in the notes", () => {
    const line = choiceRfqScopeLine(
      { id: "s1", roomName: "Bath", name: "Vanity", quantity: 2, costCode: null, phaseCode: null, freeTextCostCode: "06-400" },
      { id: "c1", title: "Oak", description: "36 inch", supplierName: null, vendorName: "Mill", productUrl: "https://mill.example.com/oak" },
    )
    expect(line).toEqual({
      selectionId: "s1",
      choiceId: "c1",
      description: "Bath: Vanity - Oak",
      costCode: null,
      phaseCode: null,
      notes: "36 inch | Quantity: 2 | Supplier: Mill | Product: https://mill.example.com/oak | Cost code: 06-400",
    })
  })

  it("maps line numbers to choices and returned prices to cents", () => {
    const refs = choiceLineRefs([{ selectionId: "s1", choiceId: "a" }, { selectionId: "s2", choiceId: "x" }, { selectionId: "s1", choiceId: "b" }], "s1", 4)
    expect(refs).toEqual([{ choiceId: "a", lineNumber: 4 }, { choiceId: "b", lineNumber: 6 }])
    expect(mergeChoiceLineRefs([{ choiceId: "old", lineNumber: 4 }, { choiceId: "keep", lineNumber: 1 }], refs)).toEqual([
      { choiceId: "keep", lineNumber: 1 },
      { choiceId: "a", lineNumber: 4 },
      { choiceId: "b", lineNumber: 6 },
    ])
    const response = {
      decision: "quote" as const, amount: 30, leadTime: null, validUntil: null, notes: null,
      responderUserId: "x", responderName: "x", responderCompany: null, submittedAt: "t",
      lines: [{ lineNumber: 4, amount: 12.345, notes: null }],
    }
    expect(choicePricesFromResponse(refs, response)).toEqual([{ choiceId: "a", priceCents: 1235 }])
    expect(choicePricesFromResponse(refs, { ...response, decision: "decline" })).toEqual([])
    expect(choicePricesFromResponse(refs, null)).toEqual([])
  })
})

describe("ownerBoardTotals", () => {
  it("compares only priced picks with their allowance", () => {
    const totals = ownerBoardTotals([
      { allowanceCents: 320000, panel: { choices: [{ chosen: true, ownerPriceCents: 418500 }] } },
      { allowanceCents: 100000, panel: { choices: [{ chosen: true, ownerPriceCents: null }] } },
      { allowanceCents: 50000, panel: { choices: [{ chosen: false, ownerPriceCents: 40000 }] } },
    ])
    expect(totals).toEqual({ total: 3, chosen: 2, allowanceCents: 320000, pickedCents: 418500, deltaCents: 98500 })
    expect(ownerBoardTotals([]).pickedCents).toBeNull()
  })
})
