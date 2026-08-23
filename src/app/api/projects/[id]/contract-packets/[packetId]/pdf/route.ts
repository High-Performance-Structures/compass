import { getProjectContractPacketWorkspace } from "@/app/actions/contract-packets"
import { base64PdfBytes, prepareContractPacketPdf } from "@/lib/contracts/packet-pdf"
import { getCloudflareContext } from "@/lib/db"

async function renderEstimatePdf(input: {
  readonly env: CloudflareEnv
  readonly origin: string
  readonly cookie: string
  readonly projectId: string
  readonly estimateId: string
}): Promise<ArrayBuffer> {
  const quickAction = Reflect.get(input.env.BROWSER, "quickAction")
  if (typeof quickAction !== "function") {
    throw new Error("Cloudflare Browser Run is not available for contract PDFs.")
  }
  const url = new URL(`/print/projects/${input.projectId}/estimate`, input.origin)
  url.searchParams.set("estimateId", input.estimateId)
  const rendered: unknown = await Reflect.apply(quickAction, input.env.BROWSER, [
    "pdf",
    {
      url: url.toString(),
      setExtraHTTPHeaders: { Cookie: input.cookie },
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
    throw new Error("Unable to render the selected CA22 estimate.")
  }
  return rendered.arrayBuffer()
}

export async function GET(
  request: Request,
  context: { readonly params: Promise<{ id: string; packetId: string }> }
): Promise<Response> {
  try {
    const { id, packetId } = await context.params
    const workspace = await getProjectContractPacketWorkspace(id, packetId)
    const packet = workspace.activePacket
    if (!packet || packet.id !== packetId) {
      return Response.json({ success: false, error: "Contract packet not found." }, { status: 404 })
    }
    const estimate = workspace.estimateOptions.find((item) => item.id === packet.estimateId)
    if (!estimate) {
      return Response.json({ success: false, error: "Linked estimate not found." }, { status: 404 })
    }
    const { env } = await getCloudflareContext()
    const estimatePdf = await renderEstimatePdf({
      env,
      origin: new URL(request.url).origin,
      cookie: request.headers.get("cookie") ?? "",
      projectId: id,
      estimateId: estimate.id,
    })
    const prepared = await prepareContractPacketPdf({
      packet,
      documents: workspace.documents,
      estimate,
      projectName: workspace.projectName,
      projectNumber: workspace.projectNumber,
      projectAddress: workspace.projectAddress,
      estimatePdf,
    })
    const bytes = base64PdfBytes(prepared.pdfBase64)
    const body = new Uint8Array(bytes.byteLength)
    body.set(bytes)
    return new Response(body.buffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${packet.packetNumber}-contract-v${packet.versionNumber}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    })
  } catch (error) {
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unable to create contract packet PDF.",
      },
      { status: 500 }
    )
  }
}
