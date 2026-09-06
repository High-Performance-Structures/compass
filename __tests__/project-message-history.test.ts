import { readFileSync } from "node:fs"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { context, insertAttachment, insertConversation, insertGrant, insertMessage, insertParticipant, openCorrespondenceTestDatabase, type CorrespondenceTestDatabase } from "./helpers/correspondence-core"

const mocks = vi.hoisted(() => ({ requireAuth: vi.fn(), getCloudflareContext: vi.fn() }))
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.getCloudflareContext }))
vi.mock("@/lib/demo", () => ({ isDemoUser: () => false }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
import { getProjectMessageHistory, getProjectMessageHistoryDetail } from "@/app/actions/project-message-history"
import { getCorrespondenceDetail, saveCorrespondenceDraft } from "@/app/actions/project-correspondence"

describe("global project correspondence history", () => {
  let database: CorrespondenceTestDatabase
  beforeEach(() => {
    database = openCorrespondenceTestDatabase()
    database.sqlite.exec(readFileSync("drizzle/0154_correspondence_source_audience.sql", "utf8").replaceAll("--> statement-breakpoint", ""))
    mocks.getCloudflareContext.mockResolvedValue({ env: { DB: database.d1, COMPASS_CORRESPONDENCE_ENABLED: "true" } })
    mocks.requireAuth.mockResolvedValue(context(database, "staff-a", "project-a").user)
    insertConversation(database.sqlite, { id: "thread", projectId: "project-a", subject: "Cabinet decision" })
    for (const userId of ["owner-a", "revoked-a"] as const) insertParticipant(database.sqlite, { id: userId, conversationId: "thread", userId, role: userId === "owner-a" ? "owner" : "staff" })
    insertMessage(database.sqlite, { id: "message", conversationId: "thread", authorUserId: "revoked-a", authorName: "Former employee", body: "Owner approved the walnut cabinetry", source: "compass" })
    insertGrant(database.sqlite, { id: "owner-grant", messageId: "message", userId: "owner-a" })
    insertGrant(database.sqlite, { id: "former-grant", messageId: "message", userId: "revoked-a", kind: "author" })
    database.sqlite.exec("UPDATE users SET is_active=0 WHERE id='revoked-a'; DELETE FROM project_members WHERE user_id='revoked-a'; DELETE FROM organization_members WHERE user_id='revoked-a';")
  })
  afterEach(() => { database.close(); vi.clearAllMocks() })

  it("retains former employees' messages and attachments without granting personal participation or exposing drafts", async () => {
    insertAttachment(database.sqlite, { id: "file", messageId: "message" })
    database.sqlite.exec("INSERT INTO correspondence_drafts (id,conversation_id,user_id,body,version,updated_at) VALUES ('draft','thread','revoked-a','PRIVATE DRAFT',1,'2026-09-05'); INSERT INTO correspondence_user_state (id,conversation_id,user_id,saved,archived) VALUES ('state','thread','revoked-a',1,1)")
    const list = await getProjectMessageHistory("project-a")
    expect(list).toMatchObject({ success: true, data: { conversations: [{ id: "thread", authorName: "Former employee" }] } })
    const result = await getProjectMessageHistoryDetail("project-a", "thread")
    expect(result).toMatchObject({ success: true, data: { draft: null, messages: [{ authorName: "Former employee", canEdit: false, attachments: [{ id: "file", available: true }] }] } })
    expect(JSON.stringify(result)).not.toContain("PRIVATE DRAFT")
    expect(database.sqlite.prepare("SELECT COUNT(*) AS count FROM correspondence_recipients WHERE opened_at IS NOT NULL").get()).toEqual({ count: 0 })
    expect((await getCorrespondenceDetail("project-a", "thread")).success).toBe(false)
    expect((await saveCorrespondenceDraft("project-a", "thread", "Cannot reply", 0)).success).toBe(false)
  })

  it("allows regular internal project staff and rejects staff after project and organization access are removed", async () => {
    database.sqlite.exec("UPDATE organization_members SET role='field_crew' WHERE user_id='staff-a'")
    mocks.requireAuth.mockResolvedValue({ ...context(database, "staff-a", "project-a").user, role: "field_crew" })
    expect((await getProjectMessageHistory("project-a")).success).toBe(true)
    database.sqlite.exec("DELETE FROM project_members WHERE user_id='staff-a'; DELETE FROM organization_members WHERE user_id='staff-a'")
    expect((await getProjectMessageHistory("project-a")).success).toBe(false)
    expect((await getProjectMessageHistoryDetail("project-a", "thread")).success).toBe(false)
  })

  it.each(["owner", "supplier"])("denies global history to %s accounts even when they participate", async (role) => {
    database.sqlite.prepare("UPDATE project_members SET role=? WHERE user_id='owner-a'").run(role)
    mocks.requireAuth.mockResolvedValue(context(database, "owner-a", "project-a").user)
    expect((await getProjectMessageHistory("project-a")).success).toBe(false)
    expect((await getProjectMessageHistoryDetail("project-a", "thread")).success).toBe(false)
  })

  it("isolates organizations and projects, including forged conversation and pagination IDs", async () => {
    insertConversation(database.sqlite, { id: "other", projectId: "project-other", organizationId: "org-b" })
    const sequence = insertMessage(database.sqlite, { id: "other-message", conversationId: "other", authorUserId: "staff-b", body: "OTHER ORGANIZATION" })
    expect(JSON.stringify(await getProjectMessageHistory("project-a"))).not.toContain("OTHER ORGANIZATION")
    expect((await getProjectMessageHistoryDetail("project-a", "other")).success).toBe(false)
    expect((await getProjectMessageHistoryDetail("project-a", "thread", sequence)).success).toBe(false)
    mocks.requireAuth.mockResolvedValue(context(database, "staff-b", "project-other").user)
    expect((await getProjectMessageHistory("project-a")).success).toBe(false)
  })

  it("searches bodies and former sender names, escapes wildcards and excludes retracted content", async () => {
    expect(await getProjectMessageHistory("project-a", "walnut")).toMatchObject({ success: true, data: { conversations: [{ id: "thread" }] } })
    expect(await getProjectMessageHistory("project-a", "Former employee")).toMatchObject({ success: true, data: { conversations: [{ id: "thread" }] } })
    expect(await getProjectMessageHistory("project-a", "%")).toMatchObject({ success: true, data: { conversations: [] } })
    database.sqlite.exec("UPDATE correspondence_messages SET retracted_at='2026-09-05' WHERE id='message'")
    expect(await getProjectMessageHistory("project-a", "walnut")).toMatchObject({ success: true, data: { conversations: [] } })
    expect(await getProjectMessageHistoryDetail("project-a", "thread")).toMatchObject({ success: true, data: { messages: [{ body: "", attachments: [] }] } })
  })

  it("pages conversations and messages completely without duplicates at equal timestamps", async () => {
    for (let index = 0; index < 55; index++) {
      insertConversation(database.sqlite, { id: `c-${index}`, projectId: "project-a" })
      insertMessage(database.sqlite, { id: `m-${index}`, conversationId: `c-${index}`, authorUserId: "revoked-a", body: "History" })
      insertMessage(database.sqlite, { id: `thread-${index}`, conversationId: "thread", authorUserId: "revoked-a", body: "History" })
    }
    const first = await getProjectMessageHistory("project-a")
    if (!first.success || !first.data.nextCursor) throw new Error("Expected more history")
    expect(first.data.conversations).toHaveLength(50)
    const second = await getProjectMessageHistory("project-a", "", first.data.nextCursor)
    if (!second.success) throw new Error(second.error)
    expect(second.data.conversations).toHaveLength(6)
    expect(new Set([...first.data.conversations, ...second.data.conversations].map((c) => c.id)).size).toBe(56)
    const latest = await getProjectMessageHistoryDetail("project-a", "thread")
    if (!latest.success) throw new Error(latest.error)
    expect(latest.data.messages).toHaveLength(50)
    const earlier = await getProjectMessageHistoryDetail("project-a", "thread", latest.data.messages[0]?.sequence)
    expect(earlier).toMatchObject({ success: true, data: { hasEarlier: false } })
    if (!earlier.success) throw new Error(earlier.error)
    expect(earlier.data.messages).toHaveLength(6)
  })
})
