import { describe, expect, it } from "vitest"

import { buildRoundDocument, overageTreatment, type RoundDocumentLineInput } from "@/lib/selections/round-document"

function line(overrides: Partial<RoundDocumentLineInput>): RoundDocumentLineInput {
  return {
    selectionId: "s",
    roomName: "Kitchen",
    selectionName: "Tile",
    choiceId: "c",
    choiceTitle: "Hex",
    choiceDescription: null,
    photoId: null,
    linkUrl: null,
    linkSite: null,
    ownerPriceCents: 100000,
    allowanceCents: 100000,
    costCode: null,
    pickedBy: null,
    signedEarlier: false,
    ...overrides,
  }
}

describe("overageTreatment", () => {
  it("uses a change order on fixed price, a variance on cost plus up to the threshold", () => {
    expect(overageTreatment(0, 100000, "cost_plus", 10)).toBe("none")
    expect(overageTreatment(5000, 100000, "fixed_price", 10)).toBe("change_order")
    expect(overageTreatment(5000, 100000, "cost_plus", 10)).toBe("variance")
    expect(overageTreatment(10000, 100000, "cost_plus", 10)).toBe("variance")
    expect(overageTreatment(10001, 100000, "cost_plus", 10)).toBe("change_order")
    // Credits follow the same rule.
    expect(overageTreatment(-20000, 100000, "cost_plus", 10)).toBe("change_order")
    expect(overageTreatment(-2000, 100000, "cost_plus", 10)).toBe("variance")
    expect(overageTreatment(2000, 0, "cost_plus", 10)).toBe("change_order")
  })
})

describe("buildRoundDocument", () => {
  it("totals the picks being signed and picks the treatment", () => {
    const doc = buildRoundDocument(
      [
        line({ selectionId: "a", ownerPriceCents: 418500, allowanceCents: 320000 }),
        line({ selectionId: "b", ownerPriceCents: 168000, allowanceCents: 180000 }),
        line({ selectionId: "c", ownerPriceCents: 50000, allowanceCents: null }),
        line({ selectionId: "d", signedEarlier: true, ownerPriceCents: 999999 }),
      ],
      "cost_plus",
      10,
    )
    expect(doc.toSign.map((item) => item.selectionId)).toEqual(["a", "b", "c"])
    expect(doc).toMatchObject({ allowanceCents: 500000, ownerTotalCents: 636500, deltaCents: 136500, treatment: "change_order", blocker: null })
    expect(doc.lines[2]?.deltaCents).toBe(50000)
  })

  it("can't be signed until every selection has a priced pick", () => {
    expect(buildRoundDocument([line({ choiceId: null, choiceTitle: null, selectionName: "Faucet" })], "cost_plus", 10).blocker).toBe("Faucet doesn't have the owner's pick yet.")
    expect(buildRoundDocument([line({ ownerPriceCents: null })], "cost_plus", 10).blocker).toBe("Tile: set the owner price for the picked choice.")
    expect(buildRoundDocument([line({ signedEarlier: true })], "cost_plus", 10).blocker).toBe("Every pick in this round is already signed for.")
    expect(buildRoundDocument([], "cost_plus", 10).blocker).toBe("This round has no selections.")
  })
})
