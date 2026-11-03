import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib"

import type { FoxitEnvelopeField } from "@/lib/foxit/esign"
import { pdfSafeText, wrapPdfText } from "@/lib/trade-docs/info-sheet-pdf"
import type { TradeLetterKind, TradeLetterScopeItem } from "@/lib/trade-letters/letter"
import { formatCents as money } from "@/lib/format"

const PAGE = { width: 612, height: 792, margin: 54 } as const
const SIGNATURE_BLOCK_HEIGHT = 120

export type TradeLetterPdfInput = {
  readonly kind: TradeLetterKind
  readonly letterNumber: string
  readonly dateLabel: string
  readonly brand: { readonly companyName: string; readonly contactLines: readonly string[]; readonly logoBytes: Uint8Array | null }
  readonly vendorName: string
  readonly signerName: string
  readonly heading: string
  /** Already filled from the Settings texts. */
  readonly paragraphs: readonly string[]
  readonly scope: readonly TradeLetterScopeItem[]
  readonly totalCents: number
  /** Shown in a shaded box when documents are still owed. */
  readonly owedParagraph: string | null
  readonly closing: string | null
  readonly note: string | null
  readonly companySigner: { readonly name: string; readonly title: string | null }
  /** The master agreement, appended after the letter and signed with it. */
  readonly agreementPdf: ArrayBuffer | null
}

export type PreparedTradeLetterPdf = {
  readonly pdfBytes: Uint8Array<ArrayBuffer>
  /** Signature and date fields: party 1 is the trade, party 2 the company. */
  readonly fields: readonly FoxitEnvelopeField[]
}

async function embedLogo(document: PDFDocument, bytes: Uint8Array | null): Promise<PDFImage | null> {
  if (!bytes || bytes.length === 0) return null
  try {
    return await document.embedPng(bytes)
  } catch {
    try {
      return await document.embedJpg(bytes)
    } catch {
      return null
    }
  }
}

/**
 * The letter as a PDF with the trade's and the company's signature and date
 * fields placed for Foxit. With an agreement, its pages follow the letter and
 * the letter says that signing it signs the agreement too.
 */
export async function buildTradeLetterPdf(input: TradeLetterPdfInput): Promise<PreparedTradeLetterPdf> {
  const document = await PDFDocument.create()
  document.setTitle(pdfSafeText(`${input.letterNumber} ${input.vendorName}`))
  document.setProducer("Compass")
  const regular = await document.embedFont(StandardFonts.Helvetica)
  const bold = await document.embedFont(StandardFonts.HelveticaBold)
  const ink = rgb(0.1, 0.1, 0.1)
  const muted = rgb(0.4, 0.4, 0.4)
  const width = PAGE.width - PAGE.margin * 2
  const logo = await embedLogo(document, input.brand.logoBytes)

  let page: PDFPage = document.addPage([PAGE.width, PAGE.height])
  let y = PAGE.height - PAGE.margin

  function ensure(space: number): void {
    if (y - space >= PAGE.margin) return
    page = document.addPage([PAGE.width, PAGE.height])
    y = PAGE.height - PAGE.margin
  }

  function text(value: string, options: { readonly x?: number; readonly size?: number; readonly font?: PDFFont; readonly color?: typeof ink; readonly maxWidth?: number; readonly gap?: number } = {}): void {
    const size = options.size ?? 10.5
    const font = options.font ?? regular
    for (const line of wrapPdfText(value, font, size, options.maxWidth ?? width)) {
      ensure(size + 5)
      page.drawText(line, { x: options.x ?? PAGE.margin, y: y - size, size, font, color: options.color ?? ink })
      y -= size + (options.gap ?? 5)
    }
  }

  // Letterhead: logo and company on the left, date and number on the right.
  const headTop = y
  let left = PAGE.margin
  if (logo) {
    const scale = Math.min(44 / logo.height, 120 / logo.width)
    page.drawImage(logo, { x: PAGE.margin, y: headTop - logo.height * scale, width: logo.width * scale, height: logo.height * scale })
    left = PAGE.margin + logo.width * scale + 12
  }
  page.drawText(pdfSafeText(input.brand.companyName), { x: left, y: headTop - 13, size: 13, font: bold, color: ink })
  input.brand.contactLines.slice(0, 3).forEach((line, index) => {
    page.drawText(pdfSafeText(line), { x: left, y: headTop - 27 - index * 11, size: 8.5, font: regular, color: muted })
  })
  const right = [pdfSafeText(input.dateLabel), pdfSafeText(input.letterNumber)]
  right.forEach((line, index) => {
    const lineWidth = regular.widthOfTextAtSize(line, 9)
    page.drawText(line, { x: PAGE.width - PAGE.margin - lineWidth, y: headTop - 13 - index * 12, size: 9, font: regular, color: muted })
  })
  y = headTop - Math.max(56, 30 + input.brand.contactLines.slice(0, 3).length * 11)
  page.drawLine({ start: { x: PAGE.margin, y }, end: { x: PAGE.width - PAGE.margin, y }, thickness: 1.2, color: ink })
  y -= 22

  text(input.vendorName, { gap: 3 })
  text(`Attn: ${input.signerName}`)
  y -= 10
  text(input.heading, { size: 14, font: bold })
  y -= 4
  for (const paragraph of input.paragraphs) {
    text(paragraph)
    y -= 6
  }

  // Scope table.
  const codeWidth = 70
  const amountWidth = 90
  const descriptionWidth = width - codeWidth - amountWidth - 12
  ensure(40)
  page.drawText("Cost code", { x: PAGE.margin, y: y - 10, size: 9, font: bold, color: ink })
  page.drawText("Scope", { x: PAGE.margin + codeWidth, y: y - 10, size: 9, font: bold, color: ink })
  const amountHeading = "Amount"
  page.drawText(amountHeading, { x: PAGE.width - PAGE.margin - bold.widthOfTextAtSize(amountHeading, 9), y: y - 10, size: 9, font: bold, color: ink })
  y -= 15
  page.drawLine({ start: { x: PAGE.margin, y }, end: { x: PAGE.width - PAGE.margin, y }, thickness: 0.5, color: muted })
  y -= 4
  for (const item of input.scope) {
    const lines = wrapPdfText(item.description || "-", regular, 9.5, descriptionWidth)
    ensure(lines.length * 13 + 6)
    page.drawText(pdfSafeText(item.costCode ?? ""), { x: PAGE.margin, y: y - 10, size: 9.5, font: regular, color: ink })
    lines.forEach((line, index) => {
      page.drawText(line, { x: PAGE.margin + codeWidth, y: y - 10 - index * 13, size: 9.5, font: regular, color: ink })
    })
    const amount = money(item.amountCents)
    page.drawText(amount, { x: PAGE.width - PAGE.margin - regular.widthOfTextAtSize(amount, 9.5), y: y - 10, size: 9.5, font: regular, color: ink })
    y -= lines.length * 13 + 4
    page.drawLine({ start: { x: PAGE.margin, y }, end: { x: PAGE.width - PAGE.margin, y }, thickness: 0.3, color: rgb(0.8, 0.8, 0.8) })
    y -= 2
  }
  ensure(20)
  const total = money(input.totalCents)
  page.drawText("Total", { x: PAGE.margin + codeWidth, y: y - 11, size: 10, font: bold, color: ink })
  page.drawText(total, { x: PAGE.width - PAGE.margin - bold.widthOfTextAtSize(total, 10), y: y - 11, size: 10, font: bold, color: ink })
  y -= 26

  if (input.owedParagraph) {
    const lines = wrapPdfText(input.owedParagraph, regular, 10, width - 20)
    const boxHeight = lines.length * 14 + 14
    ensure(boxHeight + 8)
    page.drawRectangle({ x: PAGE.margin, y: y - boxHeight, width, height: boxHeight, color: rgb(0.99, 0.95, 0.95) })
    lines.forEach((line, index) => {
      page.drawText(line, { x: PAGE.margin + 10, y: y - 17 - index * 14, size: 10, font: regular, color: ink })
    })
    y -= boxHeight + 12
  }
  if (input.closing) {
    text(input.closing)
    y -= 6
  }
  if (input.note) {
    text(input.note)
    y -= 6
  }
  if (input.agreementPdf) {
    text("Enclosed: Trade Contractor Agreement. Signing this letter also signs the enclosed agreement, which then covers every job we award you.", { font: bold, size: 10 })
    y -= 6
  }

  // Signature block: the trade on the left, the company on the right.
  ensure(SIGNATURE_BLOCK_HEIGHT)
  const signaturePage = document.getPageCount()
  const columnGap = 30
  const columnWidth = (width - columnGap) / 2
  const fields: FoxitEnvelopeField[] = []
  const signers = [
    { label: input.vendorName, name: input.signerName, title: null },
    { label: input.brand.companyName, name: input.companySigner.name, title: input.companySigner.title },
  ]
  const top = y - 10
  signers.forEach((signer, index) => {
    const x = PAGE.margin + index * (columnWidth + columnGap)
    const party = index + 1
    page.drawText(pdfSafeText(signer.label).slice(0, 60), { x, y: top - 9, size: 9, font: bold, color: ink })
    const signatureLine = top - 52
    page.drawLine({ start: { x, y: signatureLine }, end: { x: x + columnWidth, y: signatureLine }, thickness: 0.6, color: ink })
    const nameLine = signer.title ? `${signer.name}, ${signer.title}` : signer.name
    page.drawText(pdfSafeText(`Signature: ${nameLine}`).slice(0, 70), { x, y: signatureLine - 10, size: 8, font: regular, color: muted })
    const dateLine = top - 92
    page.drawLine({ start: { x, y: dateLine }, end: { x: x + columnWidth, y: dateLine }, thickness: 0.6, color: ink })
    page.drawText("Date signed", { x, y: dateLine - 10, size: 8, font: regular, color: muted })
    // Foxit measures y from the top of the page; pdf-lib from the bottom.
    fields.push(
      {
        type: "signature",
        x: Math.round(x),
        y: Math.round(PAGE.height - signatureLine - 1 - 28),
        width: Math.round(columnWidth),
        height: 28,
        documentNumber: 1,
        pageNumber: signaturePage,
        tabOrder: index * 2 + 1,
        party,
        partyResponsible: party,
        name: `Signature - ${party === 1 ? "Trade" : "Company"}`,
        tooltip: `${signer.name}: signature`,
        required: true,
      },
      {
        type: "date",
        x: Math.round(x),
        y: Math.round(PAGE.height - dateLine - 1 - 18),
        width: Math.round(columnWidth),
        height: 18,
        documentNumber: 1,
        pageNumber: signaturePage,
        tabOrder: index * 2 + 2,
        party,
        partyResponsible: party,
        name: `Date signed - ${party === 1 ? "Trade" : "Company"}`,
        tooltip: `${signer.name}: date signed`,
        required: true,
        fontSize: 10,
        dateFormat: "MM-DD-YYYY",
        readOnly: true,
        systemField: true,
      },
    )
  })

  if (input.agreementPdf) {
    const agreement = await PDFDocument.load(input.agreementPdf, { ignoreEncryption: true })
    const copied = await document.copyPages(agreement, agreement.getPageIndices())
    for (const copy of copied) document.addPage(copy)
  }

  const totalPages = document.getPageCount()
  document.getPages().forEach((each, index) => {
    const label = `${input.letterNumber} - page ${index + 1} of ${totalPages}`
    each.drawText(pdfSafeText(label), { x: PAGE.margin, y: 18, size: 7, font: regular, color: muted })
  })
  return { pdfBytes: new Uint8Array(await document.save()), fields }
}
