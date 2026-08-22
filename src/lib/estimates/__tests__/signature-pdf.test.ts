import { PDFDocument } from "pdf-lib"
import { describe, expect, it } from "vitest"

import { prepareEstimateSignaturePdf } from "@/lib/estimates/signature-pdf"

describe("estimate signature PDFs", () => {
  it("assigns a required Foxit initial field to every signer on every non-signature page", async () => {
    const document = await PDFDocument.create()
    document.addPage([612, 792])
    document.addPage([612, 792])
    document.addPage([612, 792])
    const saved = await document.save()
    const copy = new Uint8Array(saved.byteLength)
    copy.set(saved)

    const prepared = await prepareEstimateSignaturePdf({
      pdf: copy.buffer,
      signerLabels: ["Client 1", "Client 2", "Company"],
    })

    expect(prepared.pdfBase64.length).toBeGreaterThan(0)
    expect(prepared.fields).toHaveLength(6)
    expect(prepared.fields.map((field) => [field.pageNumber, field.party])).toEqual([
      [1, 1],
      [1, 2],
      [1, 3],
      [2, 1],
      [2, 2],
      [2, 3],
    ])
    expect(prepared.fields.every((field) => field.type === "initial")).toBe(true)
    expect(prepared.fields.every((field) => field.required)).toBe(true)
    expect(prepared.fields.some((field) => field.pageNumber === 3)).toBe(false)
  })
})
