import { and, count, eq, gte } from "drizzle-orm"

import { getDb } from "@/db"
import { gotoInboundEvents, gotoInboundSettings } from "@/db/schema"
import { getCloudflareContext } from "@/lib/db"
import { processGotoInboundMessage } from "@/lib/goto/inbound"
import { parseGotoInboundNotification } from "@/lib/goto/notification-parser"
import {
  constantTimeSecretMatch,
  gotoMessageMatchesConfig,
  gotoWebhookConfig,
} from "@/lib/goto/webhook-security"

const MAX_WEBHOOK_BODY_BYTES = 256 * 1024
const MAX_EVENTS_PER_MINUTE = 120

function isAuthorizedWebhook(request: Request, secret: string): boolean {
  const suppliedSecret = new URL(request.url).searchParams.get("secret")
  return constantTimeSecretMatch(secret, suppliedSecret)
}

async function validateWebhookProbe(request: Request): Promise<Response> {
  const { env } = await getCloudflareContext()
  const config = gotoWebhookConfig(env)
  if (!config) {
    return Response.json(
      { error: "GoTo inbound messaging is not configured" },
      { status: 503 }
    )
  }
  if (!isAuthorizedWebhook(request, config.secret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }
  return new Response(null, { status: 200 })
}

// GoTo probes the callback with OPTIONS and GET while creating a notification
// channel. Keep both methods secret-protected and answer before the 2s limit.
export async function OPTIONS(request: Request): Promise<Response> {
  return validateWebhookProbe(request)
}

export async function GET(request: Request): Promise<Response> {
  return validateWebhookProbe(request)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 2_000) : "Unknown error"
}

async function boundedBody(request: Request): Promise<string | null> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0")
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BODY_BYTES) {
    return null
  }
  const body = await request.text()
  return new TextEncoder().encode(body).byteLength <= MAX_WEBHOOK_BODY_BYTES
    ? body
    : null
}

export async function POST(request: Request): Promise<Response> {
  const { env, ctx } = await getCloudflareContext()
  const config = gotoWebhookConfig(env)
  if (!config) {
    return Response.json({ error: "GoTo inbound messaging is not configured" }, { status: 503 })
  }

  if (!isAuthorizedWebhook(request, config.secret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rawBody = await boundedBody(request)
  if (rawBody === null) {
    return Response.json({ error: "Request body is too large" }, { status: 413 })
  }
  if (rawBody.trim().length === 0) return new Response(null, { status: 204 })

  let value: unknown
  try {
    value = JSON.parse(rawBody)
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const parsed = parseGotoInboundNotification(value)
  if (parsed.kind === "validation" || parsed.kind === "ignored") {
    return new Response(null, { status: 204 })
  }
  if (parsed.kind === "invalid") {
    return Response.json({ error: parsed.error }, { status: 400 })
  }
  const db = getDb(env.DB)
  const settings = await db
    .select({ accountKey: gotoInboundSettings.accountKey })
    .from(gotoInboundSettings)
    .where(eq(gotoInboundSettings.organizationId, config.organizationId))
    .get()
  if (!settings) {
    return Response.json({ error: "GoTo inbound messaging is not registered" }, { status: 503 })
  }
  if (!gotoMessageMatchesConfig(parsed.message, config, settings.accountKey)) {
    return Response.json({ error: "GoTo account or receiving number mismatch" }, { status: 403 })
  }
  const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString()
  const rateRows = await db
    .select({ total: count() })
    .from(gotoInboundEvents)
    .where(
      and(
        eq(gotoInboundEvents.organizationId, config.organizationId),
        gte(gotoInboundEvents.receivedAt, oneMinuteAgo)
      )
    )
  if ((rateRows[0]?.total ?? 0) >= MAX_EVENTS_PER_MINUTE) {
    return Response.json({ error: "Rate limit exceeded" }, { status: 429 })
  }

  const now = new Date().toISOString()
  const eventId = crypto.randomUUID()
  const inserted = await db
    .insert(gotoInboundEvents)
    .values({
      id: eventId,
      organizationId: config.organizationId,
      projectId: null,
      messageId: parsed.message.messageId,
      accountKey: parsed.message.accountKey,
      ownerTouchpoint: parsed.message.ownerTouchpoint,
      senderPhone: parsed.message.senderPhone,
      status: "received",
      error: null,
      receivedAt: parsed.message.receivedAt,
      processedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: gotoInboundEvents.messageId })
    .returning({ id: gotoInboundEvents.id })
    .get()
  if (!inserted) return new Response(null, { status: 204 })

  const processing = processGotoInboundMessage({
    env,
    db,
    organizationId: config.organizationId,
    message: parsed.message,
  })
    .then(async (result) => {
      const processedAt = new Date().toISOString()
      await db
        .update(gotoInboundEvents)
        .set({
          projectId: result.projectId,
          status: result.status,
          processedAt,
          updatedAt: processedAt,
        })
        .where(eq(gotoInboundEvents.id, eventId))
        .run()
    })
    .catch(async (error: unknown) => {
      const processedAt = new Date().toISOString()
      await db
        .update(gotoInboundEvents)
        .set({
          status: "failed",
          error: errorMessage(error),
          processedAt,
          updatedAt: processedAt,
        })
        .where(eq(gotoInboundEvents.id, eventId))
        .run()
    })
  ctx.waitUntil(processing)

  return Response.json({ accepted: true }, { status: 202 })
}
