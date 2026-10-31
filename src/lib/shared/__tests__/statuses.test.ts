import { sql } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import { sqliteDb } from "@/lib/domain/__tests__/sqlite-d1"
import { insertAccountDeletionRequest } from "@/lib/domain/identity/store"
import { assertListFields, isListValue, listValueOr, requireListValue } from "@/lib/shared/statuses"

const STATUSES = ["draft", "sent", "void"] as const

describe("shared status lists", () => {
  it("recognises only exact list values", () => {
    expect(isListValue(STATUSES, "sent")).toBe(true)
    expect(isListValue(STATUSES, "Sent")).toBe(false)
    expect(isListValue(STATUSES, " sent")).toBe(false)
    expect(isListValue(STATUSES, null)).toBe(false)
    expect(isListValue(STATUSES, 3)).toBe(false)
  })

  it("falls back or throws for values off the list", () => {
    expect(listValueOr(STATUSES, "void", "draft")).toBe("void")
    expect(listValueOr(STATUSES, "weird", "draft")).toBe("draft")
    expect(requireListValue(STATUSES, "sent", "letters.status")).toBe("sent")
    expect(() => requireListValue(STATUSES, "weird", "letters.status")).toThrow(
      'Unknown letters.status value: "weird"',
    )
  })

  it("checks every listed field of a row, a patch, or a set of rows", () => {
    const rules = { status: STATUSES }
    expect(() => assertListFields("letters", { status: "draft", note: "anything" }, rules)).not.toThrow()
    expect(() => assertListFields("letters", [{ status: "draft" }, { status: "sent" }], rules)).not.toThrow()
    expect(() => assertListFields("letters", [{ status: "draft" }, { status: "Sent" }], rules)).toThrow(
      'Unknown letters.status value: "Sent"',
    )
  })

  it("leaves missing, null and SQL-expression values alone", () => {
    const rules = { status: STATUSES }
    expect(() => assertListFields("letters", {}, rules)).not.toThrow()
    expect(() => assertListFields("letters", { status: null }, rules)).not.toThrow()
    expect(() => assertListFields("letters", { status: sql`'draft'` }, rules)).not.toThrow()
  })
})

const DELETION_REQUESTS_TABLE = `CREATE TABLE account_deletion_requests (
  id text PRIMARY KEY NOT NULL, user_id text, email_snapshot text, display_name_snapshot text,
  status text DEFAULT 'pending' NOT NULL, requested_at text NOT NULL, processing_started_at text,
  processing_started_by text, completed_at text, completed_by text, cancelled_at text, updated_at text NOT NULL
)`

describe("a domain store checks enumerated writes", () => {
  const request = { id: "request-1", requestedAt: "t", updatedAt: "t" } as const

  it("writes listed values unchanged", async () => {
    const { sqlite, db } = sqliteDb(DELETION_REQUESTS_TABLE)
    await insertAccountDeletionRequest(db, { ...request, status: "processing" })
    expect(sqlite.prepare("SELECT status FROM account_deletion_requests").get()).toEqual({ status: "processing" })
  })

  it("rejects a value that is not on the list before writing", async () => {
    const { sqlite, db } = sqliteDb(DELETION_REQUESTS_TABLE)
    // Untyped input (JSON, a provider payload) that skipped the type checker.
    const untyped = JSON.parse('{"status":"Pending"}')
    await expect(insertAccountDeletionRequest(db, { ...request, ...untyped })).rejects.toThrow(
      'Unknown account_deletion_requests.status value: "Pending"',
    )
    expect(sqlite.prepare("SELECT count(*) AS n FROM account_deletion_requests").get()).toEqual({ n: 0 })
  })
})
