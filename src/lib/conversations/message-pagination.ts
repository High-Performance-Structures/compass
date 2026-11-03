import { and, desc, eq, lt, or, type SQL } from "drizzle-orm"
import { messages } from "@/db/schema-conversations"

export type ConversationHistoryCursor = {
  readonly createdAt: string
  readonly id: string
}

export function conversationHistoryBefore(
  cursor: string | ConversationHistoryCursor | undefined,
): SQL | undefined {
  if (!cursor) return undefined
  // Keep timestamp-only callers compatible while new pages include the tie-breaker.
  if (typeof cursor === "string") return lt(messages.createdAt, cursor)
  return or(
    lt(messages.createdAt, cursor.createdAt),
    and(eq(messages.createdAt, cursor.createdAt), lt(messages.id, cursor.id)),
  )
}

export function conversationHistoryOrder(): readonly SQL[] {
  return [desc(messages.createdAt), desc(messages.id)]
}
