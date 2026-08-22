import { and, eq, ne } from "drizzle-orm"

import { getDb } from "@/db"
import { projectEstimates } from "@/db/schema-estimates"
import { getCloudflareContext } from "@/lib/db"
import { rebuildProjectContractBudget } from "@/lib/financials/contract-budget-store"
import { verifyFoxitWebhook } from "@/lib/foxit/esign"

function objectValue(value: unknown): object | null {
  return value && typeof value === "object" ? value : null
}

function nestedString(value: unknown, keys: readonly string[]): string | null {
  const object = objectValue(value)
  if (!object) return null
  for (const key of keys) {
    const item = Reflect.get(object, key)
    if (typeof item === "string" || typeof item === "number") return String(item)
  }
  for (const key of ["folder", "data", "payload", "eventData"]) {
    const nested = Reflect.get(object, key)
    const found = nestedString(nested, keys)
    if (found) return found
  }
  return null
}

export async function POST(request: Request): Promise<Response> {
  const { env } = await getCloudflareContext()
  const signature = (new URL(request.url).searchParams.get("signature") ?? "")
    .replaceAll(" ", "+")
  const body = new Uint8Array(await request.arrayBuffer())
  if (
    !env.FOXIT_ESIGN_WEBHOOK_SECRET ||
    !signature ||
    !(await verifyFoxitWebhook({
      secret: env.FOXIT_ESIGN_WEBHOOK_SECRET,
      body,
      signature,
    }))
  ) {
    return Response.json({ success: false, error: "Invalid signature." }, { status: 401 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(new TextDecoder().decode(body))
  } catch {
    return Response.json({ success: false, error: "Invalid JSON." }, { status: 400 })
  }
  const event = nestedString(payload, ["event_name", "event", "eventType", "type"])
  const envelopeId = nestedString(payload, ["folderId", "folder_id", "envelopeId"])
  if (!event || !envelopeId) {
    return Response.json({ success: true, ignored: true })
  }
  const db = getDb(env.DB)
  const rows = await db
    .select()
    .from(projectEstimates)
    .where(eq(projectEstimates.foxitEnvelopeId, envelopeId))
    .limit(1)
  const estimate = rows[0]
  if (!estimate) return Response.json({ success: true, ignored: true })

  const now = new Date().toISOString()
  if (event === "folder_sent") {
    if (estimate.status === "draft" || estimate.status === "internal_review") {
      await db
        .update(projectEstimates)
        .set({
          status: "signature_pending",
          foxitStatus: "sent",
          signatureRequestedAt: now,
          sourceHash: estimate.foxitPreparedSourceHash,
          foxitEmbeddedSessionUrl: null,
          updatedAt: now,
        })
        .where(eq(projectEstimates.id, estimate.id))
        .run()
    }
    return Response.json({ success: true })
  }

  if (event === "folder_cancelled" || event === "folder_declined") {
    await db
      .update(projectEstimates)
      .set({ foxitStatus: event.replace("folder_", ""), updatedAt: now })
      .where(eq(projectEstimates.id, estimate.id))
      .run()
    return Response.json({ success: true })
  }

  if (
    event !== "folder_executed" ||
    (estimate.status !== "signature_pending" && estimate.status !== "accepted")
  ) {
    return Response.json({ success: true, ignored: true })
  }

  if (estimate.status === "signature_pending") {
    await db.batch([
      db
        .update(projectEstimates)
        .set({ status: "superseded", updatedAt: now })
        .where(
          and(
            eq(projectEstimates.projectId, estimate.projectId),
            eq(projectEstimates.status, "accepted"),
            ne(projectEstimates.id, estimate.id)
          )
        ),
      db
        .update(projectEstimates)
        .set({
          status: "accepted",
          foxitStatus: "completed",
          signaturePackageUrl: `/api/integrations/foxit/envelopes/${encodeURIComponent(envelopeId)}/document`,
          signedAt: now,
          acceptanceMethod: "foxit",
          acceptanceEvidenceLabel: "Completed Foxit estimate",
          acceptanceRecordedByName: "Foxit eSign",
          acceptedAt: now,
          acceptedBy: estimate.createdBy,
          sageStatus: "ready",
          updatedAt: now,
        })
        .where(eq(projectEstimates.id, estimate.id)),
    ])
  }
  const budget = await rebuildProjectContractBudget({
    db,
    projectId: estimate.projectId,
    actorUserId: estimate.createdBy,
  })
  if (!budget.success) {
    return Response.json({ success: false, error: budget.error }, { status: 500 })
  }
  return Response.json({ success: true })
}
