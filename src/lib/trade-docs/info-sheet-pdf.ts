import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib"

import type { InfoSheetAnswer } from "@/lib/trade-docs/vendor-link"

const PAGE = { width: 612, height: 792, margin: 54 } as const

/** The standard PDF fonts only cover Latin-1; swap the usual typographic characters and drop the rest. */
export function pdfSafeText(value: string): string {
  return value
    .replace(/[‘’′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/…/g, "...")
    .replace(/[\t ]/g, " ")
    .replace(/[^\n\x20-\x7E\xA1-\xFF]/g, "")
}

export function wrapPdfText(text: string, font: PDFFont, size: number, width: number): readonly string[] {
  const lines: string[] = []
  for (const paragraph of pdfSafeText(text).split(/\r?\n/)) {
    let line = ""
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(next, size) <= width) {
        line = next
        continue
      }
      if (line) lines.push(line)
      // A single word longer than the line is cut to fit.
      let rest = word
      while (font.widthOfTextAtSize(rest, size) > width && rest.length > 1) {
        let cut = rest.length - 1
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut -= 1
        lines.push(rest.slice(0, cut))
        rest = rest.slice(cut)
      }
      line = rest
    }
    lines.push(line)
  }
  return lines
}

/**
 * The vendor's online info sheet as a signed PDF for their Drive folder.
 * The answers live only in this file; Compass keeps the record that it was
 * received, not the answers.
 */
export async function buildInfoSheetPdf(input: {
  readonly title: string
  readonly companyName: string
  readonly companyContactLines: readonly string[]
  readonly vendorName: string
  readonly answers: readonly InfoSheetAnswer[]
  readonly certification: string
  readonly signerName: string
  readonly signerTitle: string
  readonly signedAt: Date
  readonly linkRecipient: string
}): Promise<Uint8Array<ArrayBuffer>> {
  const document = await PDFDocument.create()
  document.setTitle(pdfSafeText(`${input.vendorName} - ${input.title}`))
  document.setProducer("Compass")
  const regular = await document.embedFont(StandardFonts.Helvetica)
  const bold = await document.embedFont(StandardFonts.HelveticaBold)
  const ink = rgb(0.1, 0.1, 0.1)
  const muted = rgb(0.4, 0.4, 0.4)
  const width = PAGE.width - PAGE.margin * 2
  const labelWidth = 190

  let page: PDFPage = document.addPage([PAGE.width, PAGE.height])
  let y = PAGE.height - PAGE.margin

  function ensure(space: number): void {
    if (y - space >= PAGE.margin) return
    page = document.addPage([PAGE.width, PAGE.height])
    y = PAGE.height - PAGE.margin
  }

  function text(value: string, options: { readonly x?: number; readonly size?: number; readonly font?: PDFFont; readonly color?: typeof ink; readonly maxWidth?: number }): number {
    const size = options.size ?? 10
    const font = options.font ?? regular
    const lines = wrapPdfText(value, font, size, options.maxWidth ?? width)
    for (const line of lines) {
      ensure(size + 4)
      page.drawText(line, { x: options.x ?? PAGE.margin, y: y - size, size, font, color: options.color ?? ink })
      y -= size + 4
    }
    return lines.length
  }

  text(input.companyName, { size: 14, font: bold })
  for (const line of input.companyContactLines) text(line, { size: 9, color: muted })
  y -= 14
  text(input.title, { size: 16, font: bold })
  text(input.vendorName, { size: 11 })
  y -= 10
  page.drawLine({ start: { x: PAGE.margin, y }, end: { x: PAGE.margin + width, y }, thickness: 0.5, color: muted })
  y -= 12

  for (const answer of input.answers) {
    const labelLines = wrapPdfText(answer.field.label, bold, 10, labelWidth - 12)
    const valueLines = wrapPdfText(answer.value || "-", regular, 10, width - labelWidth)
    const rows = Math.max(labelLines.length, valueLines.length)
    ensure(rows * 14 + 6)
    for (let row = 0; row < rows; row += 1) {
      const label = labelLines[row]
      const value = valueLines[row]
      if (label) page.drawText(label, { x: PAGE.margin, y: y - 10, size: 10, font: bold, color: ink })
      if (value) page.drawText(value, { x: PAGE.margin + labelWidth, y: y - 10, size: 10, font: regular, color: ink })
      y -= 14
    }
    y -= 6
  }

  y -= 10
  ensure(90)
  text(input.certification, { size: 10 })
  y -= 8
  const date = input.signedAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })
  text(`Signed: ${input.signerName}`, { size: 11, font: bold })
  if (input.signerTitle) text(`Title: ${input.signerTitle}`, { size: 10 })
  text(`Date: ${date}`, { size: 10 })
  y -= 6
  text(
    `Signed electronically by typing their name on the secure documents link sent to ${input.linkRecipient}, ${input.signedAt.toISOString()}.`,
    { size: 8, color: muted },
  )
  // A copy backed by a plain ArrayBuffer, which Blob accepts.
  return new Uint8Array(await document.save())
}
