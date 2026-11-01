import { PDFDocument } from "pdf-lib"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  quickAction: vi.fn(),
  scope: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  getCloudflareContext: async () => ({ env: {
    BROWSER: { quickAction: mocks.quickAction },
    WORKOS_REDIRECT_URI: "https://compass.example/callback",
  } }),
}))
vi.mock("@/lib/project-audience-request-server", () => ({ getProjectAudienceRequestScope: mocks.scope }))

import { renderPrintPagePdf } from "../render-pdf"
import { PAGE_NUMBER_MAX_BYTES } from "../page-numbers"

const input = {
  request: new Request("https://compass.example/api/projects/p/print/owner-update", { headers: { Cookie: "session=viewer" } }),
  path: "/print/projects/p/owner-update/source",
  searchParams: { updateId: "update-1" },
  waitForSelector: '[data-print-ready="true"]',
}

describe("renderPrintPagePdf", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.scope.mockResolvedValue(null)
  })

  it("numbers small PDFs without Content-Length and preserves viewer scope", async () => {
    const document = await PDFDocument.create()
    document.addPage()
    document.addPage()
    const original = await document.save()
    mocks.quickAction.mockResolvedValue(new Response(new Uint8Array(original)))
    mocks.scope.mockResolvedValue({ projectId: "p", audience: "owner", targetUserId: "owner-1" })
    const result = await renderPrintPagePdf(input)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    const bytes = await result.bytes()
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2)
    expect(bytes.byteLength).toBeGreaterThan(original.byteLength)
    expect(mocks.quickAction).toHaveBeenCalledWith("pdf", expect.objectContaining({
      url: "https://compass.example/print/projects/p/owner-update/source?updateId=update-1&previewProject=p&previewAudience=owner&previewAs=owner-1",
      setExtraHTTPHeaders: { Cookie: "session=viewer" },
    }))
  })

  it.each([undefined, "1"])("streams a large PDF when Content-Length is %s, preserving every byte", async (length) => {
    const chunkSize = 1024 * 1024
    const count = PAGE_NUMBER_MAX_BYTES / chunkSize + 4
    let produced = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (produced === count) return controller.close()
        controller.enqueue(new Uint8Array(chunkSize).fill(produced))
        produced += 1
      },
    })
    const response = new Response(stream, { headers: length ? { "Content-Length": length } : {} })
    const readWholeBody = vi.spyOn(response, "arrayBuffer")
    mocks.quickAction.mockResolvedValue(response)
    const result = await renderPrintPagePdf(input)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    // The renderer returns before reading the entire body or parsing it as a PDF.
    expect(produced).toBeLessThan(count)
    expect(readWholeBody).not.toHaveBeenCalled()
    const bytes = new Uint8Array(await result.bytes())
    expect(bytes.byteLength).toBe(count * chunkSize)
    for (let index = 0; index < bytes.byteLength; index += 1) {
      if (bytes[index] !== Math.floor(index / chunkSize)) throw new Error(`Lost PDF byte ${index}`)
    }
  })

  it("cancels the upstream large PDF when the viewer disconnects", async () => {
    const cancel = vi.fn()
    mocks.quickAction.mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)) },
      cancel,
    })))
    const result = await renderPrintPagePdf(input)
    if (!result.ok) throw new Error(result.error)
    await result.pdf.cancel("viewer disconnected")
    expect(cancel).toHaveBeenCalledWith("viewer disconnected")
  })

  it("streams already-numbered PDFs without parsing or buffering", async () => {
    mocks.quickAction.mockResolvedValue(new Response("already numbered"))
    const result = await renderPrintPagePdf({ ...input, pageNumbers: false })
    if (!result.ok) throw new Error(result.error)
    expect(new TextDecoder().decode(await result.bytes())).toBe("already numbered")
  })
})
