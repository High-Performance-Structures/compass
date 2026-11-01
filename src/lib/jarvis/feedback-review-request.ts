import { and, eq } from "drizzle-orm"
import { z } from "zod/v4"

import { getDb } from "@/db"
import { organizationMembers, users } from "@/db/schema"
import { feedbackDeskItems, jarvisBridgeEvents } from "@/db/schema-jarvis"
import { getCloudflareContext } from "@/lib/db"
import { insertJarvisBridgeEvents } from "@/lib/domain/feedback/store"
import {
  getJarvisBridgeSecrets,
  getJarvisEnvValue,
  readBoundedBody,
  verifyJarvisRequest,
} from "@/lib/jarvis/auth"
import { createSystemNotificationEvent } from "@/lib/notifications/events"
import { canManageUserAccessRole } from "@/lib/user-roles"

/*
 * Jarvis asks the Feedback Desk administrators to look at a request it
 * must not decide on its own (feature requests wait for a leadership
 * priority decision). This only notifies; it never changes the request's
 * lifecycle, so the feature gate stays with the administrators.
 */
const reviewRequestSchema = z.object({
  idempotencyKey: z.string().min(1).max(256),
  summary: z.string().min(1).max(2_000),
})

const OPEN_STATUSES = new Set(["new", "triaged", "needs_info"])

export async function handleFeedbackReviewRequest(
  request: Request,
  id: string,
): Promise<Response> {
  const bodyResult = await readBoundedBody(request)
  if (!bodyResult.success) {
    return Response.json({ error: bodyResult.error }, { status: 413 })
  }
  const { env } = await getCloudflareContext()
  const secrets = getJarvisBridgeSecrets(env)
  const organizationId = getJarvisEnvValue(env, "JARVIS_BRIDGE_ORGANIZATION_ID")
  if (!secrets || !organizationId) {
    return Response.json(
      { error: "Jarvis lifecycle bridge is not configured" },
      { status: 503 },
    )
  }
  const verification = await verifyJarvisRequest(
    request,
    secrets,
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
  const parsed = reviewRequestSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid feedback review request", details: parsed.error.issues },
      { status: 400 },
    )
  }

  const db = getDb(env.DB)
  const eventKey = `feedback-review:${id}:${parsed.data.idempotencyKey}`
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
  if (!OPEN_STATUSES.has(item.status)) {
    return Response.json(
      { error: "Only a request still waiting on a decision can be sent for review" },
      { status: 409 },
    )
  }

  const reviewers = (await db
    .select({
      userId: users.id,
      email: users.email,
      role: organizationMembers.role,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(and(
      eq(organizationMembers.organizationId, organizationId),
      eq(users.isActive, true),
    )))
    .filter((member) => canManageUserAccessRole(member.role))
    .map(({ userId, email }) => ({ userId, email }))

  const now = new Date().toISOString()
  await insertJarvisBridgeEvents(db, {
    id: crypto.randomUUID(),
    organizationId,
    direction: "inbound",
    source: "signet",
    eventType: "feedback.review_requested",
    status: "completed",
    idempotencyKey: eventKey,
    feedbackDeskItemId: item.id,
    payload: bodyResult.rawBody,
    result: JSON.stringify({ reviewerCount: reviewers.length }),
    availableAt: now,
    completedAt: now,
    createdAt: now,
    updatedAt: now,
  })
    .onConflictDoNothing()

  if (reviewers.length > 0) {
    await createSystemNotificationEvent({
      organizationId,
      projectId: null,
      eventType: "feedback.review_requested",
      sourceType: "feedback",
      sourceId: item.id,
      title: `${item.kind === "feature" ? "Feature request" : "Request"} needs your review: ${item.title.slice(0, 80)}`,
      body: parsed.data.summary,
      href: "/dashboard/requests/manage",
      priority: "normal",
      audience: "feedback_admins",
      recipients: reviewers,
      delivery: { inApp: true, email: false, push: false },
    })
  }

  return Response.json({
    success: true,
    feedbackDeskItemId: id,
    notifiedUserCount: reviewers.length,
  })
}
