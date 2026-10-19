import { getCloudflareContext } from "@/lib/db"

export type PrintPdfRequest = {
  /** The incoming request; its cookie lets the renderer open the print page. */
  readonly request: Request
  /** App path of the print page, e.g. /print/projects/<id>/estimate. */
  readonly path: string
  readonly searchParams?: Readonly<Record<string, string>>
  /** Rendering waits for this selector so the PDF has the whole document. */
  readonly waitForSelector: string
  readonly landscape?: boolean
}

export type PrintPdfResult =
  | { readonly ok: true; readonly pdf: ArrayBuffer }
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
  if (!(rendered instanceof Response) || !rendered.ok) {
    return { ok: false, status: 502, error: "Unable to render PDF." }
  }
  return { ok: true, pdf: await rendered.arrayBuffer() }
}

/** A PDF shown in the browser's own viewer tab, not downloaded. */
export function inlinePdfResponse(pdf: ArrayBuffer | Uint8Array<ArrayBuffer>, fileName: string): Response {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "-")
  return new Response(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${safeName}"`,
      "Cache-Control": "private, no-store",
    },
  })
}
