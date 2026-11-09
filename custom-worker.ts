// OpenNext creates this module before Wrangler bundles this custom entrypoint.
import worker from "./.open-next/worker.js"
import {
  createJarvisSignature,
  getJarvisEnvValue,
} from "./src/lib/jarvis/auth"
import { ListeningRoomCoordinator } from "./src/cloudflare/listening-room-coordinator"
import {
  jobsDueAt,
  type ScheduledJob,
} from "./src/lib/operations/schedule"

export { ListeningRoomCoordinator }

const LISTENING_ROOM_SOCKET_TARGET = "/api/listening-room-sync"
const LISTENING_ROOM_AUTH_TARGET = "/api/listening-room/sync-authorize"

type ListeningRoomAuthorization = {
  readonly success: true
  readonly data: {
    readonly roomId: string
    readonly userId: string
  }
}

function listeningRoomAuthorization(
  value: unknown
): ListeningRoomAuthorization | null {
  if (typeof value !== "object" || value === null) return null
  const success = Reflect.get(value, "success")
  const data = Reflect.get(value, "data")
  if (success !== true || typeof data !== "object" || data === null) return null
  const roomId = Reflect.get(data, "roomId")
  const userId = Reflect.get(data, "userId")
  if (typeof roomId !== "string" || typeof userId !== "string") {
    return null
  }
  return { success: true, data: { roomId, userId } }
}

async function handleListeningRoomSocket(
  request: Request,
  env: CloudflareEnv,
  ctx: ExecutionContext
): Promise<Response> {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return new Response("Expected a WebSocket upgrade", { status: 426 })
  }
  const url = new URL(request.url)
  const channelId = url.searchParams.get("channelId")
  if (!channelId || channelId.length > 200) {
    return new Response("Invalid channel", { status: 400 })
  }

  const authUrl = new URL(LISTENING_ROOM_AUTH_TARGET, request.url)
  authUrl.searchParams.set("channelId", channelId)
  const authHeaders = new Headers(request.headers)
  authHeaders.delete("Upgrade")
  authHeaders.delete("Connection")
  const authResponse = await worker.fetch(
    new Request(authUrl, { method: "GET", headers: authHeaders }),
    env,
    ctx
  )
  if (!authResponse.ok) {
    return new Response("Unauthorized", { status: authResponse.status })
  }
  const authorization = listeningRoomAuthorization(await authResponse.json())
  if (!authorization) {
    return new Response("Invalid authorization response", { status: 502 })
  }

  const coordinator = env.LISTENING_ROOM_COORDINATOR.getByName(
    authorization.data.roomId
  )
  const coordinatorHeaders = new Headers()
  coordinatorHeaders.set("Upgrade", "websocket")
  coordinatorHeaders.set("X-Compass-Room-Id", authorization.data.roomId)
  coordinatorHeaders.set("X-Compass-User-Id", authorization.data.userId)
  return coordinator.fetch(
    new Request(request.url, { method: "GET", headers: coordinatorHeaders })
  )
}

const FEEDBACK_RECONCILE_BODY = JSON.stringify({ source: "cron" })

function selfReference(
  env: CloudflareEnv
): NonNullable<CloudflareEnv["WORKER_SELF_REFERENCE"]> {
  const self = env.WORKER_SELF_REFERENCE
  if (!self) throw new Error("WORKER_SELF_REFERENCE is required")
  return self
}

/** Signed POST, the same signature the Jarvis bridge uses. */
async function postSigned(
  env: CloudflareEnv,
  path: string,
  body: string
): Promise<Response> {
  const timestamp = String(Math.floor(Date.now() / 1_000))
  const secret = getJarvisEnvValue(env, "JARVIS_BRIDGE_SECRET")
  if (!secret) throw new Error("JARVIS_BRIDGE_SECRET is required")
  const signature = await createJarvisSignature(secret, timestamp, "POST", path, body)
  const headers: Record<string, string> = {
    "X-Compass-Timestamp": timestamp,
    "X-Compass-Signature": signature,
  }
  if (body) headers["Content-Type"] = "application/json"
  return selfReference(env).fetch(`https://compass.internal${path}`, {
    method: "POST",
    headers,
    body,
  })
}

async function syncInboundEmail(env: CloudflareEnv, path: string): Promise<void> {
  const secret = getJarvisEnvValue(env, "COMPASS_EMAIL_SYNC_SECRET")
  if (!secret) throw new Error("COMPASS_EMAIL_SYNC_SECRET is required")
  const response = await selfReference(env).fetch(
    `https://compass.internal${path}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
    },
  )
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`Inbound email sync failed with ${response.status}`)
  }
  const payload: unknown = await response.json()
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Inbound email sync returned an invalid response")
  }
  const summaries = Reflect.get(payload, "summaries")
  if (!Array.isArray(summaries)) {
    throw new Error("Inbound email sync returned no summaries")
  }
  const errors = summaries.flatMap((summary) => {
    if (typeof summary !== "object" || summary === null) return []
    const value = Reflect.get(summary, "errors")
    return Array.isArray(value)
      ? value.filter((error): error is string => typeof error === "string")
      : []
  })
  if (errors.length > 0) {
    throw new Error(`Inbound email sync reported: ${errors.join("; ")}`)
  }
}

/** Runs one row of the schedule table (src/lib/operations/schedule.ts). */
async function runScheduledJob(env: CloudflareEnv, job: ScheduledJob): Promise<void> {
  if (job.call === "gmail") return syncInboundEmail(env, job.path)
  const response = await postSigned(
    env,
    job.path,
    job.call === "feedback" ? FEEDBACK_RECONCILE_BODY : ""
  )
  // Drop the body unread so the isolate never buffers job summaries.
  await response.body?.cancel()
  if (!response.ok) {
    throw new Error(`${job.name} failed with ${response.status}`)
  }
}

function maintenanceErrorLabel(error: unknown): string {
  if (!(error instanceof Error)) return "Unknown error"
  const status = /\b[1-5]\d{2}\b/.exec(error.message)?.[0]
  return status ? `${error.name} status ${status}` : error.name
}

async function runMaintenanceJob(
  name: string,
  job: () => Promise<void>
): Promise<void> {
  const started = Date.now()
  try {
    await job()
    console.log(`[scheduled] ${name} ok in ${Date.now() - started} ms`)
  } catch (error) {
    // Jobs are independent; log only the error class/status to avoid leaking data.
    console.error(`[scheduled] ${name} failed after ${Date.now() - started} ms: ${maintenanceErrorLabel(error)}`)
  }
}

/**
 * Runs this minute's jobs one after another (never in parallel) so one
 * isolate is never holding several big job responses at once. A failing
 * job is logged and the next one still runs.
 */
async function runDueJobs(env: CloudflareEnv, scheduledTime: number): Promise<void> {
  for (const job of jobsDueAt(new Date(scheduledTime))) {
    await runMaintenanceJob(job.name, () => runScheduledJob(env, job))
  }
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === LISTENING_ROOM_SOCKET_TARGET) {
      return handleListeningRoomSocket(request, env, ctx)
    }
    return worker.fetch(request, env, ctx)
  },
  async scheduled(controller, env, ctx): Promise<void> {
    // One cron, every minute. Which jobs run when is the table in
    // src/lib/operations/schedule.ts.
    ctx.waitUntil(runDueJobs(env, controller.scheduledTime))
  },
} satisfies ExportedHandler<CloudflareEnv>
