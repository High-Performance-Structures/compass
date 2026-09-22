import { eq } from "drizzle-orm"

import { getDb } from "@/db"
import { contractPackets } from "@/db/schema-contracts"
import { projectEstimates } from "@/db/schema-estimates"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { downloadFoxitExecutedEnvelope } from "@/lib/foxit/esign"
import { assertProjectAccess } from "@/lib/project-access"

export async function GET(
  _request: Request,
  context: { readonly params: Promise<{ readonly envelopeId: string }> }
): Promise<Response> {
  try {
    const user = await requireAuth()
    const { envelopeId } = await context.params
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const estimateRows = await db
      .select({
        projectId: projectEstimates.projectId,
        estimateNumber: projectEstimates.estimateNumber,
        versionNumber: projectEstimates.versionNumber,
        foxitStatus: projectEstimates.foxitStatus,
      })
      .from(projectEstimates)
      .where(eq(projectEstimates.foxitEnvelopeId, envelopeId))
      .limit(1)
    const estimate = estimateRows[0]
    const packetRows = estimate
      ? []
      : await db
          .select({
            projectId: contractPackets.projectId,
            packetNumber: contractPackets.packetNumber,
            versionNumber: contractPackets.versionNumber,
            foxitStatus: contractPackets.foxitStatus,
          })
          .from(contractPackets)
          .where(eq(contractPackets.foxitEnvelopeId, envelopeId))
          .limit(1)
    const packet = packetRows[0]
    const executedDocument =
      estimate?.foxitStatus === "completed"
        ? {
            projectId: estimate.projectId,
            fileName: `${estimate.estimateNumber}-v${estimate.versionNumber}-executed.pdf`,
          }
        : packet?.foxitStatus === "completed"
          ? {
              projectId: packet.projectId,
              fileName: `${packet.packetNumber}-contract-v${packet.versionNumber}-executed.pdf`,
            }
          : null
    if (!executedDocument) {
      return new Response("Executed contract document not found.", { status: 404 })
    }
    await assertProjectAccess(db, user, executedDocument.projectId)
    const foxit = await downloadFoxitExecutedEnvelope({
      clientId: env.FOXIT_ESIGN_CLIENT_ID,
      clientSecret: env.FOXIT_ESIGN_CLIENT_SECRET,
      envelopeId,
    })
    if (!foxit.ok || !foxit.body) {
      return new Response("Executed contract document is temporarily unavailable.", {
        status: 502,
      })
    }
    const fileName = executedDocument.fileName.replace(/[^a-zA-Z0-9._-]/g, "-")
    return new Response(foxit.body, {
      headers: {
        "Content-Type": foxit.headers.get("Content-Type") ?? "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
      },
    })
  } catch {
    return new Response("Executed contract document not found.", { status: 404 })
  }
}
