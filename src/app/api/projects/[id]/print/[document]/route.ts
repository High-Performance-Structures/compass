import { requireAuth } from "@/lib/auth"
import {
  PRINT_DOCUMENTS,
  PRINT_READY_SELECTOR,
  isPrintDocument,
  printDocumentParams,
  printSourcePath,
} from "@/lib/print/print-documents"
import { inlinePdfResponse, renderPrintPagePdf } from "@/lib/print/render-pdf"
import { resolveProjectRouteId } from "@/lib/project-route-id"

/**
 * The PDF for any Print Preview document. The renderer opens the document's
 * print page with the viewer's session, so that page's own access checks apply.
 */
export async function GET(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string; readonly document: string }> }
): Promise<Response> {
  try {
    await requireAuth()
    const { id: rawProjectId, document } = await context.params
    const projectId = await resolveProjectRouteId(rawProjectId)
    if (!projectId || !isPrintDocument(document)) return new Response("Document not found.", { status: 404 })
    const query = new URL(request.url).searchParams
    const params = printDocumentParams(document, Object.fromEntries(query.entries()))
    const rendered = await renderPrintPagePdf({
      request,
      path: printSourcePath(projectId, document),
      searchParams: params,
      waitForSelector: PRINT_READY_SELECTOR,
      landscape: PRINT_DOCUMENTS[document].landscape,
    })
    if (!rendered.ok) return new Response(rendered.error, { status: rendered.status })
    const number = query.get("number") ?? PRINT_DOCUMENTS[document].title
    return inlinePdfResponse(rendered.pdf, `${number}.pdf`)
  } catch {
    return new Response("Document not found.", { status: 404 })
  }
}
