import { getCloudflareContext } from "@/lib/db"
import {
  getJarvisBridgeSecrets,
  getJarvisEnvValue,
  verifyJarvisRequest,
} from "@/lib/jarvis/auth"
import {
  checkCompassSquareAuthentication,
  notifySquareAuthHealth,
  recordSquareAuthObservation,
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
      { error: "Square health monitoring is not configured" },
      { status: 503 }
    )
  const verification = await verifyJarvisRequest(request, secrets, body.rawBody)
  if (!verification.success)
    return Response.json({ error: verification.error }, { status: 401 })
  await recordSquareAuthObservation(
    env,
    organizationId,
    "square-compass-auth",
    await checkCompassSquareAuthentication(env)
  )
  await notifySquareAuthHealth(env, organizationId)
  return Response.json({ success: true })
}
