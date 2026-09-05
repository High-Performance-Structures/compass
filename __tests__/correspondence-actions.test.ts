import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { context, insertConversation, insertGrant, insertMessage, insertParticipant, openCorrespondenceTestDatabase, type CorrespondenceTestDatabase } from "./helpers/correspondence-core"

const mocks = vi.hoisted(() => ({ context: vi.fn(), revalidate: vi.fn() }))
vi.mock("@/lib/correspondence/access", async (original) => {
  const actual = await original<typeof import("@/lib/correspondence/access")>()
  return { ...actual, correspondenceContext: mocks.context }
})
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }))
import { discardCorrespondenceDraft, getCorrespondenceDetail, markCorrespondenceOpened, reviseCorrespondenceMessage, saveCorrespondenceDraft, searchCorrespondence, sendCorrespondence, setCorrespondenceReceiptPreference, setCorrespondenceState } from "@/app/actions/project-correspondence"

describe("correspondence actions against SQLite", () => {
  let database: CorrespondenceTestDatabase
  beforeEach(() => {
    database = openCorrespondenceTestDatabase()
    insertConversation(database.sqlite, { id: "thread", projectId: "project-a", subject: "Subject" })
    for (const userId of ["owner-a", "staff-a"]) insertParticipant(database.sqlite, { id: `participant-${userId}`, conversationId: "thread", userId, role: userId === "owner-a" ? "owner" : "staff" })
    for (const id of ["seen", "unseen"]) {
      insertMessage(database.sqlite, { id, conversationId: "thread", authorUserId: "staff-a", body: id, source: "compass" })
      for (const userId of ["owner-a", "staff-a"]) insertGrant(database.sqlite, { id: `${id}-${userId}`, messageId: id, userId, kind: userId === "owner-a" ? "to" : "author" })
    }
    mocks.context.mockImplementation(async () => context(database, "owner-a", "project-a"))
  })
  afterEach(() => { database.close(); vi.clearAllMocks() })

  it("saves drafts with version fencing and cannot resurrect a discarded draft", async () => {
    expect(await saveCorrespondenceDraft("project-a", "thread", "Draft", 0)).toEqual({ success: true, data: { version: 1 } })
    expect((await saveCorrespondenceDraft("project-a", "thread", "Conflicting device", 0)).success).toBe(false)
    expect((await discardCorrespondenceDraft("project-a", "thread", 1)).success).toBe(true)
    expect((await saveCorrespondenceDraft("project-a", "thread", "Delayed autosave", 1)).success).toBe(false)
    const result = await getCorrespondenceDetail("project-a", "thread")
    expect(result.success && result.data.draft).toEqual({ body: "", version: 2 })
  })
  it("marks only observed messages, and does not certify a newer edit", async () => {
    expect((await markCorrespondenceOpened("project-a", "thread", [{ id: "seen", editedAt: null }])).success).toBe(true)
    const rows = database.sqlite.prepare("SELECT message_id,opened_at FROM correspondence_recipients WHERE user_id='owner-a' ORDER BY message_id").all()
    expect(rows).toEqual([{ message_id: "seen", opened_at: expect.any(String) }, { message_id: "unseen", opened_at: null }])
    mocks.context.mockImplementation(async () => context(database, "staff-a", "project-a"))
    expect((await reviseCorrespondenceMessage("project-a", "thread", "seen", "Revised")).success).toBe(true)
    mocks.context.mockImplementation(async () => context(database, "owner-a", "project-a"))
    await markCorrespondenceOpened("project-a", "thread", [{ id: "seen", editedAt: null }])
    expect(database.sqlite.prepare("SELECT opened_at FROM correspondence_recipients WHERE message_id='seen' AND user_id='owner-a'").get()).toEqual({ opened_at: null })
  })
  it("denies editing others' or imported messages and retains retraction audit", async () => {
    expect((await reviseCorrespondenceMessage("project-a", "thread", "seen", "Impersonation")).success).toBe(false)
    mocks.context.mockImplementation(async () => context(database, "staff-a", "project-a"))
    database.sqlite.prepare("UPDATE correspondence_messages SET source='buildertrend' WHERE id='unseen'").run()
    expect((await reviseCorrespondenceMessage("project-a", "thread", "unseen", "Alter source")).success).toBe(false)
    expect((await reviseCorrespondenceMessage("project-a", "thread", "seen", null)).success).toBe(true)
    const result = await getCorrespondenceDetail("project-a", "thread")
    expect(result.success && result.data.messages.find((m) => m.id === "seen")?.body).toBe("")
    expect(database.sqlite.prepare("SELECT previous_body,operation FROM correspondence_revisions WHERE message_id='seen'").get()).toEqual({ previous_body: "seen", operation: "retract" })
  })
  it("personal archive and saved state cannot mutate another user's inbox", async () => {
    expect((await setCorrespondenceState("project-a", "thread", { saved: true, followUp: true, archived: true })).success).toBe(true)
    mocks.context.mockImplementation(async () => context(database, "staff-a", "project-a"))
    const result = await getCorrespondenceDetail("project-a", "thread")
    expect(result.success && result.data.conversation.saved).toBe(false)
  })
  it("keeps private unread independent from shared receipts", async () => {
    await setCorrespondenceReceiptPreference("project-a", "thread", false)
    await markCorrespondenceOpened("project-a", "thread", [{ id: "seen", editedAt: null }])
    mocks.context.mockImplementation(async () => context(database, "staff-a", "project-a"))
    const result = await getCorrespondenceDetail("project-a", "thread")
    expect(result.success && result.data.messages.find((m) => m.id === "seen")?.readReceipts).toEqual([{ userId: "owner-a", name: "owner-a", status: "unavailable", openedAt: null }])
    expect(database.sqlite.prepare("SELECT opened_at FROM correspondence_recipients WHERE message_id='seen' AND user_id='owner-a'").get()).toEqual({ opened_at: expect.any(String) })
  })
  it("searches older body text but never another historical audience", async () => {
    database.sqlite.prepare("UPDATE correspondence_messages SET body='older cabinet finish decision' WHERE id='seen'").run()
    insertMessage(database.sqlite, { id: "hidden", conversationId: "thread", authorUserId: "staff-a", body: "cabinet secret pricing" })
    insertGrant(database.sqlite, { id: "hidden-staff", messageId: "hidden", userId: "staff-a" })
    const result = await searchCorrespondence("project-a", "cabinet")
    expect(result.success && result.data.hits.map((hit) => hit.messageId)).toEqual(["seen"])
  })

  it("marks a definite pre-write attachment rejection as editable and writes nothing", async () => {
    mocks.context.mockImplementation(async () => context(database, "staff-a", "project-a"))
    const before = database.sqlite.prepare("SELECT COUNT(*) AS count FROM correspondence_messages").get()

    const result = await sendCorrespondence({
      projectId: "project-a", conversationId: "thread", subject: "Subject", recipientUserIds: ["owner-a"],
      body: "Missing staged file", idempotencyKey: "action-attachment-01", participantVersion: 1, attachmentIds: ["missing-staged-file"],
    })

    expect(result).toEqual({ success: false, error: expect.stringContaining("attachment"), retry: "edit" })
    expect(database.sqlite.prepare("SELECT COUNT(*) AS count FROM correspondence_messages").get()).toEqual(before)
    expect(database.sqlite.prepare("SELECT COUNT(*) AS count FROM correspondence_outbox").get()).toMatchObject({ count: 0 })
  })

  it("marks a rolled-back batch failure as same_request and leaves no partial message", async () => {
    mocks.context.mockImplementation(async () => context(database, "staff-a", "project-a"))
    database.failures.failNextMatching('insert into "correspondence_messages"')

    const result = await sendCorrespondence({
      projectId: "project-a", conversationId: "thread", subject: "Subject", recipientUserIds: ["owner-a"],
      body: "Batch failure", idempotencyKey: "action-batch-fail-1", participantVersion: 1, attachmentIds: [],
    })

    expect(result).toEqual({ success: false, error: expect.any(String), retry: "same_request" })
    expect(database.sqlite.prepare("SELECT COUNT(*) AS count FROM correspondence_messages WHERE body = ?").get("Batch failure")).toMatchObject({ count: 0 })
    expect(database.sqlite.prepare("SELECT COUNT(*) AS count FROM correspondence_outbox").get()).toMatchObject({ count: 0 })
  })

  it("returns same_request when cache invalidation fails after commit and retries idempotently", async () => {
    mocks.context.mockImplementation(async () => context(database, "staff-a", "project-a"))
    mocks.revalidate.mockImplementationOnce(() => { throw new Error("cache invalidation failed") })
    const input = {
      projectId: "project-a", conversationId: "thread", subject: "Subject", recipientUserIds: ["owner-a"],
      body: "Committed before cache failure", idempotencyKey: "action-cache-fail-1", participantVersion: 1, attachmentIds: [],
    } as const

    const first = await sendCorrespondence(input)
    expect(first).toEqual({ success: false, error: "cache invalidation failed", retry: "same_request" })
    const second = await sendCorrespondence(input)
    expect(second.success).toBe(true)
    expect(database.sqlite.prepare("SELECT COUNT(*) AS count FROM correspondence_messages WHERE body = ?").get(input.body)).toMatchObject({ count: 1 })
  })

})
