// OpenNext creates this module before Wrangler bundles this custom entrypoint.
// @ts-expect-error Generated build output is intentionally absent in source checkouts.
import worker from "./.open-next/worker.js"
import {
  createJarvisSignature,
  getJarvisEnvValue,
} from "./src/lib/jarvis/auth"

const RECONCILE_TARGET = "/api/operations/feedback/reconcile"

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

export default {
  fetch: worker.fetch,
  async scheduled(_controller, env, ctx): Promise<void> {
    ctx.waitUntil(reconcile(env))
  },
} satisfies ExportedHandler<CloudflareEnv>
