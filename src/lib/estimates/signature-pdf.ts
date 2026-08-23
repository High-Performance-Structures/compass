import { PDFDocument, StandardFonts, rgb } from "pdf-lib"

import type { FoxitEnvelopeField } from "@/lib/foxit/esign"

function arrayBufferBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ""
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

export type PreparedEstimateSignaturePdf = {
  readonly pdfBase64: string
  readonly fields: readonly FoxitEnvelopeField[]
}

export async function prepareEstimateSignaturePdf(input: {
  readonly pdf: ArrayBuffer
  readonly signerLabels: readonly string[]
}): Promise<PreparedEstimateSignaturePdf> {
  const document = await PDFDocument.load(input.pdf)
  const pages = document.getPages()
  if (input.signerLabels.length === 0) {
    throw new Error("At least one signer is required for an estimate signature PDF.")
  }
  if (pages.length < 2) {
    throw new Error("The estimate signature PDF must include a signature page.")
  }
  const font = await document.embedFont(StandardFonts.Helvetica)
  const fields: FoxitEnvelopeField[] = []
  const fieldHeight = 18
  const fieldWidth = 34
  const fieldGap = 8
  const bottom = 20
  const label = "Initials:"
  const labelWidth = font.widthOfTextAtSize(label, 7)
  const totalPages = pages.length

  pages.forEach((page, pageIndex) => {
    const pageLabel = `Page ${pageIndex + 1} of ${totalPages}`
    const pageLabelWidth = font.widthOfTextAtSize(pageLabel, 7)
    page.drawText(pageLabel, {
      x: Math.max(36, (page.getWidth() - pageLabelWidth) / 2),
      y: 8,
      size: 7,
      font,
      color: rgb(0.35, 0.35, 0.35),
    })
  })

  for (const [pageIndex, page] of pages.slice(0, -1).entries()) {
    const fieldsWidth =
      input.signerLabels.length * fieldWidth +
      Math.max(0, input.signerLabels.length - 1) * fieldGap
    const groupWidth = labelWidth + 10 + fieldsWidth
    const startX = Math.max(36, page.getWidth() - groupWidth - 36)
    page.drawText(label, {
      x: startX,
      y: bottom + 5,
      size: 7,
      font,
      color: rgb(0.35, 0.35, 0.35),
    })
    input.signerLabels.forEach((signerLabel, signerIndex) => {
      const x = startX + labelWidth + 10 + signerIndex * (fieldWidth + fieldGap)
      page.drawRectangle({
        x,
        y: bottom,
        width: fieldWidth,
        height: fieldHeight,
        borderWidth: 0.5,
        borderColor: rgb(0.55, 0.55, 0.55),
      })
      page.drawText(signerLabel, {
        x: x + 2,
        y: bottom + fieldHeight + 2,
        size: 5,
        font,
        color: rgb(0.4, 0.4, 0.4),
      })
      const party = signerIndex + 1
      fields.push({
        type: "initial",
        x: Math.round(x),
        // Foxit measures y from the top; pdf-lib measures it from the bottom.
        y: Math.round(page.getHeight() - bottom - fieldHeight),
        width: fieldWidth,
        height: fieldHeight,
        documentNumber: 1,
        pageNumber: pageIndex + 1,
        tabOrder: pageIndex * input.signerLabels.length + party,
        party,
        partyResponsible: party,
        name: `Page ${pageIndex + 1} initials - ${signerLabel}`,
        tooltip: `${signerLabel}: initial page ${pageIndex + 1}`,
        required: true,
      })
    })
  }
  const availableWidth = pages[0]?.getWidth() ?? 0
  const requiredWidth =
    labelWidth + 10 +
    input.signerLabels.length * fieldWidth +
    Math.max(0, input.signerLabels.length - 1) * fieldGap +
    72
  if (requiredWidth > availableWidth) {
    throw new Error("There are too many signers to fit the required page initials fields.")
  }

  const signaturePage = pages[pages.length - 1]
  if (!signaturePage) {
    throw new Error("The estimate signature PDF must include a signature page.")
  }
  // These top-left coordinates mirror the two-column signature slots in the
  // print report; Foxit uses top-origin coordinates while pdf-lib uses bottom-origin.
  const signatureMargin = 40
  const signatureColumnGap = 30
  const signatureColumnWidth = Math.floor(
    (signaturePage.getWidth() - signatureMargin * 2 - signatureColumnGap) / 2
  )
  const signatureFieldTop = 105
  const signatureFieldHeight = 32
  const dateFieldTop = 178
  const dateFieldHeight = 20
  const signatureRowStride = 126
  const signaturePageBottomReserve = 48
  const signatureTabStart = (totalPages - 1) * input.signerLabels.length

  input.signerLabels.forEach((signerLabel, signerIndex) => {
    const row = Math.floor(signerIndex / 2)
    const column = signerIndex % 2
    const x =
      signatureMargin + column * (signatureColumnWidth + signatureColumnGap)
    const signatureY = signatureFieldTop + row * signatureRowStride
    const dateY = dateFieldTop + row * signatureRowStride
    if (
      dateY + dateFieldHeight >
      signaturePage.getHeight() - signaturePageBottomReserve
    ) {
      throw new Error(
        "There are too many signers to fit the required signature-page fields."
      )
    }
    const party = signerIndex + 1
    const tabOrder = signatureTabStart + signerIndex * 2
    fields.push(
      {
        type: "signature",
        x,
        y: signatureY,
        width: signatureColumnWidth,
        height: signatureFieldHeight,
        documentNumber: 1,
        pageNumber: totalPages,
        tabOrder: tabOrder + 1,
        party,
        partyResponsible: party,
        name: `Signature - ${signerLabel}`,
        tooltip: `${signerLabel}: signature`,
        required: true,
      },
      {
        type: "date",
        x,
        y: dateY,
        width: signatureColumnWidth,
        height: dateFieldHeight,
        documentNumber: 1,
        pageNumber: totalPages,
        tabOrder: tabOrder + 2,
        party,
        partyResponsible: party,
        name: `Date signed - ${signerLabel}`,
        tooltip: `${signerLabel}: date signed`,
        required: true,
        fontSize: 10,
        dateFormat: "MM-DD-YYYY",
        readOnly: true,
        systemField: true,
      }
    )
  })

  const saved = await document.save()
  const copy = new Uint8Array(saved.byteLength)
  copy.set(saved)
  return { pdfBase64: arrayBufferBase64(copy.buffer), fields }
}
