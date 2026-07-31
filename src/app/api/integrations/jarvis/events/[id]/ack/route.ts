import { and, eq } from "drizzle-orm"
import { z } from "zod/v4"
import { getDb } from "@/db"
import { jarvisBridgeEvents } from "@/db/schema-jarvis"
import { getCloudflareContext } from "@/lib/db"
import {
  getJarvisEnvValue,
  readBoundedBody,
  verifyJarvisRequest,
} from "@/lib/jarvis/auth"
import { jarvisPayloadAfterCompletion } from "@/lib/jarvis/visual-context"

const acknowledgementSchema = z.object({
  status: z.enum(["completed", "failed"]),
  result: z.unknown().optional(),
  error: z.string().max(2000).optional(),
  retryAfterSeconds: z.number().int().min(1).max(86_400).optional(),
})

export async function POST(
  request: Request,
  { params }: {
    readonly params: Promise<{ readonly id: string }>
  },
): Promise<Response> {
  const bodyResult = await readBoundedBody(request)
  if (!bodyResult.success) {
    return Response.json(
      { error: bodyResult.error },
      { status: 413 },
    )
  }

  const { env } = await getCloudflareContext()
  const secret = getJarvisEnvValue(env, "JARVIS_BRIDGE_SECRET")
  if (!secret) {
    return Response.json(
      { error: "Jarvis bridge is not configured" },
      { status: 503 },
    )
  }

  const verification = await verifyJarvisRequest(
    request,
    secret,
    bodyResult.rawBody,
  )
  if (!verification.success) {
    return Response.json(
      { error: verification.error },
      { status: 401 },
    )
  }

  let body: unknown
  try {
    body = JSON.parse(bodyResult.rawBody)
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const parsed = acknowledgementSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid acknowledgement" },
      { status: 400 },
    )
  }

  const { id } = await params
  const now = new Date()
  const nowIso = now.toISOString()
  const shouldRetry =
    parsed.data.status === "failed" &&
    parsed.data.retryAfterSeconds !== undefined
  const retryAfterSeconds =
    parsed.data.retryAfterSeconds ?? 0
  const retryAt = shouldRetry
    ? new Date(
        now.getTime() + retryAfterSeconds * 1000,
      ).toISOString()
    : nowIso
  const db = getDb(env.DB)

  const existing = await db
    .select({
      id: jarvisBridgeEvents.id,
      eventType: jarvisBridgeEvents.eventType,
      payload: jarvisBridgeEvents.payload,
    })
    .from(jarvisBridgeEvents)
    .where(
      and(
        eq(jarvisBridgeEvents.id, id),
        eq(jarvisBridgeEvents.direction, "outbound"),
      ),
    )
    .get()

  if (!existing) {
    return Response.json({ error: "Event not found" }, { status: 404 })
  }

  await db
    .update(jarvisBridgeEvents)
    .set({
      status: shouldRetry ? "pending" : parsed.data.status,
      result:
        parsed.data.result === undefined
          ? null
          : JSON.stringify(parsed.data.result),
      lastError: parsed.data.error ?? null,
      availableAt: retryAt,
      claimToken: null,
      claimedAt: null,
      completedAt:
        parsed.data.status === "completed" ? nowIso : null,
      payload:
        !shouldRetry && existing.eventType === "agent.prompt"
          ? jarvisPayloadAfterCompletion(existing.payload)
          : existing.payload,
      updatedAt: nowIso,
    })
    .where(eq(jarvisBridgeEvents.id, id))

  return Response.json({ success: true })
}
