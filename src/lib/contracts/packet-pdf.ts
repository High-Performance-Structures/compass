import {
  PDFDocument,
  PDFFont,
  PDFPage,
  StandardFonts,
  rgb,
} from "pdf-lib"

import type {
  ProjectContractPacketDocumentItem,
  ProjectContractPacketEstimateOption,
  ProjectContractPacketSummary,
} from "@/app/actions/contract-packets"
import {
  contractDocumentSchedule,
  dollarsInWords,
  fillContractTokens,
} from "@/lib/contracts/packet"
import {
  prepareEstimateSignaturePdf,
  type PreparedEstimateSignaturePdf,
} from "@/lib/estimates/signature-pdf"

const PAGE_WIDTH = 612
const PAGE_HEIGHT = 792
const MARGIN = 54
const FOOTER_RESERVE = 42

type TextStyle = {
  readonly font: PDFFont
  readonly size: number
  readonly lineHeight: number
  readonly before: number
  readonly after: number
}

type Writer = {
  readonly document: PDFDocument
  readonly regular: PDFFont
  readonly bold: PDFFont
  page: PDFPage
  y: number
}

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100)
}

function percent(basisPoints: number): string {
  return `${(basisPoints / 100).toFixed(2)}%`
}

function displayDate(value: string | null): string {
  if (!value) return ""
  const date = new Date(`${value.slice(0, 10)}T12:00:00`)
  if (Number.isNaN(date.valueOf())) return value
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date)
}

function cleanMarkdown(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/<[^>]+>/g, "")
    .trim()
}

function wrappedLines(text: string, font: PDFFont, size: number, width: number): readonly string[] {
  const words = cleanMarkdown(text).split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const lines: string[] = []
  let current = ""
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (font.widthOfTextAtSize(candidate, size) <= width || !current) {
      current = candidate
    } else {
      lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)
  return lines
}

function newPage(writer: Writer): void {
  writer.page = writer.document.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  writer.y = PAGE_HEIGHT - MARGIN
}

function ensureSpace(writer: Writer, height: number): void {
  if (writer.y - height < FOOTER_RESERVE) newPage(writer)
}

function drawBlock(writer: Writer, text: string, style: TextStyle, indent = 0): void {
  const lines = wrappedLines(text, style.font, style.size, PAGE_WIDTH - MARGIN * 2 - indent)
  if (lines.length === 0) {
    writer.y -= style.after
    return
  }
  ensureSpace(writer, style.before + lines.length * style.lineHeight + style.after)
  writer.y -= style.before
  for (const line of lines) {
    writer.page.drawText(line, {
      x: MARGIN + indent,
      y: writer.y,
      size: style.size,
      font: style.font,
      color: rgb(0.08, 0.08, 0.08),
    })
    writer.y -= style.lineHeight
  }
  writer.y -= style.after
}

function drawTable(writer: Writer, rows: readonly string[]): void {
  const cells = rows.map((row) =>
    row.split("|").slice(1, -1).map((cell) => cleanMarkdown(cell))
  )
  const contentRows = cells.filter((row) =>
    !row.every((cell) => /^:?-{3,}:?$/.test(cell))
  )
  for (const [rowIndex, row] of contentRows.entries()) {
    const text = row.filter(Boolean).join("  ·  ")
    drawBlock(writer, text, {
      font: rowIndex === 0 ? writer.bold : writer.regular,
      size: 8,
      lineHeight: 11,
      before: rowIndex === 0 ? 5 : 1,
      after: 2,
    }, rowIndex === 0 ? 0 : 8)
  }
}

function drawMarkdown(writer: Writer, markdown: string): void {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n")
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index]?.trim() ?? ""
    if (!raw) {
      writer.y -= 4
      continue
    }
    if (raw.startsWith("|")) {
      const table: string[] = []
      let cursor = index
      while ((lines[cursor]?.trim() ?? "").startsWith("|")) {
        table.push(lines[cursor]?.trim() ?? "")
        cursor += 1
      }
      drawTable(writer, table)
      index = cursor - 1
      continue
    }
    const heading = raw.match(/^(#{1,4})\s+(.+)$/)
    if (heading) {
      const level = heading[1]?.length ?? 2
      drawBlock(writer, heading[2] ?? "", {
        font: writer.bold,
        size: level === 1 ? 15 : level === 2 ? 12 : 10,
        lineHeight: level === 1 ? 19 : level === 2 ? 16 : 14,
        before: level === 1 ? 12 : 8,
        after: 4,
      })
      continue
    }
    const list = raw.match(/^[-*]\s+(.+)$/)
    drawBlock(writer, list ? `• ${list[1] ?? ""}` : raw, {
      font: writer.regular,
      size: 9,
      lineHeight: 13,
      before: 1,
      after: 3,
    }, list ? 10 : 0)
  }
}

async function renderContractDocuments(input: {
  readonly packet: ProjectContractPacketSummary
  readonly documents: readonly ProjectContractPacketDocumentItem[]
  readonly estimate: ProjectContractPacketEstimateOption
  readonly projectName: string
  readonly projectNumber: string | null
  readonly projectAddress: string | null
}): Promise<PDFDocument> {
  const document = await PDFDocument.create()
  const regular = await document.embedFont(StandardFonts.TimesRoman)
  const bold = await document.embedFont(StandardFonts.TimesRomanBold)
  const first = document.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  const writer: Writer = { document, regular, bold, page: first, y: PAGE_HEIGHT - MARGIN }
  const schedule = contractDocumentSchedule(input.documents)
  const values = {
    "project.name": input.projectName,
    "project.number": input.projectNumber ?? "",
    "project.address": input.packet.details.projectAddress ?? input.projectAddress ?? "",
    "project.location": input.packet.details.projectAddress ?? input.projectAddress ?? "",
    "project.county": input.packet.details.county ?? "",
    "project.owner_name": input.packet.details.ownerName ?? input.estimate.clientName ?? "",
    "contract.document_schedule": schedule,
    "contract.execution_date": displayDate(input.packet.contractDraftDate),
    "contract.commencement_date": displayDate(input.packet.approximateCommencementDate),
    "contract.completion_date": displayDate(input.packet.approximateCompletionDate),
    "contract.deposit": money(input.packet.depositCents),
    "contract.deposit_words": dollarsInWords(input.packet.depositCents),
    "contract.late_payment_percent": percent(input.packet.latePaymentRateBasisPoints),
    "estimate.date": displayDate(input.estimate.estimateDate),
    "estimate.total": money(input.estimate.estimateTotalCents),
    "estimate.total_words": dollarsInWords(input.estimate.estimateTotalCents),
    "estimate.builder_fee_percent": percent(input.estimate.builderFeeRateBasisPoints),
    "estimate.builder_fee_total": money(input.estimate.builderFeeCents),
    "estimate.builder_fee_words": dollarsInWords(input.estimate.builderFeeCents),
  }
  const embedded = input.documents.filter(
    (item) => item.inclusionMode === "embedded" && item.signingStage === "contract"
  )
  for (const [index, item] of embedded.entries()) {
    if (index > 0) newPage(writer)
    drawBlock(writer, `${item.code} · ${item.title}`, {
      font: bold,
      size: 16,
      lineHeight: 20,
      before: 0,
      after: 4,
    })
    drawBlock(writer, `${input.packet.legalEntityName} · ${input.projectName}`, {
      font: regular,
      size: 8,
      lineHeight: 11,
      before: 0,
      after: 12,
    })
    drawMarkdown(writer, fillContractTokens(item.contentMarkdown, values))
  }
  return document
}

async function appendEstimateWithoutSignaturePage(
  target: PDFDocument,
  estimatePdf: ArrayBuffer
): Promise<void> {
  const estimate = await PDFDocument.load(estimatePdf)
  const pageCount = estimate.getPageCount()
  if (pageCount < 2) throw new Error("The selected CA22 estimate is missing its signature page.")
  const pages = await target.copyPages(
    estimate,
    Array.from({ length: pageCount - 1 }, (_, index) => index)
  )
  for (const page of pages) target.addPage(page)
}

async function appendPacketSignaturePage(input: {
  readonly document: PDFDocument
  readonly packet: ProjectContractPacketSummary
  readonly estimate: ProjectContractPacketEstimateOption
}): Promise<void> {
  const page = input.document.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  const regular = await input.document.embedFont(StandardFonts.Helvetica)
  const bold = await input.document.embedFont(StandardFonts.HelveticaBold)
  page.drawText("Contract packet signatures", { x: 40, y: 752, size: 18, font: bold })
  page.drawText(`${input.packet.packetNumber} · version ${input.packet.versionNumber}`, { x: 40, y: 732, size: 10, font: regular })
  page.drawText(`CA22 estimate: ${input.estimate.estimateNumber} · version ${input.estimate.versionNumber}`, { x: 40, y: 716, size: 9, font: regular })
  page.drawText("By signing, each party acknowledges the complete numbered contract packet.", { x: 40, y: 700, size: 9, font: regular })
  const signers = [
    ...input.packet.clientSigners.map((signer, index) => ({
      label: `Owner ${index + 1}`,
      name: signer.name,
      title: signer.title,
    })),
    {
      label: "Company representative",
      name: input.packet.companySignerName ?? "",
      title: input.packet.companySignerTitle ?? "",
    },
  ]
  const margin = 40
  const gap = 30
  const width = Math.floor((PAGE_WIDTH - margin * 2 - gap) / 2)
  for (const [index, signer] of signers.entries()) {
    const row = Math.floor(index / 2)
    const column = index % 2
    const x = margin + column * (width + gap)
    // These rows deliberately match prepareEstimateSignaturePdf's fixed Foxit
    // signature/date coordinates, with labels just above each editable field.
    const topY = PAGE_HEIGHT - 102 - row * 126
    page.drawText(`${signer.label}: ${signer.name}`, { x, y: topY, size: 8, font: bold })
    if (signer.title) page.drawText(signer.title, { x, y: topY - 12, size: 7, font: regular })
    page.drawText("Signature", { x, y: topY - 55, size: 7, font: regular })
    page.drawLine({ start: { x, y: topY - 59 }, end: { x: x + width, y: topY - 59 }, thickness: 0.6 })
    page.drawText("Date signed", { x, y: topY - 104, size: 7, font: regular })
    page.drawLine({ start: { x, y: topY - 108 }, end: { x: x + width, y: topY - 108 }, thickness: 0.6 })
  }
}

export async function prepareContractPacketPdf(input: {
  readonly packet: ProjectContractPacketSummary
  readonly documents: readonly ProjectContractPacketDocumentItem[]
  readonly estimate: ProjectContractPacketEstimateOption
  readonly projectName: string
  readonly projectNumber: string | null
  readonly projectAddress: string | null
  readonly estimatePdf: ArrayBuffer
}): Promise<PreparedEstimateSignaturePdf> {
  if (!input.documents.some((item) => item.code === "CA00")) {
    throw new Error("Add CA00 before preparing the full contract packet.")
  }
  if (!input.documents.some((item) => item.code === "CA22")) {
    throw new Error("Add CA22 before preparing the full contract packet.")
  }
  const contract = await renderContractDocuments(input)
  await appendEstimateWithoutSignaturePage(contract, input.estimatePdf)
  await appendPacketSignaturePage({
    document: contract,
    packet: input.packet,
    estimate: input.estimate,
  })
  const saved = await contract.save()
  const copy = new Uint8Array(saved.byteLength)
  copy.set(saved)
  return prepareEstimateSignaturePdf({
    pdf: copy.buffer,
    signerLabels: [
      ...input.packet.clientSigners.map((_, index) => `Owner ${index + 1}`),
      "Company",
    ],
  })
}

export function base64PdfBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}
