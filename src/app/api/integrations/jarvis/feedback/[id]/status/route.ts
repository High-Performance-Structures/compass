import { and, eq } from "drizzle-orm"
import { z } from "zod/v4"

import { getDb } from "@/db"
import { feedbackDeskItems, jarvisBridgeEvents } from "@/db/schema-jarvis"
import { getCloudflareContext } from "@/lib/db"
import {
  getJarvisEnvValue,
  readBoundedBody,
  verifyJarvisRequest,
} from "@/lib/jarvis/auth"
import { FEEDBACK_DESK_STATUSES } from "@/lib/jarvis/feedback-lifecycle"
import { applyFeedbackLifecycleUpdate } from "@/lib/jarvis/feedback-status-update"

const statusUpdateSchema = z.object({
  idempotencyKey: z.string().min(1).max(256),
  status: z.enum(FEEDBACK_DESK_STATUSES),
  message: z.string().min(1).max(2_000).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  githubIssueUrl: z.union([
    z.url().max(2_048).refine(
      (value) => /^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+(?:\/|$)/.test(value),
      "GitHub issue URL required",
    ),
    z.null(),
  ]).optional(),
  draftPullRequestUrl: z.union([
    z.url().max(2_048).refine(
      (value) => /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+(?:\/|$)/.test(value),
      "GitHub pull request URL required",
    ),
    z.null(),
  ]).optional(),
})

export async function POST(
  request: Request,
  { params }: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  const bodyResult = await readBoundedBody(request)
  if (!bodyResult.success) {
    return Response.json({ error: bodyResult.error }, { status: 413 })
  }
  const { env } = await getCloudflareContext()
  const secret = getJarvisEnvValue(env, "JARVIS_BRIDGE_SECRET")
  const organizationId = getJarvisEnvValue(env, "JARVIS_BRIDGE_ORGANIZATION_ID")
  if (!secret || !organizationId) {
    return Response.json(
      { error: "Jarvis lifecycle bridge is not configured" },
      { status: 503 },
    )
  }
  const verification = await verifyJarvisRequest(
    request,
    secret,
    bodyResult.rawBody,
  )
  if (!verification.success) {
    return Response.json({ error: verification.error }, { status: 401 })
  }

  let body: unknown
  try {
    body = JSON.parse(bodyResult.rawBody)
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const parsed = statusUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid feedback status update", details: parsed.error.issues },
      { status: 400 },
    )
  }

  const { id } = await params
  const db = getDb(env.DB)
  const eventKey = `feedback-status:${id}:${parsed.data.idempotencyKey}`
  const duplicate = await db.select({ id: jarvisBridgeEvents.id })
    .from(jarvisBridgeEvents)
    .where(eq(jarvisBridgeEvents.idempotencyKey, eventKey))
    .get()
  if (duplicate) return Response.json({ success: true, duplicate: true })

  const item = await db.select().from(feedbackDeskItems).where(and(
    eq(feedbackDeskItems.id, id),
    eq(feedbackDeskItems.organizationId, organizationId),
  )).get()
  if (!item) {
    return Response.json({ error: "Feedback request not found" }, { status: 404 })
  }

  let result: Awaited<ReturnType<typeof applyFeedbackLifecycleUpdate>>
  try {
    result = await applyFeedbackLifecycleUpdate(db, item, {
      status: parsed.data.status,
      priority: parsed.data.priority,
      message: parsed.data.message,
      githubIssueUrl: parsed.data.githubIssueUrl,
      draftPullRequestUrl: parsed.data.draftPullRequestUrl,
      actorSource: "signet",
      idempotencyKey: eventKey,
    })
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Feedback status update rejected",
    }, { status: 409 })
  }
  return Response.json({
    success: true,
    feedbackDeskItemId: id,
    status: parsed.data.status,
    notifiedUserCount: result.notifiedUserCount,
    requesterUpdateQueued: result.requesterUpdateQueued,
  })
}
