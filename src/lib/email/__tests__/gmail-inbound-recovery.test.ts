import { readFileSync } from "node:fs"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { openCorrespondenceTestDatabase, type CorrespondenceTestDatabase } from "../../../../__tests__/helpers/correspondence-core"
import { syncGmailInboundReplies } from "../gmail-inbound"
import { deferMailbox } from "../mailbox-state"
const mocks = vi.hoisted(() => ({ access: vi.fn(), fetch: vi.fn() }))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/email/compass-email", () => ({ COMPASS_GMAIL_READONLY_SCOPE: "readonly", getCompassGmailAccessToken: mocks.access }))
let db: CorrespondenceTestDatabase
const now = "2026-10-27T00:00:00.000Z"
const input = (): Parameters<typeof syncGmailInboundReplies>[0] => ({ db: db.db, env: { COMPASS_REPLY_MAILBOX: "reply@example.test" }, organizationId: "org-a" })
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now); vi.resetAllMocks()
  db = openCorrespondenceTestDatabase()
  db.sqlite.exec(readFileSync("drizzle/0053_email_reply_threads.sql", "utf8"))
  db.sqlite.exec("CREATE TABLE email_mailbox_state (mailbox TEXT PRIMARY KEY, next_allowed_at TEXT NOT NULL, lease_token TEXT, lease_expires_at TEXT NOT NULL)")
  mocks.access.mockResolvedValue({ success: true, accessToken: "test", sender: "reply@example.test" })
  vi.stubGlobal("fetch", mocks.fetch)
})
afterEach(() => { db.close(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe("inbound Gmail quota recovery", () => {
  it("waits through a known cooldown without authorizing or calling Gmail", async () => {
    await deferMailbox(db.db, "reply@example.test", "2026-10-27T01:00:00.000Z")
    expect((await syncGmailInboundReplies(input())).scanned).toBe(0)
    expect(mocks.access).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it("saves a list-request retry time and pauses subsequent scheduled syncs", async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ error: { message: "Retry after 2026-10-27T00:15:00Z" } }), { status: 429 }))
    expect((await syncGmailInboundReplies(input())).errors).toHaveLength(1)
    await syncGmailInboundReplies(input())
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(db.sqlite.prepare("SELECT next_allowed_at FROM email_mailbox_state").get()).toEqual({ next_allowed_at: "2026-10-27T00:15:05.000Z" })
  })
  it("stops on the first rate-limited message rather than hitting the remaining messages", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ messages: [{ id: "a" }, { id: "b" }, { id: "c" }] })))
      .mockResolvedValueOnce(new Response("Rate limit exceeded", { status: 429 }))
    expect((await syncGmailInboundReplies(input())).errors).toHaveLength(1)
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
  })
  it("skips downloading a body already imported in Compass", async () => {
    db.sqlite.exec(`INSERT INTO inbound_emails(id,organization_id,gmail_message_id,from_address,subject,matched_status,received_at,imported_at)
      VALUES ('cached','org-a','a','owner@example.test','Reply','posted','${now}','${now}')`)
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: "a" }] })))
    expect((await syncGmailInboundReplies(input())).skippedDuplicates).toBe(1)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
  it("allows sequential organization scans of the same mailbox after successful sync", async () => {
    mocks.fetch.mockImplementation(async () => new Response(JSON.stringify({ messages: [] })))
    await syncGmailInboundReplies(input())
    await syncGmailInboundReplies({ ...input(), organizationId: "org-b" })
    expect(mocks.access).toHaveBeenCalledTimes(2)
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
  })
  it("does not overlap concurrent syncs of the same mailbox", async () => {
    mocks.fetch.mockImplementation(async () => new Response(JSON.stringify({ messages: [] })))
    await Promise.all([syncGmailInboundReplies(input()), syncGmailInboundReplies(input())])
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
})
