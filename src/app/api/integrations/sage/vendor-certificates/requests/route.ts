import { and, asc, eq, lt, max, or } from "drizzle-orm"

import { sageVendorCertificateSyncs, sageVendorDirectoryEntries } from "@/db/schema-sage"
import { claimVendorCertificateSync, updateVendorCertificateSyncs } from "@/lib/domain/sage-bridge/store"
import { sageBridgeBatchLimit, sageBridgeCutoff } from "@/lib/domain/sage-bridge/rules"
import { sageBridgeHeartbeatStatement } from "@/lib/domain/sage-bridge/store"
import { authorizeVendorCertificateBridge } from "@/lib/sage/vendor-certificate-bridge"
import { buildVendorCertificatePayload } from "@/lib/sage/vendor-certificates"

const MAX_BATCH = 10
const CLAIM_RETRY_MILLISECONDS = 10 * 60 * 1000
/** Sage's vendor list is sent again once a day, so new Sage vendors can be linked. */
const DIRECTORY_REFRESH_MILLISECONDS = 24 * 60 * 60 * 1000

/**
 * The Sage writer's poll: claims up to `limit` vendors whose certificates
 * need syncing, each with the rows built from their trade docs right now,
 * and says whether Compass wants a fresh copy of Sage's vendor list.
 */
export async function GET(request: Request): Promise<Response> {
  const bridge = await authorizeVendorCertificateBridge(request, "")
  if (!bridge.success) return bridge.response
  const { db, env, organizationId } = bridge
  const now = new Date()
  const nowIso = now.toISOString()
  await sageBridgeHeartbeatStatement(env.DB, "vendor-certificate-writer", nowIso).run()

  const latest = await db
    .select({ capturedAt: max(sageVendorDirectoryEntries.capturedAt) })
    .from(sageVendorDirectoryEntries)
    .where(eq(sageVendorDirectoryEntries.organizationId, organizationId))
    .get()
  const directoryWanted = !latest?.capturedAt || latest.capturedAt < sageBridgeCutoff(now, DIRECTORY_REFRESH_MILLISECONDS)

  const staleBefore = sageBridgeCutoff(now, CLAIM_RETRY_MILLISECONDS)
  const limit = sageBridgeBatchLimit(new URL(request.url).searchParams.get("limit"), 5, MAX_BATCH)
  const candidates = await db
    .select({ id: sageVendorCertificateSyncs.id, vendorId: sageVendorCertificateSyncs.vendorId })
    .from(sageVendorCertificateSyncs)
    .where(
      and(
        eq(sageVendorCertificateSyncs.organizationId, organizationId),
        or(
          eq(sageVendorCertificateSyncs.status, "queued"),
          and(eq(sageVendorCertificateSyncs.status, "running"), lt(sageVendorCertificateSyncs.claimedAt, staleBefore))
        )
      )
    )
    .orderBy(asc(sageVendorCertificateSyncs.requestedAt))
    .limit(limit)

  const today = nowIso.slice(0, 10)
  const requests: unknown[] = []
  // At most MAX_BATCH claims per poll, each fenced on its own row.
  for (const candidate of candidates) {
    const claimToken = crypto.randomUUID()
    if (!(await claimVendorCertificateSync(db, candidate.id, claimToken, nowIso, staleBefore))) continue
    const built = await buildVendorCertificatePayload(db, organizationId, candidate.vendorId, today)
    const fence = and(eq(sageVendorCertificateSyncs.id, candidate.id), eq(sageVendorCertificateSyncs.claimToken, claimToken))
    if (!built.success) {
      await updateVendorCertificateSyncs(db, fence, { status: "failed", errorMessage: built.error, completedAt: nowIso, updatedAt: nowIso })
      continue
    }
    await updateVendorCertificateSyncs(db, fence, { status: "running", payloadJson: JSON.stringify(built.payload), errorMessage: null, updatedAt: nowIso })
    requests.push({ id: candidate.id, claimToken, payload: built.payload })
  }
  return Response.json({ organizationId, directoryWanted, requests })
}
