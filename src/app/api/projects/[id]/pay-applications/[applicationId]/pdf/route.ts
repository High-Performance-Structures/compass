import { getProjectOwnerPayApplicationReport } from "@/app/actions/project-financial-workflows"
import { requireAuth } from "@/lib/auth"
import { inlinePdfResponse, renderPrintPagePdf } from "@/lib/print/render-pdf"
import { resolveProjectRouteId } from "@/lib/project-route-id"

export async function GET(
  request: Request,
  context: {
    readonly params: Promise<{
      readonly id: string
      readonly applicationId: string
    }>
  }
): Promise<Response> {
  try {
    await requireAuth()
    const { id: rawProjectId, applicationId } = await context.params
    const projectId = await resolveProjectRouteId(rawProjectId)
    if (!projectId) return new Response("Pay application not found.", { status: 404 })
    const report = await getProjectOwnerPayApplicationReport(projectId, applicationId)
    if (!report) return new Response("Pay application not found.", { status: 404 })
    const rendered = await renderPrintPagePdf({
      request,
      path: `/print/projects/${projectId}/pay-application`,
      searchParams: { applicationId },
      waitForSelector: ".pay-app-g703-page",
      landscape: true,
    })
    if (!rendered.ok) {
      return new Response(`Pay application: ${rendered.error}`, { status: rendered.status })
    }
    const number = report.draft.applicationNumber.padStart(2, "0")
    return inlinePdfResponse(rendered.pdf, `${report.project.projectNumber ?? "Project"}-PayApp-${number}.pdf`)
  } catch {
    return new Response("Pay application not found.", { status: 404 })
  }
}
