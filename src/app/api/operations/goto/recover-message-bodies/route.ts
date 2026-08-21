import { getDb } from "@/db"
import { getCloudflareContext } from "@/lib/db"
import { recoverLegacyGotoMessageBodies } from "@/lib/goto/message-recovery"
import {
  getJarvisBridgeSecrets,
  readBoundedBody,
  verifyJarvisRequest,
} from "@/lib/jarvis/auth"

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
    const summary = await recoverLegacyGotoMessageBodies({
      db: getDb(env.DB),
      env,
    })
    return Response.json({ success: true, ...summary })
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "GoTo message recovery failed",
      },
      { status: 500 }
    )
  }
}
