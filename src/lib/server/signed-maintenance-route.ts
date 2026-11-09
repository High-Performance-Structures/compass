import { getDb } from "@/db"
import { getCloudflareContext } from "@/lib/db"
import {
  getJarvisBridgeSecrets,
  readBoundedBody,
  verifyJarvisRequest,
} from "@/lib/jarvis/auth"
import type { Db } from "@/lib/server/action-context"

/**
 * The shared start for a scheduled maintenance route: checks the signed
 * request from the job runner, then runs the job with the database and
 * environment. Returns the job's summary as JSON, or the error.
 */
export async function signedMaintenanceRoute(
  request: Request,
  failureLabel: string,
  run: (db: Db, env: CloudflareEnv) => Promise<Readonly<Record<string, unknown>>>
): Promise<Response> {
  const body = await readBoundedBody(request)
  if (!body.success) {
    return Response.json({ error: body.error }, { status: 413 })
  }
  const { env } = await getCloudflareContext()
  const secrets = getJarvisBridgeSecrets(env)
  if (!secrets) {
    return Response.json({ error: "Maintenance authentication is not configured" }, { status: 503 })
  }
  const verification = await verifyJarvisRequest(request, secrets, body.rawBody)
  if (!verification.success) {
    return Response.json({ error: verification.error }, { status: 401 })
  }
  try {
    const summary = await run(getDb(env.DB), env)
    return Response.json({ success: true, ...summary })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : failureLabel },
      { status: 500 },
    )
  }
}
