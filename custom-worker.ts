// OpenNext creates this module before Wrangler bundles this custom entrypoint.
import worker from "./.open-next/worker.js"
import {
  createJarvisSignature,
  getJarvisEnvValue,
} from "./src/lib/jarvis/auth"
import { ListeningRoomCoordinator } from "./src/cloudflare/listening-room-coordinator"

export { ListeningRoomCoordinator }

const RECONCILE_TARGET = "/api/operations/feedback/reconcile"
const EMAIL_SYNC_TARGET = "/api/email/gmail-sync"
const GOTO_MESSAGE_RECOVERY_TARGET =
  "/api/operations/goto/recover-message-bodies"
const SAGE_BRIDGE_HEALTH_TARGET = "/api/operations/sage/health"
const SAGE_SQUARE_RECEIPT_RECONCILIATION_TARGET =
  "/api/operations/sage/square-receipts"
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

async function reconcile(env: CloudflareEnv): Promise<void> {
  const body = JSON.stringify({ source: "cron" })
  const timestamp = String(Math.floor(Date.now() / 1_000))
  const secret = getJarvisEnvValue(env, "JARVIS_BRIDGE_SECRET")
  if (!secret) throw new Error("JARVIS_BRIDGE_SECRET is required")
  const signature = await createJarvisSignature(
    secret,
    timestamp,
    "POST",
    RECONCILE_TARGET,
    body,
  )
  const worker = env.WORKER_SELF_REFERENCE
  if (!worker) throw new Error("WORKER_SELF_REFERENCE is required")
  const response = await worker.fetch(
    `https://compass.internal${RECONCILE_TARGET}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Compass-Timestamp": timestamp,
        "X-Compass-Signature": signature,
      },
      body,
    },
  )
  if (!response.ok) {
    throw new Error(`Feedback reconciliation failed with ${response.status}`)
  }
}

async function syncInboundEmail(env: CloudflareEnv): Promise<void> {
  const secret = getJarvisEnvValue(env, "COMPASS_EMAIL_SYNC_SECRET")
  if (!secret) throw new Error("COMPASS_EMAIL_SYNC_SECRET is required")
  const worker = env.WORKER_SELF_REFERENCE
  if (!worker) throw new Error("WORKER_SELF_REFERENCE is required")
  const response = await worker.fetch(
    `https://compass.internal${EMAIL_SYNC_TARGET}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
    },
  )
  if (!response.ok) {
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

async function recoverGotoMessageBodies(env: CloudflareEnv): Promise<void> {
  const body = ""
  const timestamp = String(Math.floor(Date.now() / 1_000))
  const secret = getJarvisEnvValue(env, "JARVIS_BRIDGE_SECRET")
  if (!secret) throw new Error("JARVIS_BRIDGE_SECRET is required")
  const signature = await createJarvisSignature(
    secret,
    timestamp,
    "POST",
    GOTO_MESSAGE_RECOVERY_TARGET,
    body
  )
  const worker = env.WORKER_SELF_REFERENCE
  if (!worker) throw new Error("WORKER_SELF_REFERENCE is required")
  const response = await worker.fetch(
    `https://compass.internal${GOTO_MESSAGE_RECOVERY_TARGET}`,
    {
      method: "POST",
      headers: {
        "X-Compass-Timestamp": timestamp,
        "X-Compass-Signature": signature,
      },
      body,
    }
  )
  if (!response.ok) {
    throw new Error(`GoTo message recovery failed with ${response.status}`)
  }
}

async function checkSageBridgeHealth(env: CloudflareEnv): Promise<void> {
  const body = ""
  const timestamp = String(Math.floor(Date.now() / 1_000))
  const secret = getJarvisEnvValue(env, "JARVIS_BRIDGE_SECRET")
  if (!secret) throw new Error("JARVIS_BRIDGE_SECRET is required")
  const signature = await createJarvisSignature(
    secret,
    timestamp,
    "POST",
    SAGE_BRIDGE_HEALTH_TARGET,
    body
  )
  const worker = env.WORKER_SELF_REFERENCE
  if (!worker) throw new Error("WORKER_SELF_REFERENCE is required")
  const response = await worker.fetch(
    `https://compass.internal${SAGE_BRIDGE_HEALTH_TARGET}`,
    {
      method: "POST",
      headers: {
        "X-Compass-Timestamp": timestamp,
        "X-Compass-Signature": signature,
      },
      body,
    }
  )
  if (!response.ok) {
    throw new Error(`Sage bridge health check failed with ${response.status}`)
  }
}

async function reconcileSageSquareReceipts(env: CloudflareEnv): Promise<void> {
  const body = ""
  const timestamp = String(Math.floor(Date.now() / 1_000))
  const secret = getJarvisEnvValue(env, "JARVIS_BRIDGE_SECRET")
  if (!secret) throw new Error("JARVIS_BRIDGE_SECRET is required")
  const signature = await createJarvisSignature(
    secret,
    timestamp,
    "POST",
    SAGE_SQUARE_RECEIPT_RECONCILIATION_TARGET,
    body
  )
  const worker = env.WORKER_SELF_REFERENCE
  if (!worker) throw new Error("WORKER_SELF_REFERENCE is required")
  const response = await worker.fetch(
    `https://compass.internal${SAGE_SQUARE_RECEIPT_RECONCILIATION_TARGET}`,
    {
      method: "POST",
      headers: {
        "X-Compass-Timestamp": timestamp,
        "X-Compass-Signature": signature,
      },
      body,
    }
  )
  if (!response.ok) {
    throw new Error(
      `Sage Square receipt reconciliation failed with ${response.status}`
    )
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
  try {
    await job()
  } catch (error) {
    // Jobs are independent; log only the error class/status to avoid leaking data.
    console.error(`[scheduled] ${name} failed: ${maintenanceErrorLabel(error)}`)
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
  async scheduled(_controller, env, ctx): Promise<void> {
    ctx.waitUntil(
      Promise.all([
        runMaintenanceJob("feedback reconciliation", () => reconcile(env)),
        runMaintenanceJob("inbound email sync", () => syncInboundEmail(env)),
        runMaintenanceJob("GoTo message recovery", () =>
          recoverGotoMessageBodies(env)
        ),
        runMaintenanceJob("Sage bridge health", () =>
          checkSageBridgeHealth(env)
        ),
        runMaintenanceJob("Sage Square manual receipts", () =>
          reconcileSageSquareReceipts(env)
        ),
      ]).then(() => undefined)
    )
  },
} satisfies ExportedHandler<CloudflareEnv>
