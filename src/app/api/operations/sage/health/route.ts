import { getCloudflareContext } from "@/lib/db"
import {
  getJarvisBridgeSecrets,
  readBoundedBody,
  verifyJarvisRequest,
} from "@/lib/jarvis/auth"
import { runSageBridgeHealthCheck } from "@/lib/sage/bridge-health"

export async function POST(request: Request): Promise<Response> {
  const body = await readBoundedBody(request)
  if (!body.success) {
    return Response.json({ error: body.error }, { status: 413 })
  }
  const { env } = await getCloudflareContext()
  const secrets = getJarvisBridgeSecrets(env)
  if (!secrets) {
    return Response.json(
      { error: "Maintenance authentication is not configured" },
      { status: 503 }
    )
  }
  const verification = await verifyJarvisRequest(
    request,
    secrets,
    body.rawBody
  )
  if (!verification.success) {
    return Response.json({ error: verification.error }, { status: 401 })
  }

  try {
    const result = await runSageBridgeHealthCheck(env)
    return Response.json({ success: true, ...result })
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Sage bridge health check failed",
      },
      { status: 500 }
    )
  }
}
