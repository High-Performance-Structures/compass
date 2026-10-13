import { getCloudflareContext } from "@/lib/db"
import { getJarvisBridgeSecrets, verifyJarvisRequest } from "@/lib/jarvis/auth"
import {
  invoiceCreatorObservationSchema,
  pendingSquareInvoiceCreators,
  recordSquareInvoiceCreator,
  reconcileSquareInvoiceCreatorAlerts,
  squareCreatorAlertConfiguration,
} from "@/lib/sage/square-creator-alerts"
import {
  pendingSageReceiptChecks,
  recordSageReceiptCheck,
  sageReceiptObservationSchema,
} from "@/lib/sage/square-receipt-reminders"
import { readBoundedSquareWebhookBody } from "@/lib/sage/square-webhook-auth"

function reply(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } })
}

/**
 * The read-only Sage poller asks here which invoice creators to look up and
 * which Square receipts to look for in Sage, then reports what it found.
 */
async function handle(request: Request): Promise<Response> {
  const body = request.method === "GET"
    ? { success: true, rawBody: "" }
    : await readBoundedSquareWebhookBody(request)
  if (!body.success) return reply({ error: "Request body is too large" }, 413)
  const { env } = await getCloudflareContext()
  const secrets = getJarvisBridgeSecrets(env)
  const config = await squareCreatorAlertConfiguration(env)
  if (!secrets || !config) return reply({ error: "Invoice creator alerts are not configured" }, 503)
  const verification = await verifyJarvisRequest(request, secrets, body.rawBody)
  if (!verification.success) return reply({ error: verification.error }, 401)
  try {
    if (request.method === "GET") {
      const [requests, receiptChecks] = await Promise.all([
        pendingSquareInvoiceCreators(env, config),
        pendingSageReceiptChecks(env, config.organizationId),
      ])
      return reply({ requests, receiptChecks })
    }
    let value: unknown
    try { value = JSON.parse(body.rawBody) } catch { return reply({ error: "Invalid JSON" }, 400) }
    const receipt = sageReceiptObservationSchema.safeParse(value)
    const creator = receipt.success ? null : invoiceCreatorObservationSchema.safeParse(value)
    const checkedAt = receipt.success ? receipt.data.checkedAt : creator?.success ? creator.data.checkedAt : null
    if (checkedAt === null) return reply({ error: "Invalid observation" }, 400)
    const age = Date.now() - Date.parse(checkedAt)
    if (age > 120_000 || age < -60_000) return reply({ error: "Expired observation" }, 400)
    if (receipt.success) {
      if (!await recordSageReceiptCheck(env, config.organizationId, receipt.data)) return reply({ error: "Receipt identity conflict" }, 409)
      return reply({ success: true })
    }
    if (!creator?.success || !await recordSquareInvoiceCreator(env, config, creator.data)) return reply({ error: "Invoice source identity conflict" }, 409)
    await reconcileSquareInvoiceCreatorAlerts(env)
    return reply({ success: true })
  } catch {
    return reply({ error: "Invoice creator alert processing failed" }, 503)
  }
}

export async function GET(request: Request): Promise<Response> { return handle(request) }
export async function POST(request: Request): Promise<Response> { return handle(request) }
