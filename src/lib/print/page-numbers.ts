import { PDFDocument, StandardFonts, rgb } from "pdf-lib"

/** Leave room for Next.js and PDF parsing within the Worker's memory limit. */
export const PAGE_NUMBER_MAX_BYTES = 8 * 1024 * 1024

/** Limit actual bytes read: Browser Run can omit Content-Length. */
export async function numberPdfStream(pdf: ReadableStream<Uint8Array>): Promise<ReadableStream<Uint8Array>> {
  const reader = pdf.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      chunks.push(next.value)
      size += next.value.byteLength
      if (size > PAGE_NUMBER_MAX_BYTES) {
        // Replay the prefix and stream the rest without parsing the large PDF.
        return new ReadableStream<Uint8Array>({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(chunk)
          },
          async pull(controller) {
            try {
              const next = await reader.read()
              if (next.done) {
                reader.releaseLock()
                controller.close()
              } else {
                controller.enqueue(next.value)
              }
            } catch (error) {
              reader.releaseLock()
              controller.error(error)
            }
          },
          async cancel(reason: unknown) {
            try {
              await reader.cancel(reason)
            } finally {
              reader.releaseLock()
            }
          },
        })
      }
    }
  } catch (error) {
    reader.releaseLock()
    throw error
  }
  reader.releaseLock()
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  const numbered = await numberPdfPages(bytes)
  return new Response(numbered).body ?? new ReadableStream()
}

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
