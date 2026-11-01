import { z } from "zod/v4"

import { replaceSageVendorDirectory } from "@/lib/domain/sage-bridge/store"
import { readBoundedSageBridgeBody } from "@/lib/sage/bridge-auth"
import { authorizeVendorCertificateBridge } from "@/lib/sage/vendor-certificate-bridge"

const MAX_DIRECTORY_BYTES = 4 * 1024 * 1024
const entrySchema = z.strictObject({
  sageRecordId: z.guid(),
  sageVendorNumber: z.string().regex(/^[1-9]\d{0,9}$/),
  name: z.string().trim().min(1).max(200),
  email: z.string().max(255).nullable(),
})
const directorySchema = z.strictObject({ organizationId: z.string().min(1), entries: z.array(entrySchema).min(1).max(5000) })

/** The Sage writer sends Sage's vendor list; it replaces Compass's copy whole. */
export async function POST(request: Request): Promise<Response> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ error: "Content-Type must be application/json" }, { status: 415 })
  }
  const body = await readBoundedSageBridgeBody(request, MAX_DIRECTORY_BYTES)
  if (!body.success) return Response.json({ error: body.error }, { status: 413 })
  const bridge = await authorizeVendorCertificateBridge(request, body.rawBody)
  if (!bridge.success) return bridge.response
  let raw: unknown
  try {
    raw = JSON.parse(body.rawBody)
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const parsed = directorySchema.safeParse(raw)
  if (!parsed.success) return Response.json({ error: "Invalid vendor directory" }, { status: 400 })
  if (parsed.data.organizationId !== bridge.organizationId) return Response.json({ error: "Wrong organization" }, { status: 403 })
  const entries = parsed.data.entries
  const ids = new Set(entries.map((entry) => entry.sageRecordId.toLowerCase()))
  const numbers = new Set(entries.map((entry) => entry.sageVendorNumber))
  if (ids.size !== entries.length || numbers.size !== entries.length) {
    return Response.json({ error: "Duplicate Sage vendor in the directory" }, { status: 400 })
  }
  await replaceSageVendorDirectory(
    bridge.db,
    bridge.organizationId,
    entries.map((entry) => ({ ...entry, sageRecordId: entry.sageRecordId.toLowerCase(), email: entry.email?.trim() || null })),
    new Date().toISOString()
  )
  return Response.json({ success: true, count: entries.length }, { status: 202 })
}
