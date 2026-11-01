import "server-only"

import { lt } from "drizzle-orm"

import { getDb } from "@/db"
import { sageBridgeRequestNonces } from "@/db/schema-sage"
import { getCloudflareContext } from "@/lib/db"
import { SAGE_BRIDGE_NONCE_RETENTION_MS, sageBridgeCutoff } from "@/lib/domain/sage-bridge/rules"
import { deleteSageBridgeRequestNonces, insertSageBridgeRequestNonce } from "@/lib/domain/sage-bridge/store"
import { getSageBridgeSecret, SAGE_BRIDGE_REQUEST_ID_HEADER, verifySageBridgeRequest } from "@/lib/sage/bridge-auth"
import { sageVendorCertificateWritesEnabled } from "@/lib/sage/vendor-certificates"
import type { Db } from "@/lib/server/action-context"

type CloudflareEnv = Awaited<ReturnType<typeof getCloudflareContext>>["env"]

export type VendorCertificateBridge =
  | { readonly success: true; readonly env: CloudflareEnv; readonly db: Db; readonly organizationId: string }
  | { readonly success: false; readonly response: Response }

/**
 * Checks a signed request from the Sage writer for the vendor certificate
 * routes: the bridge secret, Compass's switch, a single-use request id, and
 * the one company this Sage computer serves.
 */
export async function authorizeVendorCertificateBridge(request: Request, rawBody: string): Promise<VendorCertificateBridge> {
  const { env } = await getCloudflareContext()
  const secret = getSageBridgeSecret(env)
  if (!secret) return { success: false, response: Response.json({ error: "Sage bridge is not configured" }, { status: 503 }) }
  if (!sageVendorCertificateWritesEnabled(env)) {
    return { success: false, response: Response.json({ error: "Sage vendor certificate writes are disabled" }, { status: 503 }) }
  }
  const organization: unknown = Reflect.get(env, "SAGE_CONTACT_ORGANIZATION_ID")
  if (typeof organization !== "string" || organization.trim().length === 0) {
    return { success: false, response: Response.json({ error: "Bridge organization unavailable" }, { status: 503 }) }
  }
  const verified = await verifySageBridgeRequest(request, secret, rawBody)
  if (!verified.success) return { success: false, response: Response.json({ error: verified.error }, { status: 401 }) }
  const requestId = request.headers.get(SAGE_BRIDGE_REQUEST_ID_HEADER)
  if (!requestId) return { success: false, response: Response.json({ error: "Missing bridge signature" }, { status: 401 }) }
  const db = getDb(env.DB)
  const now = new Date()
  await deleteSageBridgeRequestNonces(db, lt(sageBridgeRequestNonces.createdAt, sageBridgeCutoff(now, SAGE_BRIDGE_NONCE_RETENTION_MS)))
  try {
    await insertSageBridgeRequestNonce(db, { requestId, route: new URL(request.url).pathname, createdAt: now.toISOString() })
  } catch {
    return { success: false, response: Response.json({ error: "Bridge request has already been consumed" }, { status: 409 }) }
  }
  return { success: true, env, db, organizationId: organization.trim() }
}
