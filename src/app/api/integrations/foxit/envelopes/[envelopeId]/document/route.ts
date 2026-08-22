import { eq } from "drizzle-orm"

import { getDb } from "@/db"
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
    const rows = await db
      .select({
        projectId: projectEstimates.projectId,
        estimateNumber: projectEstimates.estimateNumber,
        versionNumber: projectEstimates.versionNumber,
        foxitStatus: projectEstimates.foxitStatus,
      })
      .from(projectEstimates)
      .where(eq(projectEstimates.foxitEnvelopeId, envelopeId))
      .limit(1)
    const estimate = rows[0]
    if (!estimate || estimate.foxitStatus !== "completed") {
      return new Response("Executed estimate not found.", { status: 404 })
    }
    await assertProjectAccess(db, user, estimate.projectId)
    const foxit = await downloadFoxitExecutedEnvelope({
      clientId: env.FOXIT_ESIGN_CLIENT_ID,
      clientSecret: env.FOXIT_ESIGN_CLIENT_SECRET,
      envelopeId,
    })
    if (!foxit.ok || !foxit.body) {
      return new Response("Executed estimate is temporarily unavailable.", {
        status: 502,
      })
    }
    const fileName = `${estimate.estimateNumber}-v${estimate.versionNumber}-executed.pdf`
      .replace(/[^a-zA-Z0-9._-]/g, "-")
    return new Response(foxit.body, {
      headers: {
        "Content-Type": foxit.headers.get("Content-Type") ?? "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
      },
    })
  } catch {
    return new Response("Executed estimate not found.", { status: 404 })
  }
}
