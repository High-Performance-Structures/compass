import { getCloudflareContext } from "@/lib/db"
import {
  getJarvisEnvValue,
  readBoundedBody,
  verifyJarvisRequest,
} from "@/lib/jarvis/auth"
import { runFeedbackMaintenance } from "@/lib/jarvis/feedback-maintenance"

export async function POST(request: Request): Promise<Response> {
  const body = await readBoundedBody(request)
  if (!body.success) {
    return Response.json({ error: body.error }, { status: 413 })
  }
  const { env } = await getCloudflareContext()
  const secret = getJarvisEnvValue(env, "JARVIS_BRIDGE_SECRET")
  if (!secret) {
    return Response.json({ error: "Maintenance authentication is not configured" }, { status: 503 })
  }
  const verification = await verifyJarvisRequest(
    request,
    secret,
    body.rawBody,
  )
  if (!verification.success) {
    return Response.json({ error: verification.error }, { status: 401 })
  }
  try {
    const result = await runFeedbackMaintenance(env, "cron")
    return Response.json({ success: true, ...result })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Maintenance failed" },
      { status: 500 },
    )
  }
}
