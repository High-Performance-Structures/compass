import { and, eq } from "drizzle-orm"
import { z } from "zod/v4"

import { sageVendorCertificateSyncs } from "@/db/schema-sage"
import { updateVendorCertificateSyncs } from "@/lib/domain/sage-bridge/store"
import { readBoundedSageBridgeBody } from "@/lib/sage/bridge-auth"
import { authorizeVendorCertificateBridge } from "@/lib/sage/vendor-certificate-bridge"

const lineSchema = z.strictObject({
  docTypeId: z.string().min(1).max(40),
  lineId: z.number().int().positive(),
  action: z.enum(["added", "changed", "unchanged"]),
})
const resultSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    outcome: z.literal("succeeded"),
    id: z.uuid(),
    claimToken: z.uuid(),
    lines: z.array(lineSchema).max(30),
    /** Older rows for the same document, set to no warning and no stop by Compass. */
    supersededLineIds: z.array(z.number().int().positive()).max(60),
  }),
  z.strictObject({ outcome: z.literal("failed"), id: z.uuid(), claimToken: z.uuid(), error: z.string().min(1).max(4000) }),
])

/** The Sage writer reports one vendor's certificate sync. */
export async function POST(request: Request): Promise<Response> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ error: "Content-Type must be application/json" }, { status: 415 })
  }
  const body = await readBoundedSageBridgeBody(request)
  if (!body.success) return Response.json({ error: body.error }, { status: 413 })
  const bridge = await authorizeVendorCertificateBridge(request, body.rawBody)
  if (!bridge.success) return bridge.response
  let raw: unknown
  try {
    raw = JSON.parse(body.rawBody)
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const parsed = resultSchema.safeParse(raw)
  if (!parsed.success) return Response.json({ error: "Invalid certificate result" }, { status: 400 })
  const result = parsed.data
  const { db, organizationId } = bridge
  const sync = await db
    .select()
    .from(sageVendorCertificateSyncs)
    .where(
      and(
        eq(sageVendorCertificateSyncs.id, result.id),
        eq(sageVendorCertificateSyncs.organizationId, organizationId),
        eq(sageVendorCertificateSyncs.status, "running"),
        eq(sageVendorCertificateSyncs.claimToken, result.claimToken)
      )
    )
    .get()
  if (!sync) return Response.json({ error: "Certificate claim changed" }, { status: 409 })
  const now = new Date().toISOString()
  // Docs changed while the writer was working: send the vendor round again.
  const changedSince = sync.claimedAt !== null && sync.requestedAt > sync.claimedAt
  const fence = and(eq(sageVendorCertificateSyncs.id, sync.id), eq(sageVendorCertificateSyncs.claimToken, result.claimToken))
  const updated =
    result.outcome === "succeeded"
      ? await updateVendorCertificateSyncs(db, fence, {
          status: changedSince ? "queued" : "succeeded",
          resultJson: JSON.stringify({ lines: result.lines, supersededLineIds: result.supersededLineIds }),
          errorMessage: null,
          completedAt: now,
          updatedAt: now,
        })
      : await updateVendorCertificateSyncs(db, fence, {
          status: changedSince ? "queued" : "failed",
          errorMessage: result.error,
          completedAt: now,
          updatedAt: now,
        })
  if (updated !== 1) return Response.json({ error: "Certificate claim changed" }, { status: 409 })
  return Response.json({ success: true }, { status: 202 })
}
