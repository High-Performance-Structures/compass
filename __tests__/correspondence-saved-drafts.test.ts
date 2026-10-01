import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { context, insertConversation, insertParticipant, openCorrespondenceTestDatabase, type CorrespondenceTestDatabase } from "./helpers/correspondence-core"
const mocks = vi.hoisted(() => ({ context: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/correspondence/access", async (original) => ({ ...await original<typeof import("@/lib/correspondence/access")>(), correspondenceContext: mocks.context }))
import { getProjectDrafts, saveProjectComposition, setProjectDraftDiscarded } from "@/app/actions/correspondence-saved-drafts"
import { saveCorrespondenceDraft, sendCorrespondence, searchCorrespondence } from "@/app/actions/project-correspondence"
import { listCorrespondence } from "@/lib/correspondence/read"
import type { CompositionContent } from "@/lib/correspondence/types"

const message: CompositionContent = { kind: "message", subject: "Permit", body: "Draft text", recipientUserIds: ["staff-a"], attachmentIds: [], requestId: null }
describe("private project Drafts and Sent", () => {
  let database: CorrespondenceTestDatabase
  beforeEach(() => { database = openCorrespondenceTestDatabase(); mocks.context.mockImplementation(async (projectId: string) => context(database, "owner-a", projectId)) })
  afterEach(() => { database.close(); vi.clearAllMocks() })
  it("stores multiple drafts, preserves Bcc and separates author and project", async () => {
    expect((await saveProjectComposition("project-a", "draft-1", 0, message)).success).toBe(true)
    expect((await saveProjectComposition("project-a", "draft-2", 0, { ...message, subject: "Second" })).success).toBe(true)
    expect((await getProjectDrafts("project-a"))).toMatchObject({ success: true, data: [expect.anything(), expect.anything()] })
    expect(await getProjectDrafts("project-b")).toEqual({ success: true, data: [] })
    mocks.context.mockImplementation(async (id: string) => context(database, "staff-a", id))
    expect(await getProjectDrafts("project-a")).toEqual({ success: true, data: [] })
    expect((await saveProjectComposition("project-a", "draft-1", 1, { ...message, body: "Other user" })).success).toBe(false)
    const email: CompositionContent = { kind: "email", subject: "Private", body: "Email draft", to: [], cc: [], bcc: ["hidden@example.test"], attachmentIds: [], requestId: null }
    expect((await saveProjectComposition("project-a", "email-1", 0, email)).success).toBe(true)
    expect(await getProjectDrafts("project-a")).toMatchObject({ success: true, data: [{ content: { bcc: ["hidden@example.test"] } }] })
  })
  it("rejects conflicting saves and stale resurrection after discard, with versioned recovery", async () => {
    await saveProjectComposition("project-a", "draft-1", 0, message)
    expect((await saveProjectComposition("project-a", "draft-1", 0, message)).success).toBe(false)
    expect((await setProjectDraftDiscarded("project-a", "draft-1", 1, true)).success).toBe(true)
    expect((await saveProjectComposition("project-a", "draft-1", 1, message)).success).toBe(false)
    expect(await getProjectDrafts("project-a")).toEqual({ success: true, data: [] })
    expect((await setProjectDraftDiscarded("project-a", "draft-1", 2, false)).success).toBe(true)
    expect((await getProjectDrafts("project-a"))).toMatchObject({ success: true, data: [{ content: { body: "Draft text" }, version: 3 }] })
  })
  it("rejects external email composition, other users' files, retired files and excessive files", async () => {
    expect((await saveProjectComposition("project-a", "email-1", 0, { kind: "email", subject: "x", body: "y", to: [], cc: [], bcc: [], attachmentIds: [], requestId: null })).success).toBe(false)
    database.sqlite.prepare("INSERT INTO correspondence_attachments(id,organization_id,project_id,owner_user_id,name,content_type,size,drive_file_id,created_at) VALUES ('file','org-a','project-a','staff-a','File','text/plain',3,'drive-file','2026-09-01')").run()
    expect((await saveProjectComposition("project-a", "draft-1", 0, { ...message, attachmentIds: ["file"] })).success).toBe(false)
    expect((await saveProjectComposition("project-a", "draft-1", 0, { ...message, attachmentIds: Array.from({length:11}, (_,i) => `file-${i}`) })).success).toBe(false)
  })
  it("rehydrates owned attachments, preserves old saved files, retires sent draft atomically and retries once", async () => {
    database.sqlite.prepare("INSERT INTO correspondence_attachments(id,organization_id,project_id,owner_user_id,name,content_type,size,drive_file_id,created_at) VALUES ('file','org-a','project-a','owner-a','File','text/plain',3,'drive-file','2026-09-01')").run()
    const content = { ...message, attachmentIds: ["file"], requestId: "persistent-send-request" }
    const saved = await saveProjectComposition("project-a", "draft-1", 0, content)
    expect(saved).toMatchObject({ success: true, data: { attachments: [{ name: "File", available: true }] } })
    const input = { projectId: "project-a", conversationId: null, subject: "Permit", body: "Draft text", recipientUserIds: ["staff-a"], attachmentIds: ["file"], idempotencyKey: "persistent-send-request", participantVersion: null, draft: { id: "draft-1", version: 1 } }
    database.sqlite.prepare("INSERT INTO project_contacts(id,project_id,contact_type,source_entity_type,source_entity_id,display_name,owner_portal_visible) VALUES ('staff-contact','project-a','internal','user','staff-a','Staff A',1)").run()
    const sent = await sendCorrespondence(input)
    expect(sent.success).toBe(true)
    expect(await sendCorrespondence(input)).toEqual(sent)
    expect(await getProjectDrafts("project-a")).toEqual({ success: true, data: [] })
    expect(database.sqlite.prepare("SELECT COUNT(*) AS n FROM correspondence_messages").get()).toEqual({ n: 1 })
    expect((await listCorrespondence(context(database, "owner-a", "project-a")))[0]?.lastSentAt).toBeTruthy()
    expect((await listCorrespondence(context(database, "staff-a", "project-a")))[0]?.lastSentAt).toBeNull()
    expect(await searchCorrespondence("project-a", "Draft", "sent")).toMatchObject({ success: true, data: { hits: [expect.anything()] } })
  })
  it("rolls back sending when another tab changed the draft", async () => {
    await saveProjectComposition("project-a", "draft-1", 0, { ...message, requestId: "persistent-send-request" })
    await saveProjectComposition("project-a", "draft-1", 1, { ...message, requestId: "persistent-send-request" })
    expect((await sendCorrespondence({ projectId: "project-a", conversationId: null, subject: "Permit", body: "Draft text", recipientUserIds: ["staff-a"], attachmentIds: [], idempotencyKey: "persistent-send-request", participantVersion: null, draft: { id: "draft-1", version: 1 } })).success).toBe(false)
    expect(database.sqlite.prepare("SELECT COUNT(*) AS n FROM correspondence_messages").get()).toEqual({ n: 0 })
  })
  it("rejects changed text under a reserved native message draft", async () => {
    database.sqlite.prepare("INSERT INTO project_contacts(id,project_id,contact_type,source_entity_type,source_entity_id,display_name,owner_portal_visible) VALUES ('staff-contact','project-a','internal','user','staff-a','Staff A',1)").run()
    await saveProjectComposition("project-a","draft",0,{...message,requestId:"persistent-send-request"})
    expect((await sendCorrespondence({projectId:"project-a",conversationId:null,subject:"Permit",body:"Different text",recipientUserIds:["staff-a"],attachmentIds:[],idempotencyKey:"persistent-send-request",participantVersion:null,draft:{id:"draft",version:1}})).success).toBe(false)
    expect(database.sqlite.prepare("SELECT COUNT(*) AS n FROM correspondence_messages").get()).toEqual({n:0})
    expect(await getProjectDrafts("project-a")).toMatchObject({success:true,data:[{content:{body:"Draft text"}}]})
  })
  it("rejects an old message file not present in the reserved draft", async () => {
    database.sqlite.prepare("INSERT INTO project_contacts(id,project_id,contact_type,source_entity_type,source_entity_id,display_name,owner_portal_visible) VALUES ('staff-contact','project-a','internal','user','staff-a','Staff A',1)").run()
    database.sqlite.prepare("INSERT INTO correspondence_attachments(id,organization_id,project_id,owner_user_id,name,content_type,size,drive_file_id,created_at) VALUES ('old-file','org-a','project-a','owner-a','File','text/plain',3,'drive-file','2000-01-01')").run()
    await saveProjectComposition("project-a","draft",0,{...message,requestId:"persistent-send-request"})
    expect((await sendCorrespondence({projectId:"project-a",conversationId:null,subject:"Permit",body:"Draft text",recipientUserIds:["staff-a"],attachmentIds:["old-file"],idempotencyKey:"persistent-send-request",participantVersion:null,draft:{id:"draft",version:1}})).success).toBe(false)
    expect(database.sqlite.prepare("SELECT COUNT(*) AS n FROM correspondence_messages").get()).toEqual({n:0})
  })
  it("unlocks a definitely rejected send so recipients can be corrected", async () => {
    await saveProjectComposition("project-a", "draft-1", 0, { ...message, requestId: "persistent-send-request" })
    expect(await sendCorrespondence({projectId:"project-a",conversationId:null,subject:"Permit",body:"Draft text",recipientUserIds:["missing-user"],attachmentIds:[],idempotencyKey:"persistent-send-request",participantVersion:null,draft:{id:"draft-1",version:1}})).toMatchObject({success:false,retry:"edit",draftVersion:2})
    expect((await saveProjectComposition("project-a","draft-1",2,{...message,recipientUserIds:[]})).success).toBe(true)
  })
  it("lists private reply drafts only while conversation access exists", async () => {
    insertConversation(database.sqlite, {id:"thread",projectId:"project-a",subject:"Reply here"})
    insertParticipant(database.sqlite,{id:"p",conversationId:"thread",userId:"owner-a",role:"owner"})
    expect((await saveCorrespondenceDraft("project-a", "thread", "Unsent reply", 0)).success).toBe(true)
    expect(await getProjectDrafts("project-a")).toMatchObject({ success:true,data:[{kind:"reply",subject:"Reply here",body:"Unsent reply"}] })
    database.sqlite.prepare("UPDATE correspondence_participants SET revoked_at='2026-09-30' WHERE id='p'").run()
    expect(await getProjectDrafts("project-a")).toEqual({success:true,data:[]})
  })
})
