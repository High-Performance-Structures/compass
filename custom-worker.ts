// OpenNext creates this module before Wrangler bundles this custom entrypoint.
// @ts-expect-error Generated build output is intentionally absent in source checkouts.
import worker from "./.open-next/worker.js"
import {
  createJarvisSignature,
  getJarvisEnvValue,
} from "./src/lib/jarvis/auth"

const RECONCILE_TARGET = "/api/operations/feedback/reconcile"
const EMAIL_SYNC_TARGET = "/api/email/gmail-sync"
const GOTO_MESSAGE_RECOVERY_TARGET =
  "/api/operations/goto/recover-message-bodies"

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

export default {
  fetch: worker.fetch,
  async scheduled(_controller, env, ctx): Promise<void> {
    ctx.waitUntil(
      Promise.all([
        reconcile(env),
        syncInboundEmail(env),
        recoverGotoMessageBodies(env),
      ]).then(() => undefined)
    )
  },
} satisfies ExportedHandler<CloudflareEnv>
