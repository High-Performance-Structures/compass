import { resolveProjectRouteId } from "@/lib/project-route-id"
import { getProjectEstimateWorkspace } from "@/app/actions/project-estimates"
import { requireAuth } from "@/lib/auth"
import { acceptedEstimateDocumentUrl } from "@/lib/estimates/accepted-document"
import { prepareEstimateSignaturePdf } from "@/lib/estimates/signature-pdf"
import { inlinePdfResponse, renderPrintPagePdf } from "@/lib/print/render-pdf"

export async function GET(
  request: Request,
  context: {
    readonly params: Promise<{
      readonly id: string
      readonly estimateId: string
    }>
  }
): Promise<Response> {
  try {
    await requireAuth()
    const { id: rawProjectId, estimateId } = await context.params
    const projectId = await resolveProjectRouteId(rawProjectId)
    if (!projectId) return new Response("Estimate not found.", { status: 404 })
    const workspace = await getProjectEstimateWorkspace(projectId, estimateId)
    const estimate = workspace.activeEstimate
    if (!estimate || estimate.id !== estimateId) {
      return new Response("Estimate not found.", { status: 404 })
    }
    const acceptedDocumentUrl = acceptedEstimateDocumentUrl(estimate)
    if (acceptedDocumentUrl) {
      return Response.redirect(acceptedDocumentUrl, 307)
    }
    const rendered = await renderPrintPagePdf({
      request,
      path: `/print/projects/${projectId}/estimate`,
      searchParams: { estimateId },
      waitForSelector: ".estimate-signature-page",
    })
    if (!rendered.ok) {
      return new Response(`Estimate: ${rendered.error}`, { status: rendered.status })
    }
    const preparedPdf = await prepareEstimateSignaturePdf({
      pdf: rendered.pdf,
      signerLabels: [
        ...estimate.clientSigners.map((_, index) => `Client ${index + 1}`),
        "Company",
      ],
      corporateSignerIndex: estimate.clientSigners.length,
    })
    const binary = atob(preparedPdf.pdfBase64)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    return inlinePdfResponse(bytes, `${estimate.estimateNumber}-v${estimate.versionNumber}.pdf`)
  } catch {
    return new Response("Estimate not found.", { status: 404 })
  }
}
