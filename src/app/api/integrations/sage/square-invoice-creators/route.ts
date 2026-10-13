import { getCloudflareContext } from "@/lib/db"
import { getJarvisBridgeSecrets, verifyJarvisRequest } from "@/lib/jarvis/auth"
import {
  invoiceCreatorObservationSchema,
  pendingSquareInvoiceCreators,
  recordSquareInvoiceCreator,
  reconcileSquareInvoiceCreatorAlerts,
  squareCreatorAlertConfiguration,
} from "@/lib/sage/square-creator-alerts"
import { readBoundedSquareWebhookBody } from "@/lib/sage/square-webhook-auth"

function reply(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } })
}

async function handle(request: Request): Promise<Response> {
  const body = request.method === "GET"
    ? { success: true, rawBody: "" }
    : await readBoundedSquareWebhookBody(request)
  if (!body.success) return reply({ error: "Request body is too large" }, 413)
  const { env } = await getCloudflareContext()
  const secrets = getJarvisBridgeSecrets(env)
  if (!secrets || !squareCreatorAlertConfiguration(env)) return reply({ error: "Invoice creator alerts are not configured" }, 503)
  const verification = await verifyJarvisRequest(request, secrets, body.rawBody)
  if (!verification.success) return reply({ error: verification.error }, 401)
  try {
    if (request.method === "GET") return reply({ requests: await pendingSquareInvoiceCreators(env) })
    let value: unknown
    try { value = JSON.parse(body.rawBody) } catch { return reply({ error: "Invalid JSON" }, 400) }
    const observation = invoiceCreatorObservationSchema.safeParse(value)
    if (!observation.success) return reply({ error: "Invalid invoice creator observation" }, 400)
    const age = Date.now() - Date.parse(observation.data.checkedAt)
    if (age > 120_000 || age < -60_000) return reply({ error: "Expired observation" }, 400)
    if (!await recordSquareInvoiceCreator(env, observation.data)) return reply({ error: "Invoice source identity conflict" }, 409)
    await reconcileSquareInvoiceCreatorAlerts(env)
    return reply({ success: true })
  } catch {
    return reply({ error: "Invoice creator alert processing failed" }, 503)
  }
}

export async function GET(request: Request): Promise<Response> { return handle(request) }
export async function POST(request: Request): Promise<Response> { return handle(request) }
