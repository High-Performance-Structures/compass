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
  readonly arCheckNumber: string | null
  readonly paymentReference: string | null
  readonly holdPayment: boolean
  readonly reimbursementOwed: string | null
  readonly mailedDate: string | null
  readonly reviewNotes: string | null
}

export type VendorBillPacketLine = {
  readonly lineNumber: number
  readonly phaseCode: string | null
  readonly costCode: string | null
  readonly costCodeDescription: string | null
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

function drawSectionTitle(input: {
  readonly page: PDFPage
  readonly title: string
  readonly y: number
  readonly boldFont: PDFFont
}): void {
  input.page.drawText(input.title, {
    x: MARGIN,
    y: input.y,
    size: 11,
    font: input.boldFont,
    color: TEXT_COLOR,
  })
  input.page.drawLine({
    start: { x: MARGIN, y: input.y - 8 },
    end: { x: PAGE_WIDTH - MARGIN, y: input.y - 8 },
    thickness: 0.75,
    color: LINE_COLOR,
  })
}

function costCodeDescription(line: VendorBillPacketLine): string {
  if (line.costCodeDescription) return line.costCodeDescription
  if (line.costCode) return "Cost code name pending"
  if (line.description) return line.description
  return "Uncoded"
}

function drawCodingTable(input: {
  readonly page: PDFPage
  readonly y: number
  readonly boldFont: PDFFont
  readonly regularFont: PDFFont
  readonly project: VendorBillPacketProject
  readonly submission: VendorBillPacketSubmission
  readonly lines: readonly VendorBillPacketLine[]
}): number {
  const tableLeft = MARGIN
  const columnWidths = [72, 42, 78, 98, 230]
  const headers = ["Project", "C/O", "Amount", "Cost Code", "Description"]
  const totalWidth = columnWidths.reduce((sum, width) => sum + width, 0)
  const headerHeight = 24
  const rowHeight = 34
  const rows = input.lines.length > 0 ? input.lines.slice(0, 4) : []

  input.page.drawRectangle({
    x: tableLeft,
    y: input.y,
    width: totalWidth,
    height: headerHeight,
    color: HEADER_FILL,
    borderColor: LINE_COLOR,
    borderWidth: 1,
  })

  let x = tableLeft
  headers.forEach((header, index) => {
    input.page.drawText(header.toUpperCase(), {
      x: x + 5,
      y: input.y + 8,
      size: 7,
      font: input.boldFont,
      color: TEXT_COLOR,
    })
    if (index > 0) {
      input.page.drawLine({
        start: { x, y: input.y },
        end: { x, y: input.y + headerHeight },
        thickness: 1,
        color: LINE_COLOR,
      })
    }
    x += columnWidths[index] ?? 0
  })

  rows.forEach((line, rowIndex) => {
    const y = input.y - rowHeight * (rowIndex + 1)
    input.page.drawRectangle({
      x: tableLeft,
      y,
      width: totalWidth,
      height: rowHeight,
      borderColor: LINE_COLOR,
      borderWidth: 1,
    })

    let columnX = tableLeft
    for (const width of columnWidths.slice(0, -1)) {
      columnX += width
      input.page.drawLine({
        start: { x: columnX, y },
        end: { x: columnX, y: y + rowHeight },
        thickness: 1,
        color: LINE_COLOR,
      })
    }

    const projectValue = input.project.sageJobNumber ?? input.project.projectNumber ?? "-"
    input.page.drawText(projectValue, {
      x: tableLeft + 5,
      y: y + 20,
      size: 9,
      font: input.regularFont,
      color: TEXT_COLOR,
    })
    input.page.drawText(input.submission.isChangeOrder ? "Yes" : "No", {
      x: tableLeft + columnWidths[0] + 5,
      y: y + 20,
      size: 9,
      font: input.regularFont,
      color: TEXT_COLOR,
    })
    input.page.drawText(money(line.amount), {
      x: tableLeft + columnWidths[0] + columnWidths[1] + 5,
      y: y + 20,
      size: 9,
      font: input.regularFont,
      color: TEXT_COLOR,
    })
    const code = [line.phaseCode, line.costCode].filter(Boolean).join(" / ")
    drawTextLines({
      page: input.page,
      text: code || "Uncoded",
      x: tableLeft + columnWidths[0] + columnWidths[1] + columnWidths[2] + 5,
      y: y + 20,
      size: 8,
      maxChars: 22,
      maxLines: 2,
      font: input.regularFont,
    })
    drawTextLines({
      page: input.page,
      text: costCodeDescription(line),
      x:
        tableLeft +
        columnWidths[0] +
        columnWidths[1] +
        columnWidths[2] +
        columnWidths[3] +
        5,
      y: y + 20,
      size: 8,
      maxChars: 42,
      maxLines: 2,
      font: input.regularFont,
    })
  })

  const footerY = input.y - rowHeight * rows.length - 18
  if (input.lines.length > rows.length) {
    input.page.drawText(
      `${input.lines.length - rows.length} additional split line(s) continue in Compass review.`,
      {
        x: tableLeft,
        y: footerY + 2,
        size: 8,
        font: input.regularFont,
        color: MUTED_COLOR,
      }
    )
    return footerY - 12
  }

  return footerY
}

function fieldValue(value: string | null): string {
  return value?.trim() ? value : "-"
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

  page.drawText("Vendor Bill Submittal", {
    x: MARGIN,
    y: PAGE_HEIGHT - MARGIN,
    size: 18,
    font: boldFont,
    color: TEXT_COLOR,
  })
  page.drawText("Compass accounting review cover sheet", {
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

  drawSectionTitle({
    page,
    title: "Bill Summary",
    y: PAGE_HEIGHT - MARGIN - 66,
    boldFont,
  })
  drawLabelValue({
    page,
    label: "Project",
    value: projectLabel(input.project),
    x: MARGIN,
    y: PAGE_HEIGHT - MARGIN - 90,
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
    y: PAGE_HEIGHT - MARGIN - 90,
    labelFont: boldFont,
    valueFont: regularFont,
    maxChars: 38,
  })

  drawLabelValue({
    page,
    label: "Invoice",
    value: input.submission.billNumber ?? "-",
    x: MARGIN,
    y: PAGE_HEIGHT - MARGIN - 146,
    labelFont: boldFont,
    valueFont: regularFont,
  })
  drawLabelValue({
    page,
    label: "Bill Date",
    value: dateText(input.submission.billDate),
    x: 180,
    y: PAGE_HEIGHT - MARGIN - 146,
    labelFont: boldFont,
    valueFont: regularFont,
  })
  drawLabelValue({
    page,
    label: "Due Date",
    value: dateText(input.submission.dueDate),
    x: 306,
    y: PAGE_HEIGHT - MARGIN - 146,
    labelFont: boldFont,
    valueFont: regularFont,
  })
  drawLabelValue({
    page,
    label: "Total",
    value: money(input.submission.totalAmount),
    x: 432,
    y: PAGE_HEIGHT - MARGIN - 146,
    labelFont: boldFont,
    valueFont: regularFont,
  })

  drawSectionTitle({
    page,
    title: "Draw / Payment Tracking",
    y: PAGE_HEIGHT - MARGIN - 204,
    boldFont,
  })
  drawLabelValue({
    page,
    label: "Draw / Pay Request",
    value: `${drawLabel(input.submission)} - ${dateText(input.submission.payRequestDate)}`,
    x: MARGIN,
    y: PAGE_HEIGHT - MARGIN - 228,
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
    x: 224,
    y: PAGE_HEIGHT - MARGIN - 228,
    labelFont: boldFont,
    valueFont: regularFont,
  })
  drawLabelValue({
    page,
    label: "Hold Payment",
    value: input.submission.holdPayment ? "Yes" : "No",
    x: 432,
    y: PAGE_HEIGHT - MARGIN - 228,
    labelFont: boldFont,
    valueFont: regularFont,
  })

  drawLabelValue({
    page,
    label: "A/R Check Number",
    value: fieldValue(input.submission.arCheckNumber),
    x: MARGIN,
    y: PAGE_HEIGHT - MARGIN - 282,
    labelFont: boldFont,
    valueFont: regularFont,
  })
  drawLabelValue({
    page,
    label: "Check # / Paid By",
    value: fieldValue(input.submission.paymentReference),
    x: 180,
    y: PAGE_HEIGHT - MARGIN - 282,
    labelFont: boldFont,
    valueFont: regularFont,
    maxChars: 32,
  })
  drawLabelValue({
    page,
    label: "Reimbursement Owed",
    value: fieldValue(input.submission.reimbursementOwed),
    x: 336,
    y: PAGE_HEIGHT - MARGIN - 282,
    labelFont: boldFont,
    valueFont: regularFont,
    maxChars: 32,
  })
  drawLabelValue({
    page,
    label: "Mailed",
    value: dateText(input.submission.mailedDate),
    x: 478,
    y: PAGE_HEIGHT - MARGIN - 282,
    labelFont: boldFont,
    valueFont: regularFont,
    maxChars: 16,
  })

  const descriptionLines = input.submission.description
    ? wrapText(input.submission.description, 100, 2)
    : []
  if (input.submission.description) {
    drawSectionTitle({
      page,
      title: "Submitted Description",
      y: PAGE_HEIGHT - MARGIN - 340,
      boldFont,
    })
    descriptionLines.forEach((line, index) => {
      page.drawText(line, {
        x: MARGIN,
        y: PAGE_HEIGHT - MARGIN - 362 - index * 13,
        size: 9,
        font: regularFont,
        color: MUTED_COLOR,
      })
    })
  }

  const costCodeTitleY =
    descriptionLines.length > 0
      ? PAGE_HEIGHT - MARGIN - 362 - (descriptionLines.length - 1) * 13 - 32
      : PAGE_HEIGHT - MARGIN - 340
  const costCodeTableY = costCodeTitleY - 36

  drawSectionTitle({
    page,
    title: "Cost Code Splits",
    y: costCodeTitleY,
    boldFont,
  })
  const nextY = drawCodingTable({
    page,
    y: costCodeTableY,
    boldFont,
    regularFont,
    project: input.project,
    submission: input.submission,
    lines: input.lines,
  })

  if (input.submission.reviewNotes) {
    page.drawText("Review Notes", {
      x: MARGIN,
      y: nextY,
      size: 10,
      font: boldFont,
      color: TEXT_COLOR,
    })
    drawTextLines({
      page,
      text: input.submission.reviewNotes,
      x: MARGIN,
      y: nextY - 18,
      size: 9,
      maxChars: 100,
      maxLines: 3,
      font: regularFont,
      color: MUTED_COLOR,
    })
  }

  page.drawText("Vendor invoice included with this submittal sheet.", {
    x: MARGIN,
    y: 32,
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
