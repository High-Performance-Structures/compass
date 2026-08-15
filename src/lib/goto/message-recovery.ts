import { and, eq, isNull, or } from "drizzle-orm"

import type { getDb } from "@/db"
import { gotoInboundEvents } from "@/db/schema"
import { getGotoAccessToken } from "@/lib/notifications/create-event"

type Db = ReturnType<typeof getDb>

export type RetrievedGotoMessage = {
  readonly body: string
  readonly conversationId: string | null
}

export type GotoMessageRecoverySummary = {
  readonly examined: number
  readonly recovered: number
  readonly unavailable: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : null
}

function messageCandidate(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null
  if (nonEmptyString(value.body)) return value

  const nested = value.message ?? value.payload
  if (isRecord(nested) && nonEmptyString(nested.body)) return nested

  if (!Array.isArray(value.items)) return null
  return value.items.find(
    (item): item is Record<string, unknown> =>
      isRecord(item) && nonEmptyString(item.body) !== null
  ) ?? null
}

export function parseRetrievedGotoMessage(
  value: unknown
): RetrievedGotoMessage | null {
  const candidate = messageCandidate(value)
  if (!candidate) return null
  const body = nonEmptyString(candidate.body)
  if (!body) return null
  return {
    body,
    conversationId: nonEmptyString(candidate.conversationId),
  }
}

async function retrieveGotoMessage(
  messageId: string,
  accessToken: string
): Promise<
  | { readonly kind: "found"; readonly message: RetrievedGotoMessage }
  | { readonly kind: "unavailable"; readonly status: number }
> {
  const response = await fetch(
    `https://api.goto.com/messaging/v1/messages/${encodeURIComponent(messageId)}`,
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    }
  )
  if (!response.ok) {
    if (response.status === 400 || response.status === 404) {
      return { kind: "unavailable", status: response.status }
    }
    throw new Error(`GoTo message retrieval failed (${response.status}).`)
  }

  const value: unknown = await response.json()
  const message = parseRetrievedGotoMessage(value)
  if (!message) {
    return { kind: "unavailable", status: 200 }
  }
  return { kind: "found", message }
}

export async function recoverLegacyGotoMessageBodies(input: {
  readonly db: Db
  readonly env: unknown
  readonly limit?: number
}): Promise<GotoMessageRecoverySummary> {
  const rows = await input.db
    .select({
      id: gotoInboundEvents.id,
      messageId: gotoInboundEvents.messageId,
    })
    .from(gotoInboundEvents)
    .where(
      and(
        eq(gotoInboundEvents.status, "needs_review"),
        eq(gotoInboundEvents.reviewReason, "legacy_project_unmatched"),
        or(
          isNull(gotoInboundEvents.messageBody),
          eq(gotoInboundEvents.messageBody, "")
        ),
        isNull(gotoInboundEvents.error)
      )
    )
    .limit(input.limit ?? 50)

  if (rows.length === 0) {
    return { examined: 0, recovered: 0, unavailable: 0 }
  }

  const token = await getGotoAccessToken(input.env)
  if (!token.success) {
    throw new Error(`GoTo message recovery could not authenticate: ${token.error}`)
  }

  let recovered = 0
  let unavailable = 0
  for (const row of rows) {
    const result = await retrieveGotoMessage(row.messageId, token.accessToken)
    const now = new Date().toISOString()
    if (result.kind === "found") {
      await input.db
        .update(gotoInboundEvents)
        .set({
          messageBody: result.message.body,
          conversationId: result.message.conversationId,
          reviewReason: "missing_project",
          error: null,
          updatedAt: now,
        })
        .where(eq(gotoInboundEvents.id, row.id))
        .run()
      recovered += 1
      continue
    }

    await input.db
      .update(gotoInboundEvents)
      .set({
        error:
          result.status === 200
            ? "GoTo returned no retained text for this historical message."
            : `Historical message is no longer available from GoTo (${result.status}).`,
        updatedAt: now,
      })
      .where(eq(gotoInboundEvents.id, row.id))
      .run()
    unavailable += 1
  }

  return { examined: rows.length, recovered, unavailable }
}
