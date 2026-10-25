import { getProjectAudienceRequestScope } from "@/lib/project-audience-request-server"
import { getCloudflareContext } from "@/lib/db"
import { PAGE_NUMBER_MAX_BYTES, numberPdfPages } from "@/lib/print/page-numbers"

export type PrintPdfRequest = {
  /** The incoming request; its cookie lets the renderer open the print page. */
  readonly request: Request
  /** App path of the print page, e.g. /print/projects/<id>/estimate. */
  readonly path: string
  readonly searchParams?: Readonly<Record<string, string>>
  /** Rendering waits for this selector so the PDF has the whole document. */
  readonly waitForSelector: string
  readonly landscape?: boolean
  /** "Page X of N" on documents longer than a page; on unless the caller numbers pages itself. */
  readonly pageNumbers?: boolean
}

export type PrintPdfResult =
  /** The rendered PDF, streamed so large documents never sit in memory. */
  | { readonly ok: true; readonly pdf: ReadableStream<Uint8Array>; readonly bytes: () => Promise<ArrayBuffer> }
  | { readonly ok: false; readonly status: 502 | 503; readonly error: string }

/** Renders an app print page to a letter PDF through the browser binding. */
export async function renderPrintPagePdf(input: PrintPdfRequest): Promise<PrintPdfResult> {
  const { env } = await getCloudflareContext()
  const quickAction = Reflect.get(env.BROWSER, "quickAction")
  if (typeof quickAction !== "function") {
    return { ok: false, status: 503, error: "PDF service is unavailable." }
  }
  const printUrl = new URL(input.path, new URL(env.WORKOS_REDIRECT_URI).origin)
  for (const [key, value] of Object.entries(input.searchParams ?? {})) {
    printUrl.searchParams.set(key, value)
  }
  const previewScope = await getProjectAudienceRequestScope()
  if (previewScope) {
    printUrl.searchParams.set("previewProject", previewScope.projectId)
    printUrl.searchParams.set("previewAudience", previewScope.audience)
    if (previewScope.targetUserId) printUrl.searchParams.set("previewAs", previewScope.targetUserId)
  }
  const rendered: unknown = await Reflect.apply(quickAction, env.BROWSER, [
    "pdf",
    {
      url: printUrl.toString(),
      setExtraHTTPHeaders: { Cookie: input.request.headers.get("Cookie") ?? "" },
      gotoOptions: { waitUntil: "networkidle2", timeout: 60_000 },
      waitForSelector: { selector: input.waitForSelector, timeout: 60_000 },
      pdfOptions: {
        format: "letter",
        landscape: input.landscape ?? false,
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: "0", right: "0", bottom: "0", left: "0" },
      },
    },
  ])
  if (!(rendered instanceof Response) || !rendered.ok || !rendered.body) {
    return { ok: false, status: 502, error: "Unable to render PDF." }
  }
  const size = Number(rendered.headers.get("Content-Length") ?? "0")
  if (input.pageNumbers === false || size > PAGE_NUMBER_MAX_BYTES) {
    const pdf = rendered.body
    return { ok: true, pdf, bytes: () => new Response(pdf).arrayBuffer() }
  }
  const numbered = await numberPdfPages(await rendered.arrayBuffer())
  return { ok: true, pdf: new Response(numbered).body ?? new ReadableStream(), bytes: async () => numbered.buffer }
}

/** A PDF shown in the browser's own viewer tab, not downloaded. */
export function inlinePdfResponse(
  pdf: ArrayBuffer | Uint8Array<ArrayBuffer> | ReadableStream<Uint8Array>,
  fileName: string
): Response {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "-")
  return new Response(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${safeName}"`,
      "Cache-Control": "private, no-store",
    },
  })
}
