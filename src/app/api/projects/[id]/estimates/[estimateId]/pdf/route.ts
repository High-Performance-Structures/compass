import { getProjectEstimateWorkspace } from "@/app/actions/project-estimates"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { prepareEstimateSignaturePdf } from "@/lib/estimates/signature-pdf"

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
    const { id: projectId, estimateId } = await context.params
    const workspace = await getProjectEstimateWorkspace(projectId, estimateId)
    const estimate = workspace.activeEstimate
    if (!estimate || estimate.id !== estimateId) {
      return new Response("Estimate not found.", { status: 404 })
    }
    const { env } = await getCloudflareContext()
    const quickAction = Reflect.get(env.BROWSER, "quickAction")
    if (typeof quickAction !== "function") {
      return new Response("Estimate PDF service is unavailable.", { status: 503 })
    }
    const origin = new URL(env.WORKOS_REDIRECT_URI).origin
    const printUrl = new URL(`/print/projects/${projectId}/estimate`, origin)
    printUrl.searchParams.set("estimateId", estimateId)
    const rendered: unknown = await Reflect.apply(quickAction, env.BROWSER, [
      "pdf",
      {
        url: printUrl.toString(),
        setExtraHTTPHeaders: { Cookie: request.headers.get("Cookie") ?? "" },
        gotoOptions: { waitUntil: "networkidle2", timeout: 60_000 },
        waitForSelector: { selector: ".estimate-signature-page", timeout: 60_000 },
        pdfOptions: {
          format: "letter",
          printBackground: true,
          preferCSSPageSize: true,
          margin: { top: "0", right: "0", bottom: "0", left: "0" },
        },
      },
    ])
    if (!(rendered instanceof Response) || !rendered.ok) {
      return new Response("Unable to render estimate PDF.", { status: 502 })
    }
    const preparedPdf = await prepareEstimateSignaturePdf({
      pdf: await rendered.arrayBuffer(),
      signerLabels: [
        ...estimate.clientSigners.map((_, index) => `Client ${index + 1}`),
        "Company",
      ],
    })
    const binary = atob(preparedPdf.pdfBase64)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    const fileName = `${estimate.estimateNumber}-v${estimate.versionNumber}.pdf`
      .replace(/[^a-zA-Z0-9._-]/g, "-")
    return new Response(bytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
      },
    })
  } catch {
    return new Response("Estimate not found.", { status: 404 })
  }
}
