import { describe, expect, it } from "vitest"

import {
  cleanDependentSelectionIds,
  commentVisibilityFor,
  commentVisibleTo,
  parseCommentBody,
  parseSelectionChoiceInput,
  validChoiceOrder,
} from "@/lib/domain/selections/choice-rules"

describe("parseSelectionChoiceInput", () => {
  it("reads price as cents and lead time as whole days", () => {
    const parsed = parseSelectionChoiceInput({ title: " Subway 3x12 ", price: "$3,200.50", leadTimeDays: "21", supplierName: "Tile Co" })
    expect(parsed).toEqual({
      ok: true,
      value: {
        title: "Subway 3x12",
        description: null,
        priceCents: 320050,
        leadTimeDays: 21,
        vendorId: null,
        supplierName: "Tile Co",
        status: "proposed",
      },
    })
  })

  it("keeps the vendor record and drops the free-text supplier when both are given", () => {
    const parsed = parseSelectionChoiceInput({ title: "Hex", vendorId: "v1", supplierName: "Typed name" })
    expect(parsed.ok && parsed.value.vendorId).toBe("v1")
    expect(parsed.ok && parsed.value.supplierName).toBeNull()
  })

  it("rejects a blank title, bad price, bad lead time and unknown status", () => {
    expect(parseSelectionChoiceInput({ title: "  " }).ok).toBe(false)
    expect(parseSelectionChoiceInput({ title: "A", price: "abc" }).ok).toBe(false)
    expect(parseSelectionChoiceInput({ title: "A", price: "-5" }).ok).toBe(false)
    expect(parseSelectionChoiceInput({ title: "A", leadTimeDays: "2.5" }).ok).toBe(false)
    expect(parseSelectionChoiceInput({ title: "A", leadTimeDays: "9999" }).ok).toBe(false)
    expect(parseSelectionChoiceInput({ title: "A", status: "chosen" }).ok).toBe(false)
  })
})

describe("comments", () => {
  it("owners always write owner-visible comments; staff choose", () => {
    expect(commentVisibilityFor("owner", "staff")).toBe("owner")
    expect(commentVisibilityFor("staff", "staff")).toBe("staff")
    expect(commentVisibilityFor("staff", "owner")).toBe("owner")
    expect(commentVisibilityFor("staff", "everyone")).toBeNull()
  })

  it("owners never see staff-only comments", () => {
    expect(commentVisibleTo("owner", "staff")).toBe(false)
    expect(commentVisibleTo("owner", "owner")).toBe(true)
    expect(commentVisibleTo("staff", "staff")).toBe(true)
  })

  it("requires a body", () => {
    expect(parseCommentBody("  ").ok).toBe(false)
    expect(parseCommentBody(" Looks good ")).toEqual({ ok: true, value: "Looks good" })
  })
})

describe("choice order and dependents", () => {
  it("accepts only a full reorder of the selection's own choices", () => {
    expect(validChoiceOrder(["a", "b", "c"], ["c", "a", "b"])).toBe(true)
    expect(validChoiceOrder(["a", "b", "c"], ["a", "b"])).toBe(false)
    expect(validChoiceOrder(["a", "b"], ["a", "a"])).toBe(false)
    expect(validChoiceOrder(["a", "b"], ["a", "x"])).toBe(false)
  })

  it("never lets a choice open its own selection", () => {
    expect(cleanDependentSelectionIds("s1", ["s2", "s1", "s2", " ", "s3"])).toEqual(["s2", "s3"])
  })
})
