import { PRINT_READY_SELECTOR } from "@/lib/print/print-documents"
import { PRINT_SNAPSHOT_KINDS } from "@/lib/print/snapshot-kinds"
import { loadOwnPrintSnapshot } from "@/lib/print/snapshots"
import { inlinePdfResponse, renderPrintPagePdf } from "@/lib/print/render-pdf"

export async function GET(
  request: Request,
  context: { readonly params: Promise<{ readonly snapshotId: string }> }
): Promise<Response> {
  try {
    const { snapshotId } = await context.params
    const snapshot = await loadOwnPrintSnapshot(snapshotId)
    if (!snapshot) return new Response("Document not found.", { status: 404 })
    const rendered = await renderPrintPagePdf({
      request,
      path: `/print/snapshot/${snapshot.id}/source`,
      waitForSelector: PRINT_READY_SELECTOR,
      landscape: PRINT_SNAPSHOT_KINDS[snapshot.kind].landscape,
    })
    if (!rendered.ok) return new Response(rendered.error, { status: rendered.status })
    return inlinePdfResponse(rendered.pdf, `${snapshot.documentNumber ?? snapshot.title}.pdf`)
  } catch {
    return new Response("Document not found.", { status: 404 })
  }
}
