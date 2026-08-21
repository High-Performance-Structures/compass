import { z } from "zod/v4"

import { getDb } from "@/db"
import { getCloudflareContext } from "@/lib/db"
import {
  getJarvisBridgeSecrets,
  getJarvisEnvValue,
  readBoundedBody,
  verifyJarvisRequest,
} from "@/lib/jarvis/auth"
import { recordFeedbackServiceHealth } from "@/lib/jarvis/feedback-maintenance"

const heartbeatSchema = z.object({
  serviceName: z.enum(["jarvis-agent-poller", "jarvis-feedback-notifier"]),
  status: z.enum(["healthy", "degraded", "failed"]),
  error: z.string().max(2_000).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export async function POST(request: Request): Promise<Response> {
  const body = await readBoundedBody(request)
  if (!body.success) return Response.json({ error: body.error }, { status: 413 })
  const { env } = await getCloudflareContext()
  const secrets = getJarvisBridgeSecrets(env)
  const organizationId = getJarvisEnvValue(env, "JARVIS_BRIDGE_ORGANIZATION_ID")
  if (!secrets || !organizationId) {
    return Response.json({ error: "Jarvis health bridge is not configured" }, { status: 503 })
  }
  const verification = await verifyJarvisRequest(request, secrets, body.rawBody)
  if (!verification.success) {
    return Response.json({ error: verification.error }, { status: 401 })
  }
  let value: unknown
  try {
    value = JSON.parse(body.rawBody)
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const parsed = heartbeatSchema.safeParse(value)
  if (!parsed.success) {
    return Response.json({ error: "Invalid heartbeat" }, { status: 400 })
  }
  await recordFeedbackServiceHealth(getDb(env.DB), {
    serviceName: parsed.data.serviceName,
    organizationId,
    status: parsed.data.status,
    error: parsed.data.error,
    metadata: parsed.data.metadata,
  })
  return Response.json({ success: true })
}
