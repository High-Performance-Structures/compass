import { and, eq, ne } from "drizzle-orm"
import { z } from "zod/v4"

import { sageVendorCertificateSyncs } from "@/db/schema-sage"
import { finishVendorCertificateSync } from "@/lib/domain/sage-bridge/store"
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
  if (!sync) {
    // An exact repeat of a result that already landed (same claim, now finished) is answered as recorded:
    // the writer stops its whole run on any non-2xx answer.
    const recorded = await db
      .select({ status: sageVendorCertificateSyncs.status })
      .from(sageVendorCertificateSyncs)
      .where(and(
        eq(sageVendorCertificateSyncs.id, result.id),
        eq(sageVendorCertificateSyncs.organizationId, organizationId),
        eq(sageVendorCertificateSyncs.claimToken, result.claimToken),
        ne(sageVendorCertificateSyncs.status, "running")
      ))
      .get()
    if (recorded) return Response.json({ success: true, alreadyRecorded: true }, { status: 202 })
    return Response.json({ error: "Certificate claim changed" }, { status: 409 })
  }
  const now = new Date().toISOString()
  // Docs changed while the writer was working: the sync goes round again (decided in the same write).
  const updated = await finishVendorCertificateSync(db, {
    id: sync.id,
    claimToken: result.claimToken,
    outcome: result.outcome === "succeeded" ? "succeeded" : "failed",
    patch: result.outcome === "succeeded"
      ? {
          resultJson: JSON.stringify({ lines: result.lines, supersededLineIds: result.supersededLineIds }),
          errorMessage: null,
          completedAt: now,
          updatedAt: now,
        }
      : { errorMessage: result.error, completedAt: now, updatedAt: now },
  })
  if (updated !== 1) return Response.json({ error: "Certificate claim changed" }, { status: 409 })
  return Response.json({ success: true }, { status: 202 })
}
