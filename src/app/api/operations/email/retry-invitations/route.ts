import { getDb } from "@/db"
import { getCloudflareContext } from "@/lib/db"
import { retryInvitationEmails } from "@/lib/email/invitation-delivery"
import { getJarvisBridgeSecrets, readBoundedBody, verifyJarvisRequest } from "@/lib/jarvis/auth"

export async function POST(request: Request): Promise<Response> {
  const body = await readBoundedBody(request)
  if (!body.success) return Response.json({ error: body.error }, { status: 413 })
  const { env } = await getCloudflareContext()
  const secrets = getJarvisBridgeSecrets(env)
  if (!secrets) return Response.json({ error: "Maintenance authentication is not configured" }, { status: 503 })
  const verification = await verifyJarvisRequest(request, secrets, body.rawBody)
  if (!verification.success) return Response.json({ error: verification.error }, { status: 401 })
  try {
    return Response.json({ success: true, ...await retryInvitationEmails(getDb(env.DB), env) })
  } catch {
    return Response.json({ error: "Invitation email recovery failed" }, { status: 500 })
  }
}
