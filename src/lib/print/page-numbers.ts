import { PDFDocument, StandardFonts, rgb } from "pdf-lib"

/** Above this, a PDF goes out as rendered rather than being read into memory. */
export const PAGE_NUMBER_MAX_BYTES = 30 * 1024 * 1024

/**
 * Adds "Page X of N" at the foot of every page, in the same place and style
 * as estimates. A one-page document is returned unchanged.
 */
export async function numberPdfPages(pdf: Uint8Array | ArrayBuffer): Promise<Uint8Array<ArrayBuffer>> {
  const document = await PDFDocument.load(pdf)
  const pages = document.getPages()
  if (pages.length < 2) {
    const original = new Uint8Array(new ArrayBuffer(pdf.byteLength))
    original.set(pdf instanceof Uint8Array ? pdf : new Uint8Array(pdf))
    return original
  }
  const font = await document.embedFont(StandardFonts.Helvetica)
  pages.forEach((page, index) => {
    const label = `Page ${index + 1} of ${pages.length}`
    const width = font.widthOfTextAtSize(label, 7)
    page.drawText(label, {
      x: Math.max(36, (page.getWidth() - width) / 2),
      y: 8,
      size: 7,
      font,
      color: rgb(0.35, 0.35, 0.35),
    })
  })
  const saved = await document.save()
  const bytes = new Uint8Array(new ArrayBuffer(saved.byteLength))
  bytes.set(saved)
  return bytes
}
