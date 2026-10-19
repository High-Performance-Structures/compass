import { getProjectEstimateWorkspace } from "@/app/actions/project-estimates"
import { getDb } from "@/db"
import { serveSignedDocument } from "@/lib/contracts/serve-signed-document"
import { getCloudflareContext } from "@/lib/db"
import { acceptedEstimateDocumentUrl } from "@/lib/estimates/accepted-document"
import { resolveProjectRouteId } from "@/lib/project-route-id"

/** The signed document for an accepted estimate, shown inline for Print Preview. */
export async function GET(
  _request: Request,
  context: { readonly params: Promise<{ readonly id: string; readonly estimateId: string }> }
): Promise<Response> {
  try {
    const { id: rawProjectId, estimateId } = await context.params
    const projectId = await resolveProjectRouteId(rawProjectId)
    if (!projectId) return new Response("Accepted estimate not found", { status: 404 })
    // The estimate workspace read checks the viewer's access.
    const estimate = (await getProjectEstimateWorkspace(projectId, estimateId)).activeEstimate
    const documentUrl = estimate && estimate.id === estimateId ? acceptedEstimateDocumentUrl(estimate) : null
    if (!estimate || !documentUrl) return new Response("Accepted estimate not found", { status: 404 })
    const { env } = await getCloudflareContext()
    return serveSignedDocument({
      db: getDb(env.DB),
      env,
      projectId,
      documentUrl,
      foxitEnvelopeId: estimate.foxitEnvelopeId,
      fileName: `${estimate.estimateNumber}-accepted.pdf`.replace(/[^a-zA-Z0-9._-]/g, "-"),
      label: "Accepted estimate",
    })
  } catch {
    return new Response("Accepted estimate not found", { status: 404 })
  }
}
