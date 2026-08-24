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
      corporateSignerIndex: 2,
    })

    expect(prepared.pdfBase64.length).toBeGreaterThan(0)
    expect(prepared.fields).toHaveLength(12)
    expect(
      prepared.fields
        .filter((field) => field.type === "initial")
        .map((field) => [field.pageNumber, field.party])
    ).toEqual([
      [1, 1],
      [1, 2],
      [1, 3],
      [2, 1],
      [2, 2],
      [2, 3],
    ])
    expect(prepared.fields.every((field) => field.required)).toBe(true)
    expect(
      prepared.fields.filter((field) => field.type === "signature")
    ).toHaveLength(3)
    expect(
      prepared.fields.filter((field) => field.type === "date")
    ).toHaveLength(3)
    expect(
      prepared.fields
        .filter((field) => field.pageNumber === 3)
        .map((field) => [field.type, field.party])
    ).toEqual([
      ["signature", 1],
      ["date", 1],
      ["signature", 2],
      ["date", 2],
      ["signature", 3],
      ["date", 3],
    ])
    expect(
      prepared.fields
        .filter((field) => field.type === "date")
        .every(
          (field) =>
            field.readOnly &&
            field.systemField &&
            field.dateFormat === "MM-DD-YYYY"
        )
    ).toBe(true)
    const clientSignature = prepared.fields.find(
      (field) => field.type === "signature" && field.party === 1
    )
    const companySignature = prepared.fields.find(
      (field) => field.type === "signature" && field.party === 3
    )
    const companyDate = prepared.fields.find(
      (field) => field.type === "date" && field.party === 3
    )
    expect(clientSignature).toMatchObject({ x: 40, width: 251 })
    expect(companySignature).toMatchObject({ x: 58, width: 233, y: 236, height: 27 })
    expect(companyDate).toMatchObject({ x: 40, width: 251, y: 304 })
  })
})
