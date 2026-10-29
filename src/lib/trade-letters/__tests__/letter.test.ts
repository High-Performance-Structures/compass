import { describe, expect, it } from "vitest"

import { PDFDocument } from "pdf-lib"

import { buildTradeLetterPdf } from "@/lib/trade-letters/letter-pdf"
import {
  fillLetterText,
  joinWithAnd,
  nextTradeLetterSequence,
  parseScope,
  tradeLetterAvailability,
  tradeLetterNumber,
  tradeLetterRoute,
} from "@/lib/trade-letters/letter"

describe("trade letters", () => {
  it("unlocks the award letter only after the owner signs", () => {
    expect(tradeLetterAvailability("award", false).allowed).toBe(false)
    expect(tradeLetterAvailability("intent", false).allowed).toBe(true)
    expect(tradeLetterAvailability("award", true).allowed).toBe(true)
    expect(tradeLetterAvailability("intent", true).allowed).toBe(false)
  })

  it("routes subs to letters, material-only to purchase orders and owner scope to nothing", () => {
    expect(tradeLetterRoute({ ownerScope: false, sageCostTypes: ["subcontract"] })).toBe("letter")
    expect(tradeLetterRoute({ ownerScope: false, sageCostTypes: ["material"] })).toBe("purchase_order")
    expect(tradeLetterRoute({ ownerScope: false, sageCostTypes: ["material", "subcontract"] })).toBe("letter")
    expect(tradeLetterRoute({ ownerScope: true, sageCostTypes: ["subcontract"] })).toBe("none")
    expect(tradeLetterRoute({ ownerScope: false, sageCostTypes: [] })).toBe("letter")
  })

  it("fills known tokens and leaves the rest", () => {
    expect(fillLetterText("{company} awards {vendor} {unknown}", { company: "Acme", vendor: "Best Drywall" })).toBe("Acme awards Best Drywall {unknown}")
    expect(joinWithAnd(["W-9"])).toBe("W-9")
    expect(joinWithAnd(["W-9", "GL", "WC"])).toBe("W-9, GL and WC")
  })

  it("numbers letters per kind", () => {
    expect(tradeLetterNumber("award", 7)).toBe("AW-0007")
    expect(tradeLetterNumber("intent", 1)).toBe("LOI-0001")
    expect(nextTradeLetterSequence("award", ["AW-0002", "LOI-0009", "AW-0011"])).toBe(12)
    expect(nextTradeLetterSequence("intent", [])).toBe(1)
  })

  it("reads stored scope defensively", () => {
    expect(parseScope('[{"costCode":"09-250","description":"Drywall","amountCents":100}, {"bad":1}]')).toEqual([
      { costCode: "09-250", description: "Drywall", amountCents: 100 },
    ])
    expect(parseScope("not json")).toEqual([])
  })

  it("places both signers' signature and date fields on the letter, before an enclosed agreement", async () => {
    const agreement = await PDFDocument.create()
    agreement.addPage([612, 792])
    agreement.addPage([612, 792])
    const agreementBytes = await agreement.save()
    const copy = new Uint8Array(agreementBytes.byteLength)
    copy.set(agreementBytes)
    const prepared = await buildTradeLetterPdf({
      kind: "award",
      letterNumber: "AW-0001",
      dateLabel: "October 29, 2026",
      brand: { companyName: "Summit Ridge Builders", contactLines: ["PO Box 1", "555-0100"], logoBytes: null },
      vendorName: "Best Drywall, LLC",
      signerName: "Dana Ruiz",
      heading: "Award of work: Test job",
      paragraphs: ["Summit Ridge Builders accepts your quote."],
      scope: [{ costCode: "09-250", description: "Drywall", amountCents: 1_840_000 }],
      totalCents: 1_840_000,
      owedParagraph: "Documents still needed: W-9.",
      closing: "Thanks.",
      note: null,
      companySigner: { name: "Pat Office", title: "President" },
      agreementPdf: copy.buffer,
    })
    const loaded = await PDFDocument.load(prepared.pdfBytes)
    expect(loaded.getPageCount()).toBe(3)
    expect(prepared.fields.map((field) => `${field.type}:${field.party}`)).toEqual(["signature:1", "date:1", "signature:2", "date:2"])
    for (const field of prepared.fields) {
      expect(field.pageNumber).toBe(1)
      expect(field.y).toBeGreaterThan(0)
      expect(field.y + field.height).toBeLessThan(792)
    }
  })
})
