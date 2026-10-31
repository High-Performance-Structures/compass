import { and, eq, isNull, sql } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import { getDb } from "@/db"
import { correspondenceDrafts, correspondenceSavedDrafts, correspondenceWriteGuards } from "@/db/schema-correspondence"
import { JS_TRIM_CHARACTERS } from "@/lib/domain/correspondence/rules"
import {
  clearSentReplyDraftStatement,
  retireSavedDraftStatement,
  writeGuardDeleteStatement,
  writeGuardInsertStatement,
} from "@/lib/domain/correspondence/store"

// @ts-expect-error Statements are only built here, never run.
const db = getDb({})

function sqlOf(statement: object): { sql: string; params: unknown[] } {
  return Reflect.apply(Reflect.get(statement, "toSQL"), statement, [])
}

describe("correspondence store", () => {
  it("clears a sent reply draft with the statement send.ts built before", () => {
    const now = "2026-10-30T12:00:00.000Z"
    expect(sqlOf(clearSentReplyDraftStatement(db, { conversationId: "c1", userId: "u1", sentBody: "  hi  ", now }))).toEqual(
      db.update(correspondenceDrafts).set({ body: "", attachmentIds: [], version: sql`${correspondenceDrafts.version} + 1`, updatedAt: now })
        .where(and(eq(correspondenceDrafts.conversationId, "c1"), eq(correspondenceDrafts.userId, "u1"), sql`trim(${correspondenceDrafts.body}, ${JS_TRIM_CHARACTERS})=${"hi"}`))
        .toSQL(),
    )
  })

  it("writes and clears batch write guards", () => {
    const allowed = sql`CASE WHEN 1 THEN 1 ELSE 0 END`
    expect(sqlOf(writeGuardInsertStatement(db, "g1", allowed))).toEqual(db.insert(correspondenceWriteGuards).values({ id: "g1", allowed }).toSQL())
    expect(sqlOf(writeGuardDeleteStatement(db, "g1"))).toEqual(db.delete(correspondenceWriteGuards).where(eq(correspondenceWriteGuards.id, "g1")).toSQL())
  })

  it("retires only the owner's live draft at the reserved version", () => {
    const { sql: text, params } = sqlOf(retireSavedDraftStatement(db, { id: "d1", organizationId: "o1", projectId: "p1", userId: "u1" }, 3))
    expect(text).toContain('"retired_at" is null')
    expect(params).toEqual(expect.arrayContaining(["d1", "o1", "p1", "u1", 3]))
    expect(text).toBe(
      db.update(correspondenceSavedDrafts).set({ retiredAt: "x", version: sql`${correspondenceSavedDrafts.version}+1` })
        .where(and(eq(correspondenceSavedDrafts.id, "d1"), eq(correspondenceSavedDrafts.organizationId, "o1"), eq(correspondenceSavedDrafts.projectId, "p1"), eq(correspondenceSavedDrafts.userId, "u1"), eq(correspondenceSavedDrafts.version, 3), isNull(correspondenceSavedDrafts.retiredAt)))
        .toSQL().sql,
    )
  })
})
