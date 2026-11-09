import "server-only"

import { getCloudflareContext } from "@/lib/db"
import type { ServerVersionInfo } from "@/lib/deployment/update-window"
import { COMPASS_DEPLOYMENT_ID } from "@/lib/deployment/version"

/**
 * Which Compass version is answering, for /api/deployment-version. Public and
 * user-free on purpose (the login page polls it too), so it reads only the
 * Worker's own version metadata and name, never the user or the database.
 * Outside Cloudflare (local development) the version fields are null and open
 * tabs simply do not pin themselves to a version.
 */
export async function currentServerVersion(now: Date): Promise<ServerVersionInfo> {
  let versionId: string | null = null
  let workerName: string | null = null
  let liveAt: string | null = null
  try {
    const { env } = await getCloudflareContext()
    versionId = env.CF_VERSION_METADATA?.id || null
    liveAt = env.CF_VERSION_METADATA?.timestamp || null
    workerName = env.COMPASS_WORKER_NAME || null
  } catch {
    // No Cloudflare bindings available: report the build only.
  }
  return {
    deploymentId: COMPASS_DEPLOYMENT_ID,
    versionId,
    workerName,
    liveAt,
    serverNow: now.toISOString(),
  }
}
