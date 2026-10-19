import { PDFDocument } from "pdf-lib"
import { describe, expect, it } from "vitest"

import { numberPdfPages } from "../page-numbers"

async function pdfWithPages(count: number): Promise<Uint8Array> {
  const document = await PDFDocument.create()
  for (let index = 0; index < count; index += 1) document.addPage([612, 792])
  return document.save()
}

describe("numberPdfPages", () => {
  it("leaves a one-page document as it was", async () => {
    const single = await pdfWithPages(1)
    expect(await numberPdfPages(single)).toEqual(single)
  })

  it("numbers every page of a longer document", async () => {
    const numbered = await numberPdfPages(await pdfWithPages(3))
    const document = await PDFDocument.load(numbered)
    expect(document.getPageCount()).toBe(3)
    expect(numbered.byteLength).toBeGreaterThan((await pdfWithPages(3)).byteLength)
  })
})
