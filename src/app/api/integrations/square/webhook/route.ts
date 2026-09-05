import { getCloudflareContext } from "@/lib/db"
import {
  beginSquareWebhookEvent,
  completeSquareWebhookEvent,
  failSquareWebhookEvent,
  flagSquareWebhookEventForAttention,
  processSquareWebhookEvent,
  SageSquarePaymentAttentionError,
  squareWebhookEventSchema,
} from "@/lib/sage/square-payment"
import { notifySageSquareException } from "@/lib/sage/square-payment-notifications"
import {
  getSquareWebhookSignatureKey,
  readBoundedSquareWebhookBody,
  sageSquareWebhookEnabled,
  verifySquareWebhookSignature,
} from "@/lib/sage/square-webhook-auth"

const SIGNATURE_HEADER = "x-square-hmacsha256-signature"

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Square webhook processing failed"
}

export async function POST(request: Request): Promise<Response> {
  const { env } = await getCloudflareContext()
  if (!sageSquareWebhookEnabled(env)) {
    return Response.json({ error: "Square payment webhook is disabled" }, { status: 503 })
  }
  const signatureKey = getSquareWebhookSignatureKey(env)
  if (!signatureKey) {
    return Response.json({ error: "Square webhook is not configured" }, { status: 503 })
  }
  const suppliedSignature = request.headers.get(SIGNATURE_HEADER)
  if (!suppliedSignature) {
    return Response.json({ error: "Missing Square webhook signature" }, { status: 401 })
  }
  const body = await readBoundedSquareWebhookBody(request)
  if (!body.success) {
    return Response.json({ error: body.error }, { status: 413 })
  }
  if (
    !(await verifySquareWebhookSignature(
      body.rawBody,
      suppliedSignature,
      signatureKey
    ))
  ) {
    return Response.json({ error: "Invalid Square webhook signature" }, { status: 401 })
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(body.rawBody)
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const validated = squareWebhookEventSchema.safeParse(parsed)
  if (!validated.success) {
    return Response.json({ error: "Invalid Square webhook event" }, { status: 400 })
  }
  const event = validated.data
  const now = new Date().toISOString()
  const begin = await beginSquareWebhookEvent(env, event, now)
  if (begin === "duplicate") {
    return Response.json({ success: true, duplicate: true })
  }
  try {
    await processSquareWebhookEvent(env, event, now)
    await completeSquareWebhookEvent(env, event.event_id, now)
    return Response.json({ success: true })
  } catch (error) {
    const message = safeErrorMessage(error)
    if (error instanceof SageSquarePaymentAttentionError) {
      await flagSquareWebhookEventForAttention(env, event.event_id, message, now)
    } else {
      await failSquareWebhookEvent(env, event.event_id, message, now)
    }
    if (
      error instanceof SageSquarePaymentAttentionError &&
      error.organizationId
    ) {
      await notifySageSquareException(
        env,
        {
          organizationId: error.organizationId,
          projectId: error.projectId,
          receiptOperationId: error.receiptOperationId ?? undefined,
        },
        event.event_id,
        "Square payment needs Sage review",
        `${message}. No automatic Sage retry will bypass this exception.`
      )
    }
    return error instanceof SageSquarePaymentAttentionError
      ? Response.json({ success: true, attention: true })
      : Response.json(
          { error: "Square payment processing failed" },
          { status: 500 }
        )
  }
}
