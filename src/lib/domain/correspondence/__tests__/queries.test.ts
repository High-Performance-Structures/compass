import { describe, expect, it, vi } from "vitest"

import { inboundEmailStatuses } from "@/lib/domain/correspondence/queries"

import { sqliteDb } from "../../__tests__/sqlite-d1"

const SCHEMA = `
  CREATE TABLE inbound_emails (
    id TEXT PRIMARY KEY NOT NULL, gmail_message_id TEXT NOT NULL, matched_status TEXT NOT NULL
  );
  CREATE UNIQUE INDEX inbound_emails_gmail_message_id_idx ON inbound_emails (gmail_message_id);
`

describe("inbound email statuses (Gmail sync duplicate check)", () => {
  it("reads every stored status in chunks instead of one query per message", async () => {
    const stored = Array.from({ length: 130 }, (_, index) => index)
    const inserts = stored
      .map((index) => `INSERT INTO inbound_emails VALUES ('row-${index}', 'gmail-${index}', '${index % 2 ? "posted" : "ignored_outbound"}');`)
      .join("\n")
    const { sqlite, db } = sqliteDb(SCHEMA + inserts)
    const prepare = vi.spyOn(sqlite, "prepare")

    const ids = [...stored.map((index) => `gmail-${index}`), "gmail-new-1", "gmail-new-2"]
    const statuses = await inboundEmailStatuses(db, ids)

    // 132 ids: three IN lists of at most 50.
    expect(prepare.mock.calls.filter(([source]) => /^select/i.test(source))).toHaveLength(3)
    expect(statuses.size).toBe(130)
    expect(statuses.get("gmail-1")).toBe("posted")
    expect(statuses.get("gmail-2")).toBe("ignored_outbound")
    expect(statuses.has("gmail-new-1")).toBe(false)
  })

  it("does no read for an empty mailbox page", async () => {
    const { db } = sqliteDb(SCHEMA)
    expect((await inboundEmailStatuses(db, [])).size).toBe(0)
  })
})
