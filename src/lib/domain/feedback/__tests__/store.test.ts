import { and, eq, sql } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import { getDb } from "@/db"
import { feedbackDeskItems, jarvisBridgeEvents } from "@/db/schema-jarvis"
import { insertJarvisBridgeEventsFrom, updateFeedbackDeskItems, updateJarvisBridgeEvents } from "@/lib/domain/feedback/store"

// @ts-expect-error Statements are only built here, never run.
const db = getDb({})

describe("feedback store", () => {
  it("keeps the caller's claim fence and returning clause unchanged", () => {
    const fence = and(eq(jarvisBridgeEvents.id, "e1"), eq(jarvisBridgeEvents.claimToken, "t1"))
    const changes = { status: "pending", claimToken: null, attemptCount: sql`${jarvisBridgeEvents.attemptCount} + 1` }
    expect(updateJarvisBridgeEvents(db, changes, fence).returning({ id: jarvisBridgeEvents.id }).toSQL()).toEqual(
      db.update(jarvisBridgeEvents).set(changes).where(fence).returning({ id: jarvisBridgeEvents.id }).toSQL(),
    )
  })

  it("updates desk items and inserts fenced outbox events with the same SQL", () => {
    const where = eq(feedbackDeskItems.id, "f1")
    expect(updateFeedbackDeskItems(db, { status: "triaged" }, where).toSQL()).toEqual(
      db.update(feedbackDeskItems).set({ status: "triaged" }).where(where).toSQL(),
    )
    const select = sql`select 1 where exists (select 1 from feedback_desk_items where id = ${"f1"})`
    expect(insertJarvisBridgeEventsFrom(db, select).toSQL()).toEqual(db.insert(jarvisBridgeEvents).select(select).toSQL())
  })
})
