/**
 * Reads behind Feedback Desk maintenance. Writes live in store.ts.
 */
import { and, desc, eq, inArray, notExists, sql } from "drizzle-orm"

import { feedback } from "@/db/schema"
import { feedbackDeskItems, jarvisBridgeEvents } from "@/db/schema-jarvis"
import type { Db } from "@/lib/server/action-context"

/** How far back legacy widget feedback is recovered, newest first. */
export const LEGACY_FEEDBACK_WINDOW = 500
/** How many recent Ask Jarvis prompts are rechecked for a confirmed report. */
const CONFIRMED_PROMPT_WINDOW = 1_000

/**
 * The newest legacy widget feedback rows that this organization's Feedback
 * Desk has not imported yet. The window is the newest 500 rows, as before;
 * the "already imported" check now runs in SQL instead of loading every
 * imported desk item into memory.
 */
export async function unimportedLegacyFeedback(
  db: Db,
  organizationId: string
): Promise<ReadonlyArray<typeof feedback.$inferSelect>> {
  const newest = db
    .select({ id: feedback.id })
    .from(feedback)
    .orderBy(desc(feedback.createdAt))
    .limit(LEGACY_FEEDBACK_WINDOW)
  return db
    .select()
    .from(feedback)
    .where(
      and(
        inArray(feedback.id, newest),
        notExists(
          db
            .select({ one: sql`1` })
            .from(feedbackDeskItems)
            .where(
              and(
                eq(feedbackDeskItems.organizationId, organizationId),
                eq(feedbackDeskItems.source, "feedback-widget"),
                eq(feedbackDeskItems.sourceId, feedback.id),
              ),
            ),
        ),
      ),
    )
    .orderBy(desc(feedback.createdAt))
}

/**
 * Recent Ask Jarvis prompts (the newest 1,000 for the organization) with no
 * Feedback Desk item yet.
 */
export async function unimportedConfirmedPrompts(
  db: Db,
  organizationId: string
): Promise<ReadonlyArray<{ readonly id: string; readonly payload: string; readonly createdAt: string }>> {
  const promptFilter = and(
    eq(jarvisBridgeEvents.organizationId, organizationId),
    eq(jarvisBridgeEvents.direction, "outbound"),
    eq(jarvisBridgeEvents.source, "ask-jarvis"),
    eq(jarvisBridgeEvents.eventType, "agent.prompt"),
  )
  const newest = db
    .select({ id: jarvisBridgeEvents.id })
    .from(jarvisBridgeEvents)
    .where(promptFilter)
    .orderBy(desc(jarvisBridgeEvents.createdAt))
    .limit(CONFIRMED_PROMPT_WINDOW)
  return db
    .select({
      id: jarvisBridgeEvents.id,
      payload: jarvisBridgeEvents.payload,
      createdAt: jarvisBridgeEvents.createdAt,
    })
    .from(jarvisBridgeEvents)
    .where(
      and(
        inArray(jarvisBridgeEvents.id, newest),
        notExists(
          db
            .select({ one: sql`1` })
            .from(feedbackDeskItems)
            .where(
              and(
                eq(feedbackDeskItems.organizationId, organizationId),
                eq(feedbackDeskItems.source, "ask-jarvis"),
                eq(feedbackDeskItems.sourceId, jarvisBridgeEvents.id),
              ),
            ),
        ),
      ),
    )
    .orderBy(desc(jarvisBridgeEvents.createdAt))
}
