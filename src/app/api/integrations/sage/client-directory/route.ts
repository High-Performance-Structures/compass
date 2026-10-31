import { and, asc, eq, lt, or } from "drizzle-orm"
import { z } from "zod/v4"

import { getDb } from "@/db"
import { sageBridgeRequestNonces, sageClientDirectoryRefreshes } from "@/db/schema-sage"
import { getCloudflareContext } from "@/lib/db"
import { SAGE_BRIDGE_NONCE_RETENTION_MS, sageBridgeCutoff } from "@/lib/domain/sage-bridge/rules"
import {
  deleteSageBridgeRequestNonces,
  insertSageBridgeRequestNonce,
  sageClientDirectoryReplaceStatements,
  updateSageClientDirectoryRefreshes,
} from "@/lib/domain/sage-bridge/store"
import {
  getSageContactBridgeSecret, readBoundedSageBridgeBody,
  SAGE_BRIDGE_REQUEST_ID_HEADER, verifySageBridgeRequest,
} from "@/lib/sage/bridge-auth"
import { sageContactOrganizationMatches } from "@/lib/sage/contact-bridge"

const STALE_CLAIM_MS = 10 * 60 * 1000
const MAX_DIRECTORY_RESULT_BYTES = 4 * 1024 * 1024
const DIRECTORY_INSERT_CHUNK = 500
const entrySchema = z.strictObject({
  sageRecordId: z.guid(),
  sageClientNumber: z.string().regex(/^[1-9]\d{0,9}$/),
  name: z.string().trim().min(1).max(200),
  email: z.string().max(255).nullable(),
})
const resultSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    outcome: z.literal("succeeded"), id: z.uuid(), claimToken: z.uuid(),
    organizationId: z.string().min(1), entries: z.array(entrySchema).min(1).max(5000),
  }),
  z.strictObject({
    outcome: z.literal("failed"), id: z.uuid(), claimToken: z.uuid(),
    organizationId: z.string().min(1), error: z.string().min(1).max(1000),
  }),
])

async function authorize(request: Request, rawBody: string): Promise<
  | { readonly success: true; readonly env: Awaited<ReturnType<typeof getCloudflareContext>>["env"] }
  | { readonly success: false; readonly response: Response }
> {
  const { env } = await getCloudflareContext()
  const secret = getSageContactBridgeSecret(env)
  if (!secret) return { success: false, response: Response.json({ error: "Bridge unavailable" }, { status: 503 }) }
  const verified = await verifySageBridgeRequest(request, secret, rawBody)
  if (!verified.success) return { success: false, response: Response.json({ error: verified.error }, { status: 401 }) }
  const requestId = request.headers.get(SAGE_BRIDGE_REQUEST_ID_HEADER)
  if (!requestId) return { success: false, response: Response.json({ error: "Missing request ID" }, { status: 401 }) }
  const db = getDb(env.DB)
  const now = new Date()
  await deleteSageBridgeRequestNonces(db, lt(sageBridgeRequestNonces.createdAt,
    sageBridgeCutoff(now, SAGE_BRIDGE_NONCE_RETENTION_MS)))
  try {
    await insertSageBridgeRequestNonce(db, { requestId, route: new URL(request.url).pathname, createdAt: now.toISOString() })
  } catch {
    return { success: false, response: Response.json({ error: "Bridge request already consumed" }, { status: 409 }) }
  }
  return { success: true, env }
}

export async function GET(request: Request): Promise<Response> {
  const auth = await authorize(request, "")
  if (!auth.success) return auth.response
  const configuredOrg: unknown = Reflect.get(auth.env, "SAGE_CONTACT_ORGANIZATION_ID")
  if (typeof configuredOrg !== "string" || !sageContactOrganizationMatches(auth.env, configuredOrg)) {
    return Response.json({ error: "Bridge organization unavailable" }, { status: 503 })
  }
  const db = getDb(auth.env.DB)
  const stale = new Date(Date.now() - STALE_CLAIM_MS).toISOString()
  const candidate = await db.select().from(sageClientDirectoryRefreshes).where(and(
    eq(sageClientDirectoryRefreshes.organizationId, configuredOrg),
    or(eq(sageClientDirectoryRefreshes.status, "queued"), and(
      eq(sageClientDirectoryRefreshes.status, "running"), lt(sageClientDirectoryRefreshes.claimedAt, stale)
    ))
  )).orderBy(asc(sageClientDirectoryRefreshes.requestedAt)).get()
  if (!candidate) return Response.json({ refresh: null })
  const token = crypto.randomUUID()
  const claimed = await updateSageClientDirectoryRefreshes(db, { status: "running", claimToken: token, claimedAt: new Date().toISOString() },
    and(eq(sageClientDirectoryRefreshes.id, candidate.id), eq(sageClientDirectoryRefreshes.organizationId, configuredOrg),
      eq(sageClientDirectoryRefreshes.status, candidate.status),
      candidate.status === "running" ? lt(sageClientDirectoryRefreshes.claimedAt, stale) : eq(sageClientDirectoryRefreshes.requestedAt, candidate.requestedAt)))
    .returning({ id: sageClientDirectoryRefreshes.id })
  return Response.json({ refresh: claimed.length === 1 ? { id: candidate.id, claimToken: token, organizationId: configuredOrg } : null })
}

export async function POST(request: Request): Promise<Response> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ error: "Content-Type must be application/json" }, { status: 415 })
  }
  const body = await readBoundedSageBridgeBody(request, MAX_DIRECTORY_RESULT_BYTES)
  if (!body.success) return Response.json({ error: body.error }, { status: 413 })
  const auth = await authorize(request, body.rawBody)
  if (!auth.success) return auth.response
  let raw: unknown
  try { raw = JSON.parse(body.rawBody) } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }) }
  const parsed = resultSchema.safeParse(raw)
  if (!parsed.success) return Response.json({ error: "Invalid directory result" }, { status: 400 })
  const result = parsed.data
  if (!sageContactOrganizationMatches(auth.env, result.organizationId)) {
    return Response.json({ error: "Wrong organization" }, { status: 403 })
  }
  const db = getDb(auth.env.DB)
  const claim = await db.select().from(sageClientDirectoryRefreshes).where(and(
    eq(sageClientDirectoryRefreshes.id, result.id),
    eq(sageClientDirectoryRefreshes.organizationId, result.organizationId),
    eq(sageClientDirectoryRefreshes.status, "running"),
    eq(sageClientDirectoryRefreshes.claimToken, result.claimToken)
  )).get()
  if (!claim) return Response.json({ error: "Directory claim changed" }, { status: 409 })
  const now = new Date().toISOString()
  if (result.outcome === "failed") {
    const failed = await updateSageClientDirectoryRefreshes(db, { status: "failed", errorMessage: result.error, completedAt: now },
      and(eq(sageClientDirectoryRefreshes.id, claim.id),
        eq(sageClientDirectoryRefreshes.organizationId, result.organizationId),
        eq(sageClientDirectoryRefreshes.status, "running"),
        eq(sageClientDirectoryRefreshes.claimToken, result.claimToken))).returning({ id: sageClientDirectoryRefreshes.id })
    if (failed.length !== 1) return Response.json({ error: "Directory claim changed" }, { status: 409 })
    return Response.json({ success: true, status: "failed" }, { status: 202 })
  }
  const ids = new Set(result.entries.map((entry) => entry.sageRecordId.toLowerCase()))
  const numbers = new Set(result.entries.map((entry) => entry.sageClientNumber))
  if (ids.size !== result.entries.length || numbers.size !== result.entries.length) {
    await updateSageClientDirectoryRefreshes(db, { status: "failed",
      errorMessage: "Duplicate Sage identity in directory result; prior snapshot preserved.", completedAt: now },
      and(eq(sageClientDirectoryRefreshes.id, claim.id),
        eq(sageClientDirectoryRefreshes.organizationId, result.organizationId),
        eq(sageClientDirectoryRefreshes.status, "running"),
        eq(sageClientDirectoryRefreshes.claimToken, result.claimToken)))
    return Response.json({ error: "Duplicate Sage identity in directory result" }, { status: 400 })
  }
  const normalized = result.entries.map((entry) => ({ ...entry, name: entry.name.trim() }))
  const chunks: string[] = []
  for (let offset = 0; offset < normalized.length; offset += DIRECTORY_INSERT_CHUNK) {
    chunks.push(JSON.stringify(normalized.slice(offset, offset + DIRECTORY_INSERT_CHUNK)))
  }
  const statements = await auth.env.DB.batch(sageClientDirectoryReplaceStatements(auth.env.DB, {
    refreshId: claim.id, organizationId: result.organizationId, claimToken: result.claimToken, now,
  }, chunks))
  if (statements[statements.length - 1]?.meta.changes !== 1) return Response.json({ error: "Directory claim changed" }, { status: 409 })
  return Response.json({ success: true, status: "succeeded", count: normalized.length }, { status: 202 })
}
