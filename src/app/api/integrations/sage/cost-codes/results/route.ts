import { z } from "zod/v4"

import { readBoundedSageBridgeBody } from "@/lib/sage/bridge-auth"
import { COST_CODE_READER, authorizeSageChangeOrderBridge } from "@/lib/sage/change-order-bridge"
import { applySageCostCodeSnapshot } from "@/lib/sage/cost-code-sync"

const snapshotSchema = z.strictObject({
  capturedAt: z.iso.datetime({ offset: true }),
  costCodes: z
    .array(
      z.strictObject({
        // dbo.cstcde.recnum, as an integer string.
        recordNumber: z.string().regex(/^\d{1,12}$/),
        // dbo.cstcde.cdenme.
        name: z.string().max(200),
      })
    )
    .min(1)
    .max(5000),
})

/**
 * The read-only Sage reader sends Sage's complete cost code list. Compass
 * adds new codes, updates changed ones in place and marks codes Sage no
 * longer has inactive; a read that looks incomplete changes nothing.
 */
export async function POST(request: Request): Promise<Response> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ error: "Content-Type must be application/json" }, { status: 415 })
  }
  const body = await readBoundedSageBridgeBody(request)
  if (!body.success) return Response.json({ error: body.error }, { status: 413 })
  const bridge = await authorizeSageChangeOrderBridge(request, body.rawBody, COST_CODE_READER)
  if (!bridge.success) return bridge.response
  let raw: unknown
  try {
    raw = JSON.parse(body.rawBody)
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const parsed = snapshotSchema.safeParse(raw)
  if (!parsed.success) return Response.json({ error: "Invalid cost code snapshot" }, { status: 400 })
  const result = await applySageCostCodeSnapshot(bridge.db, bridge.env.DB, parsed.data.costCodes, new Date().toISOString())
  if (!result.success) return Response.json({ error: result.error }, { status: 422 })
  return Response.json({ success: true, ...result.summary })
}
