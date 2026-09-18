import { getCloudflareContext } from "@/lib/db"
import {
  getJarvisBridgeSecrets,
  getJarvisEnvValue,
  verifyJarvisRequest,
} from "@/lib/jarvis/auth"
import {
  notifySquareAuthHealth,
  recordSquareAuthObservation,
  squareAuthObservationSchema,
} from "@/lib/sage/square-auth-health"
import { readBoundedSquareWebhookBody } from "@/lib/sage/square-webhook-auth"

export async function POST(request: Request): Promise<Response> {
  const body = await readBoundedSquareWebhookBody(request)
  if (!body.success)
    return Response.json({ error: body.error }, { status: 413 })
  const { env } = await getCloudflareContext()
  const secrets = getJarvisBridgeSecrets(env)
  const organizationId = getJarvisEnvValue(env, "SAGE_SQUARE_ORGANIZATION_ID")
  if (!secrets || !organizationId)
    return Response.json(
      { error: "Square health reporting is not configured" },
      { status: 503 }
    )
  const verification = await verifyJarvisRequest(request, secrets, body.rawBody)
  if (!verification.success)
    return Response.json({ error: verification.error }, { status: 401 })
  let value: unknown
  try {
    value = JSON.parse(body.rawBody)
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const parsed = squareAuthObservationSchema.safeParse(value)
  if (!parsed.success)
    return Response.json({ error: "Invalid observation" }, { status: 400 })
  const age = Date.now() - Date.parse(parsed.data.checkedAt)
  if (age > 120_000 || age < -60_000)
    return Response.json({ error: "Expired observation" }, { status: 400 })
  await recordSquareAuthObservation(
    env,
    organizationId,
    "square-invoice-auth",
    parsed.data
  )
  await notifySquareAuthHealth(env, organizationId)
  return Response.json({ success: true })
}
