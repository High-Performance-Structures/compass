import { z } from "zod/v4"

import { replaceSageVendorDirectory } from "@/lib/domain/sage-bridge/store"
import { readBoundedSageBridgeBody } from "@/lib/sage/bridge-auth"
import { applySageVendorDirectory } from "@/lib/sage/vendor-directory-sync"
import { authorizeVendorCertificateBridge } from "@/lib/sage/vendor-certificate-bridge"

const MAX_DIRECTORY_BYTES = 4 * 1024 * 1024
const sageText = (max: number) => z.string().max(max).nullable().transform((value) => value?.trim() || null)
/** Sent by writers new enough to read it; older writers send names and emails only. */
const detailsSchema = z.strictObject({
  ownerName: sageText(100),
  addressLine1: sageText(100),
  addressLine2: sageText(100),
  city: sageText(100),
  state: sageText(10),
  postalCode: sageText(20),
  phone: sageText(30),
  vendorType: sageText(100),
})
const entrySchema = z.strictObject({
  sageRecordId: z.guid(),
  sageVendorNumber: z.string().regex(/^[1-9]\d{0,9}$/),
  name: z.string().trim().min(1).max(200),
  email: z.string().max(255).nullable(),
  details: detailsSchema.optional(),
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
  const rows = entries.map((entry) => ({
    ...entry,
    sageRecordId: entry.sageRecordId.toLowerCase(),
    email: entry.email?.trim() || null,
    details: entry.details ?? null,
  }))
  const now = new Date().toISOString()
  await replaceSageVendorDirectory(bridge.db, bridge.organizationId, rows, now)
  // Linked vendors take Sage's changes; this never fails the stored list.
  const { updated } = await applySageVendorDirectory(bridge.db, bridge.organizationId, rows, now)
  return Response.json({ success: true, count: entries.length, updated }, { status: 202 })
}
