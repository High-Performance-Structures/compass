import { getCloudflareContext } from "@/lib/db"
import {
  getSagePayApplicationBridgeSecret,
  readBoundedSageBridgeBody,
  verifySageBridgeRequest,
} from "@/lib/sage/bridge-auth"
import { ingestSageTaxCatalog } from "@/lib/sage/tax-catalog-ingest"

function unauthorized(error: string): Response {
  return Response.json({ error }, { status: 401 })
}

export async function POST(request: Request): Promise<Response> {
  const { env } = await getCloudflareContext()
  const secret = getSagePayApplicationBridgeSecret(env)
  if (!secret) {
    return Response.json(
      { error: "Sage bridge is not configured" },
      { status: 503 }
    )
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json(
      { error: "Content-Type must be application/json" },
      { status: 415 }
    )
  }
  const body = await readBoundedSageBridgeBody(request)
  if (!body.success) {
    return Response.json({ error: body.error }, { status: 413 })
  }
  const verification = await verifySageBridgeRequest(
    request,
    secret,
    body.rawBody
  )
  if (!verification.success) return unauthorized(verification.error)

  let parsed: unknown
  try {
    parsed = JSON.parse(body.rawBody)
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const result = await ingestSageTaxCatalog(env, parsed)
  if (!result.success) {
    return Response.json({ error: result.error }, { status: 400 })
  }
  return Response.json(result)
}
