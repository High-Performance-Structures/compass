import { PDFDocument, type PDFPage, type PDFFont, StandardFonts, rgb } from "pdf-lib"

export type VendorBillPacketProject = {
  readonly projectNumber: string | null
  readonly name: string
  readonly sageJobNumber: string | null
}

export type VendorBillPacketSubmission = {
  readonly vendorName: string
  readonly vendorEmail: string | null
  readonly billNumber: string | null
  readonly billDate: string | null
  readonly dueDate: string | null
  readonly description: string | null
  readonly totalAmount: number
  readonly payRequestNumber: string | null
  readonly payRequestDate: string | null
  readonly isChangeOrder: boolean
  readonly changeOrderNumber: string | null
  readonly reviewNotes: string | null
}

export type VendorBillPacketLine = {
  readonly lineNumber: number
  readonly phaseCode: string | null
  readonly costCode: string | null
  readonly description: string | null
  readonly amount: number
}

export type VendorBillPacketAttachment = {
  readonly fileName: string
  readonly storageUrl: string | null
}

export type VendorBillDuplicateReview = {
  readonly status: string
  readonly source: string | null
  readonly message: string | null
}

export type VendorBillPacketInput = {
  readonly generatedAt: string
  readonly generatedBy: string
  readonly project: VendorBillPacketProject
  readonly submission: VendorBillPacketSubmission
  readonly lines: readonly VendorBillPacketLine[]
  readonly attachments: readonly VendorBillPacketAttachment[]
  readonly duplicateReview: VendorBillDuplicateReview
  readonly originalInvoicePdf: ArrayBuffer | null
}

const PAGE_WIDTH = 612
const PAGE_HEIGHT = 792
const MARGIN = 46
const TABLE_LEFT = 46
const TABLE_TOP = 486
const ROW_HEIGHT = 38
const HEADER_FILL = rgb(0.92, 0.92, 0.9)
const LINE_COLOR = rgb(0.2, 0.2, 0.2)
const TEXT_COLOR = rgb(0.13, 0.13, 0.13)
const MUTED_COLOR = rgb(0.38, 0.38, 0.38)

function money(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value)
}

function dateText(value: string | null): string {
  if (!value) return "-"
  const date = new Date(`${value.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function projectLabel(project: VendorBillPacketProject): string {
  return project.projectNumber
    ? `${project.projectNumber} - ${project.name}`
    : project.name
}

function drawLabel(submission: VendorBillPacketSubmission): string {
  if (!submission.payRequestNumber) return "-"
  return `Draw ${submission.payRequestNumber}`
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function wrapText(input: string, maxChars: number, maxLines: number): readonly string[] {
  const words = oneLine(input).split(" ").filter((word) => word.length > 0)
  const lines: string[] = []
  let current = ""

  for (const word of words) {
    const candidate = current.length > 0 ? `${current} ${word}` : word
    if (candidate.length <= maxChars) {
      current = candidate
      continue
    }

    if (current.length > 0) lines.push(current)
    current = word
    if (lines.length === maxLines) break
  }

  if (lines.length < maxLines && current.length > 0) lines.push(current)
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    const last = lines[lines.length - 1]
    if (last) lines[lines.length - 1] = `${last.slice(0, Math.max(0, maxChars - 3))}...`
  }
  return lines
}

function drawTextLines(input: {
  readonly page: PDFPage
  readonly text: string
  readonly x: number
  readonly y: number
  readonly size: number
  readonly maxChars: number
  readonly maxLines: number
  readonly font: PDFFont
  readonly color?: ReturnType<typeof rgb>
}): void {
  const lines = wrapText(input.text, input.maxChars, input.maxLines)
  lines.forEach((line, index) => {
    input.page.drawText(line, {
      x: input.x,
      y: input.y - index * (input.size + 4),
      size: input.size,
      font: input.font,
      color: input.color ?? TEXT_COLOR,
    })
  })
}

function drawRule(
  page: PDFPage,
  y: number
): void {
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_WIDTH - MARGIN, y },
    thickness: 1,
    color: LINE_COLOR,
  })
}

function drawLabelValue(input: {
  readonly page: PDFPage
  readonly label: string
  readonly value: string
  readonly x: number
  readonly y: number
  readonly labelFont: PDFFont
  readonly valueFont: PDFFont
  readonly maxChars?: number
}): void {
  input.page.drawText(input.label.toUpperCase(), {
    x: input.x,
    y: input.y,
    size: 7,
    font: input.labelFont,
    color: MUTED_COLOR,
  })
  drawTextLines({
    page: input.page,
    text: input.value,
    x: input.x,
    y: input.y - 14,
    size: 10,
    maxChars: input.maxChars ?? 34,
    maxLines: 2,
    font: input.valueFont,
  })
}

function drawOfficeUseTable(input: {
  readonly page: PDFPage
  readonly boldFont: PDFFont
  readonly regularFont: PDFFont
  readonly project: VendorBillPacketProject
  readonly submission: VendorBillPacketSubmission
  readonly lines: readonly VendorBillPacketLine[]
}): void {
  const columnWidths = [84, 54, 96, 286]
  const headers = ["Project", "C/O", "$ / Split", "Account / Item"]
  const totalWidth = columnWidths.reduce((sum, width) => sum + width, 0)

  input.page.drawRectangle({
    x: TABLE_LEFT,
    y: TABLE_TOP,
    width: totalWidth,
    height: 26,
    color: HEADER_FILL,
    borderColor: LINE_COLOR,
    borderWidth: 1,
  })

  let x = TABLE_LEFT
  headers.forEach((header, index) => {
    input.page.drawText(header.toUpperCase(), {
      x: x + 5,
      y: TABLE_TOP + 9,
      size: 7,
      font: input.boldFont,
      color: TEXT_COLOR,
    })
    if (index > 0) {
      input.page.drawLine({
        start: { x, y: TABLE_TOP },
        end: { x, y: TABLE_TOP + 26 - ROW_HEIGHT * 0 + 1 },
        thickness: 1,
        color: LINE_COLOR,
      })
    }
    x += columnWidths[index] ?? 0
  })

  const rows = input.lines.length > 0 ? input.lines.slice(0, 5) : []
  for (let rowIndex = 0; rowIndex < 5; rowIndex += 1) {
    const y = TABLE_TOP - ROW_HEIGHT * (rowIndex + 1)
    input.page.drawRectangle({
      x: TABLE_LEFT,
      y,
      width: totalWidth,
      height: ROW_HEIGHT,
      borderColor: LINE_COLOR,
      borderWidth: 1,
    })

    let columnX = TABLE_LEFT
    for (const width of columnWidths.slice(0, -1)) {
      columnX += width
      input.page.drawLine({
        start: { x: columnX, y },
        end: { x: columnX, y: y + ROW_HEIGHT },
        thickness: 1,
        color: LINE_COLOR,
      })
    }

    const line = rows[rowIndex]
    if (!line) continue

    const projectValue = input.project.sageJobNumber ?? input.project.projectNumber ?? "-"
    input.page.drawText(projectValue, {
      x: TABLE_LEFT + 5,
      y: y + 22,
      size: 9,
      font: input.regularFont,
      color: TEXT_COLOR,
    })
    input.page.drawText(input.submission.isChangeOrder ? "Yes" : "No", {
      x: TABLE_LEFT + columnWidths[0] + 5,
      y: y + 22,
      size: 9,
      font: input.regularFont,
      color: TEXT_COLOR,
    })
    input.page.drawText(money(line.amount), {
      x: TABLE_LEFT + columnWidths[0] + columnWidths[1] + 5,
      y: y + 22,
      size: 9,
      font: input.regularFont,
      color: TEXT_COLOR,
    })
    const code = [line.phaseCode, line.costCode].filter(Boolean).join(" / ")
    drawTextLines({
      page: input.page,
      text: `${code || "Uncoded"} - ${line.description ?? "No description"}`,
      x: TABLE_LEFT + columnWidths[0] + columnWidths[1] + columnWidths[2] + 5,
      y: y + 22,
      size: 8,
      maxChars: 54,
      maxLines: 2,
      font: input.regularFont,
    })
  }

  const footerY = TABLE_TOP - ROW_HEIGHT * 5 - 30
  const footerItems = [
    `SCAN: AP`,
    `AP INV: ${input.submission.billNumber ?? "-"}`,
    `CHECK:`,
    `HOLD:`,
    `REIMB:`,
    `MAILED:`,
  ]
  input.page.drawText(footerItems.join("     "), {
    x: TABLE_LEFT,
    y: footerY,
    size: 8,
    font: input.boldFont,
    color: TEXT_COLOR,
  })
}

async function appendOriginalInvoice(input: {
  readonly pdf: PDFDocument
  readonly originalInvoicePdf: ArrayBuffer | null
  readonly boldFont: PDFFont
  readonly regularFont: PDFFont
  readonly attachments: readonly VendorBillPacketAttachment[]
}): Promise<void> {
  if (input.originalInvoicePdf) {
    try {
      const invoicePdf = await PDFDocument.load(input.originalInvoicePdf, {
        ignoreEncryption: true,
      })
      const copiedPages = await input.pdf.copyPages(
        invoicePdf,
        invoicePdf.getPageIndices()
      )
      for (const copiedPage of copiedPages) input.pdf.addPage(copiedPage)
      return
    } catch {
      // Fall through and create an attachment reference page.
    }
  }

  const page = input.pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  page.drawText("Original Attachment Reference", {
    x: MARGIN,
    y: PAGE_HEIGHT - MARGIN,
    size: 18,
    font: input.boldFont,
    color: TEXT_COLOR,
  })
  let y = PAGE_HEIGHT - MARGIN - 40
  for (const attachment of input.attachments) {
    drawTextLines({
      page,
      text: `${attachment.fileName}${attachment.storageUrl ? ` - ${attachment.storageUrl}` : ""}`,
      x: MARGIN,
      y,
      size: 10,
      maxChars: 86,
      maxLines: 3,
      font: input.regularFont,
    })
    y -= 54
  }
}

export async function buildVendorBillFinalPacketPdf(
  input: VendorBillPacketInput
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const regularFont = await pdf.embedFont(StandardFonts.Helvetica)
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold)
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT])

  page.drawText("HPS / ORC Office Use", {
    x: MARGIN,
    y: PAGE_HEIGHT - MARGIN,
    size: 18,
    font: boldFont,
    color: TEXT_COLOR,
  })
  page.drawText("Vendor Bill Final Submittal", {
    x: MARGIN,
    y: PAGE_HEIGHT - MARGIN - 22,
    size: 11,
    font: regularFont,
    color: MUTED_COLOR,
  })
  page.drawText(`Generated ${dateText(input.generatedAt)} by ${input.generatedBy}`, {
    x: PAGE_WIDTH - 234,
    y: PAGE_HEIGHT - MARGIN - 2,
    size: 9,
    font: regularFont,
    color: MUTED_COLOR,
  })
  drawRule(page, PAGE_HEIGHT - MARGIN - 42)

  drawLabelValue({
    page,
    label: "Project",
    value: projectLabel(input.project),
    x: MARGIN,
    y: PAGE_HEIGHT - MARGIN - 72,
    labelFont: boldFont,
    valueFont: regularFont,
    maxChars: 48,
  })
  drawLabelValue({
    page,
    label: "Vendor",
    value: input.submission.vendorEmail
      ? `${input.submission.vendorName} (${input.submission.vendorEmail})`
      : input.submission.vendorName,
    x: 326,
    y: PAGE_HEIGHT - MARGIN - 72,
    labelFont: boldFont,
    valueFont: regularFont,
    maxChars: 38,
  })

  drawLabelValue({
    page,
    label: "Invoice",
    value: input.submission.billNumber ?? "-",
    x: MARGIN,
    y: PAGE_HEIGHT - MARGIN - 130,
    labelFont: boldFont,
    valueFont: regularFont,
  })
  drawLabelValue({
    page,
    label: "Bill Date",
    value: dateText(input.submission.billDate),
    x: 180,
    y: PAGE_HEIGHT - MARGIN - 130,
    labelFont: boldFont,
    valueFont: regularFont,
  })
  drawLabelValue({
    page,
    label: "Due Date",
    value: dateText(input.submission.dueDate),
    x: 306,
    y: PAGE_HEIGHT - MARGIN - 130,
    labelFont: boldFont,
    valueFont: regularFont,
  })
  drawLabelValue({
    page,
    label: "Total",
    value: money(input.submission.totalAmount),
    x: 432,
    y: PAGE_HEIGHT - MARGIN - 130,
    labelFont: boldFont,
    valueFont: regularFont,
  })

  drawLabelValue({
    page,
    label: "Draw / Pay Request",
    value: `${drawLabel(input.submission)} - ${dateText(input.submission.payRequestDate)}`,
    x: MARGIN,
    y: PAGE_HEIGHT - MARGIN - 184,
    labelFont: boldFont,
    valueFont: regularFont,
    maxChars: 40,
  })
  drawLabelValue({
    page,
    label: "Change Order",
    value: input.submission.isChangeOrder
      ? input.submission.changeOrderNumber ?? "Yes"
      : "No",
    x: 306,
    y: PAGE_HEIGHT - MARGIN - 184,
    labelFont: boldFont,
    valueFont: regularFont,
  })

  if (input.submission.description) {
    drawTextLines({
      page,
      text: input.submission.description,
      x: MARGIN,
      y: PAGE_HEIGHT - MARGIN - 238,
      size: 9,
      maxChars: 100,
      maxLines: 3,
      font: regularFont,
      color: MUTED_COLOR,
    })
  }

  drawOfficeUseTable({
    page,
    boldFont,
    regularFont,
    project: input.project,
    submission: input.submission,
    lines: input.lines,
  })

  const duplicateY = 190
  page.drawText("Duplicate / Sage Check", {
    x: MARGIN,
    y: duplicateY,
    size: 10,
    font: boldFont,
    color: TEXT_COLOR,
  })
  drawTextLines({
    page,
    text:
      input.duplicateReview.message ??
      "No duplicate warning recorded. Sage direct duplicate check is still required before posting.",
    x: MARGIN,
    y: duplicateY - 18,
    size: 9,
    maxChars: 100,
    maxLines: 3,
    font: regularFont,
    color:
      input.duplicateReview.status === "possible_duplicate"
        ? rgb(0.58, 0.16, 0.12)
        : MUTED_COLOR,
  })

  if (input.submission.reviewNotes) {
    page.drawText("Review Notes", {
      x: MARGIN,
      y: 126,
      size: 10,
      font: boldFont,
      color: TEXT_COLOR,
    })
    drawTextLines({
      page,
      text: input.submission.reviewNotes,
      x: MARGIN,
      y: 108,
      size: 9,
      maxChars: 100,
      maxLines: 3,
      font: regularFont,
      color: MUTED_COLOR,
    })
  }

  page.drawText("Original invoice and backup follow this coding cover sheet.", {
    x: MARGIN,
    y: 54,
    size: 9,
    font: regularFont,
    color: MUTED_COLOR,
  })

  await appendOriginalInvoice({
    pdf,
    originalInvoicePdf: input.originalInvoicePdf,
    boldFont,
    regularFont,
    attachments: input.attachments,
  })

  return pdf.save()
}
