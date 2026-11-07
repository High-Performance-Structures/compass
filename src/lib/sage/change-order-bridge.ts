import "server-only"

import { lt } from "drizzle-orm"

import { getDb } from "@/db"
import { sageBridgeRequestNonces } from "@/db/schema-sage"
import { getCloudflareContext } from "@/lib/db"
import { SAGE_BRIDGE_NONCE_RETENTION_MS, sageBridgeCutoff, type SageBridgeHeartbeatId } from "@/lib/domain/sage-bridge/rules"
import {
  deleteSageBridgeRequestNonces,
  insertSageBridgeRequestNonce,
  sageBridgeHeartbeatStatement,
} from "@/lib/domain/sage-bridge/store"
import {
  getSageBridgeSecret,
  getSagePayApplicationBridgeSecret,
  SAGE_BRIDGE_REQUEST_ID_HEADER,
  verifySageBridgeRequest,
} from "@/lib/sage/bridge-auth"
import { sageChangeOrderWritesEnabled } from "@/lib/sage/change-order-write"
import type { Db } from "@/lib/server/action-context"

type CloudflareEnv = Awaited<ReturnType<typeof getCloudflareContext>>["env"]

export type SageChangeOrderBridge =
  | { readonly success: true; readonly env: CloudflareEnv; readonly db: Db; readonly organizationId: string }
  | { readonly success: false; readonly response: Response }

type BridgeKind = {
  /** The Sage writer (writes) uses the writer secret; the read-only reader uses the read-only key. */
  readonly secret: "writer" | "reader"
  readonly heartbeat: SageBridgeHeartbeatId
}

export const CHANGE_ORDER_WRITER: BridgeKind = { secret: "writer", heartbeat: "change-order-writer" }
export const PRIME_CHANGE_ORDER_READER: BridgeKind = { secret: "reader", heartbeat: "prime-change-order-reader" }

function failure(status: number, error: string): SageChangeOrderBridge {
  return { success: false, response: Response.json({ error }, { status }) }
}

/**
 * Checks a signed request for the Sage change order routes: the bridge
 * secret, Compass's switch (writes only), a single-use request id, and the
 * one company the Sage computer serves. Records the caller's heartbeat.
 */
export async function authorizeSageChangeOrderBridge(request: Request, rawBody: string, kind: BridgeKind): Promise<SageChangeOrderBridge> {
  const { env } = await getCloudflareContext()
  const secret = kind.secret === "writer" ? getSageBridgeSecret(env) : getSagePayApplicationBridgeSecret(env)
  if (!secret) return failure(503, "Sage bridge is not configured")
  if (kind.secret === "writer" && !sageChangeOrderWritesEnabled(env)) return failure(503, "Sage change order writes are disabled")
  const organization: unknown = Reflect.get(env, "SAGE_CONTACT_ORGANIZATION_ID")
  if (typeof organization !== "string" || organization.trim().length === 0) return failure(503, "Bridge organization unavailable")
  const verified = await verifySageBridgeRequest(request, secret, rawBody)
  if (!verified.success) return failure(401, verified.error)
  const requestId = request.headers.get(SAGE_BRIDGE_REQUEST_ID_HEADER)
  if (!requestId) return failure(401, "Missing bridge signature")
  const db = getDb(env.DB)
  const now = new Date()
  await deleteSageBridgeRequestNonces(db, lt(sageBridgeRequestNonces.createdAt, sageBridgeCutoff(now, SAGE_BRIDGE_NONCE_RETENTION_MS)))
  try {
    await insertSageBridgeRequestNonce(db, { requestId, route: new URL(request.url).pathname, createdAt: now.toISOString() })
  } catch {
    return failure(409, "Bridge request has already been consumed")
  }
  await sageBridgeHeartbeatStatement(env.DB, kind.heartbeat, now.toISOString()).run()
  return { success: true, env, db, organizationId: organization.trim() }
}
