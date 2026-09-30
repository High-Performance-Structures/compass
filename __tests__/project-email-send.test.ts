import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

import { context, openCorrespondenceTestDatabase, type CorrespondenceTestDatabase } from "./helpers/correspondence-core"
import { retryFailedProjectEmail, sendProjectEmail } from "@/app/actions/project-email"
import { saveProjectComposition } from "@/app/actions/correspondence-saved-drafts"

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  contacts: vi.fn(),
  sendEmail: vi.fn(),
  download: vi.fn(),
}))
vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/correspondence/access", () => ({ correspondenceContext: mocks.context, correspondenceContacts: mocks.contacts }))
vi.mock("@/lib/correspondence/attachment-storage", () => ({ downloadCorrespondenceAttachment: mocks.download }))
vi.mock("@/lib/email/compass-email", () => ({ sendCompassEmail: mocks.sendEmail }))

let database: CorrespondenceTestDatabase | undefined
function setup(): CorrespondenceTestDatabase {
  const db = openCorrespondenceTestDatabase()
  database = db
  db.sqlite.exec(readFileSync("drizzle/0053_email_reply_threads.sql", "utf8").replaceAll("--> statement-breakpoint", ""))
  mocks.context.mockResolvedValue(context(db, "staff-a", "project-a"))
  mocks.contacts.mockResolvedValue([{ userId: "revoked-a", name: "Staff Colleague", email: "revoked-a@example.test", role: "staff", delivery: "compass" }])
  return db
}
beforeEach(() => { vi.clearAllMocks() })
afterEach(() => database?.close())

const email = {
  projectId: "project-a", subject: "Permit update", body: "Our permit has arrived.",
  to: ["bidder@example.com"], cc: ["architect@example.com"], bcc: ["quiet@example.com"],
  requestId: "0123456789abcdef0123456789abcdef",
}

describe("project email send", () => {
  it.each(["text","audience"])("rejects changed %s under a reserved email draft", async (change) => {
    const db = setup()
    await saveProjectComposition("project-a","draft",0,{kind:"email",subject:email.subject,body:email.body,to:email.to,cc:email.cc,bcc:email.bcc,attachmentIds:[],requestId:email.requestId})
    const changed = change === "text" ? {...email,body:"Different body"} : {...email,to:["different@example.com"]}
    expect((await sendProjectEmail({...changed,draft:{id:"draft",version:1}})).success).toBe(false)
    expect(mocks.sendEmail).not.toHaveBeenCalled()
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM project_email_campaigns").get()).toEqual({n:0})
  })
  it("rejects old files that were never retained by the supplied draft", async () => {
    const db = setup()
    db.sqlite.prepare("INSERT INTO correspondence_attachments(id,organization_id,project_id,owner_user_id,name,content_type,size,drive_file_id,created_at) VALUES ('old-file','org-a','project-a','staff-a','File','text/plain',3,'drive-file','2000-01-01')").run()
    await saveProjectComposition("project-a","draft",0,{kind:"email",subject:email.subject,body:email.body,to:email.to,cc:email.cc,bcc:email.bcc,attachmentIds:[],requestId:email.requestId})
    expect((await sendProjectEmail({...email,attachmentIds:["old-file"],draft:{id:"draft",version:1}})).success).toBe(false)
    expect(mocks.sendEmail).not.toHaveBeenCalled()
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM project_email_campaigns").get()).toEqual({n:0})
  })
  it("releases a saved draft after a rejected file without dispatching, allowing correction", async () => {
    const db = setup()
    db.sqlite.prepare("INSERT INTO correspondence_attachments(id,organization_id,project_id,owner_user_id,name,content_type,size,drive_file_id,created_at) VALUES ('file','org-a','project-a','staff-a','File','text/plain',3,'drive-file','2026-09-01')").run()
    const content = {kind:"email",subject:email.subject,body:email.body,to:email.to,cc:email.cc,bcc:email.bcc,attachmentIds:["file"],requestId:email.requestId}
    expect((await saveProjectComposition("project-a","draft",0,content)).success).toBe(true)
    db.sqlite.prepare("UPDATE correspondence_attachments SET retired_at='2026-09-30' WHERE id='file'").run()
    expect(await sendProjectEmail({...email,attachmentIds:["file"],draft:{id:"draft",version:1}})).toMatchObject({success:false,draftVersion:2})
    expect(mocks.sendEmail).not.toHaveBeenCalled()
    expect((await saveProjectComposition("project-a","draft",2,{...content,attachmentIds:[],requestId:null})).success).toBe(true)
  })
  it("keeps an already recorded campaign immutable when an old draft request changes", async () => {
    const db = setup()
    const content = {kind:"email",subject:email.subject,body:email.body,to:email.to,cc:email.cc,bcc:email.bcc,attachmentIds:[],requestId:email.requestId}
    await saveProjectComposition("project-a","draft",0,content)
    mocks.sendEmail.mockResolvedValue({status:"sent",provider:"gmail",providerMessageId:"sent",error:null})
    const input = {...email,draft:{id:"draft",version:1}}
    expect(await sendProjectEmail(input)).toMatchObject({success:true,status:"sent"})
    const changed = await sendProjectEmail({...input,body:"Different email"})
    expect(changed.success).toBe(false)
    expect(changed).not.toHaveProperty("draftVersion")
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1)
    expect(db.sqlite.prepare("SELECT retired_at FROM correspondence_saved_drafts WHERE id='draft'").get()).toEqual({retired_at:expect.any(String)})
  })
  it("emails distinct To/Cc/Bcc audiences and saves a staff-only conversation once", async () => {
    const db = setup()
    mocks.sendEmail.mockResolvedValue({ status: "sent", provider: "gmail", providerMessageId: "gmail-1", error: null })
    const first = await sendProjectEmail(email)
    expect(first).toMatchObject({ success: true, status: "sent" })
    expect(mocks.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: ["bidder@example.com"], cc: ["architect@example.com"], bcc: ["quiet@example.com"] }))
    expect(mocks.sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      replyTo: expect.stringMatching(/^"project-a - Project Messages" <jarvis\+cmp-[a-z0-9]{18}@hps-colorado\.com>$/),
      text: expect.stringContaining("Project email: jarvis+project-project-a@hps-colorado.com"),
    }))
    expect(db.sqlite.prepare("SELECT source,body FROM correspondence_messages").get()).toEqual({ source: "email", body: "Our permit has arrived." })
    expect(db.sqlite.prepare("SELECT user_id FROM correspondence_participants ORDER BY user_id").all()).toEqual([{ user_id: "revoked-a" }, { user_id: "staff-a" }])
    expect(db.sqlite.prepare("SELECT email,kind FROM project_email_recipients ORDER BY kind,email").all()).toEqual([
      { email: "quiet@example.com", kind: "bcc" }, { email: "architect@example.com", kind: "cc" }, { email: "bidder@example.com", kind: "to" },
    ])
    expect(await sendProjectEmail(email)).toEqual(first)
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1)
  })

  it("grants To/Cc active project users, keeps Bcc hidden, and grants no outsiders", async () => {
    const db = setup()
    mocks.contacts.mockResolvedValue([
      { userId: "owner-a", name: "Owner A", email: "Owner-A@Example.test", role: "owner", delivery: "compass" },
      { userId: "revoked-a", name: "Staff A", email: "revoked-a@example.test", role: "staff", delivery: "compass" },
    ])
    mocks.sendEmail.mockResolvedValue({ status: "sent", provider: "gmail", providerMessageId: "gmail-1", error: null })
    const result = await sendProjectEmail({ ...email, cc: ["owner-a@example.test"] })
    expect(result).toMatchObject({ success: true, status: "sent" })
    expect(db.sqlite.prepare("SELECT role FROM correspondence_participants WHERE user_id='owner-a'").get()).toEqual({ role: "owner" })
    expect(db.sqlite.prepare("SELECT kind FROM correspondence_recipients WHERE user_id='owner-a'").get()).toEqual({ kind: "to" })
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM correspondence_participants").get()).toEqual({ count: 3 })
  })

  it("grants a project vendor only when they are addressed and assigned to the project", async () => {
    const db = setup()
    db.sqlite.exec("UPDATE project_members SET role='supplier' WHERE user_id='owner-a'; UPDATE organization_members SET role='supplier' WHERE user_id='owner-a'")
    mocks.contacts.mockResolvedValue([{ userId: "owner-a", name: "Vendor A", email: "owner-a@example.test", role: "sub_vendor", delivery: "compass" }])
    mocks.sendEmail.mockResolvedValue({ status: "sent", provider: "gmail", providerMessageId: "gmail-1", error: null })
    expect(await sendProjectEmail({ ...email, to: ["owner-a@example.test"] })).toMatchObject({ success: true, status: "sent" })
    expect(db.sqlite.prepare("SELECT role FROM correspondence_participants WHERE user_id='owner-a'").get()).toEqual({ role: "sub_vendor" })
  })

  it("grants an active owner addressed only in Bcc for their private Compass view", async () => {
    const db = setup()
    mocks.contacts.mockResolvedValue([{ userId: "owner-a", name: "Owner A", email: "owner-a@example.test", role: "owner", delivery: "compass" }])
    mocks.sendEmail.mockResolvedValue({ status: "sent", provider: "gmail", providerMessageId: "gmail-1", error: null })
    await sendProjectEmail({ ...email, bcc: ["owner-a@example.test"] })
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM correspondence_participants WHERE user_id='owner-a'").get()).toEqual({ count: 1 })
  })

  it("rolls back if project access is removed during the write", async () => {
    const db = setup()
    mocks.contacts.mockResolvedValue([{ userId: "owner-a", name: "Owner A", email: "owner-a@example.test", role: "owner", delivery: "compass" }])
    db.failures.setBeforeBatchHook((sqlite) => sqlite.exec("DELETE FROM project_members WHERE user_id='owner-a'"))
    expect((await sendProjectEmail({ ...email, to: ["owner-a@example.test"] })).success).toBe(false)
    expect(mocks.sendEmail).not.toHaveBeenCalled()
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM project_correspondence").get()).toEqual({ count: 0 })
  })

  it("saves attachments atomically, sends their bytes, and retries the same files", async () => {
    const db = setup()
    const now = new Date().toISOString()
    db.sqlite.prepare("INSERT INTO correspondence_attachments (id,organization_id,project_id,owner_user_id,name,content_type,size,drive_file_id,created_at) VALUES ('file-1','org-a','project-a','staff-a','Plan.pdf','application/pdf',4,'drive-1',?)").run(now)
    mocks.download.mockImplementation(async () => ({ body: new Response(new Uint8Array([0, 255, 1, 2])), name: "Plan.pdf", contentType: "application/pdf" }))
    mocks.sendEmail.mockResolvedValueOnce({ status: "failed", provider: "gmail", providerMessageId: null, error: "rejected" }).mockResolvedValueOnce({ status: "sent", provider: "gmail", providerMessageId: "gmail-1", error: null })
    const result = await sendProjectEmail({ ...email, attachmentIds: ["file-1"] })
    if (!result.success) throw new Error("Expected saved campaign")
    expect(result.status).toBe("failed")
    expect(mocks.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ attachments: [{ filename: "Plan.pdf", contentType: "application/pdf", content: new Uint8Array([0, 255, 1, 2]) }] }))
    expect(db.sqlite.prepare("SELECT message_id FROM correspondence_attachments WHERE id='file-1'").get()).toEqual({ message_id: `message-${result.conversationId.replace("conversation-", "")}` })
    expect((await retryFailedProjectEmail(email.projectId, result.conversationId))).toMatchObject({ success: true, status: "sent" })
    expect(mocks.download).toHaveBeenCalledTimes(2)
  })

  it("rejects another user's attachment and oversize files before saving or sending", async () => {
    const db = setup()
    const now = new Date().toISOString()
    db.sqlite.prepare("INSERT INTO correspondence_attachments (id,organization_id,project_id,owner_user_id,name,content_type,size,drive_file_id,created_at) VALUES ('file-other','org-a','project-a','owner-a','Other.pdf','application/pdf',4,'drive-other',?)").run(now)
    db.sqlite.prepare("INSERT INTO correspondence_attachments (id,organization_id,project_id,owner_user_id,name,content_type,size,drive_file_id,created_at) VALUES ('file-large','org-a','project-a','staff-a','Large.pdf','application/pdf',20000000,'drive-large',?)").run(now)
    expect((await sendProjectEmail({ ...email, attachmentIds: ["file-other"] })).success).toBe(false)
    expect((await sendProjectEmail({ ...email, attachmentIds: ["file-large"] })).success).toBe(false)
    expect(mocks.sendEmail).not.toHaveBeenCalled()
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM project_correspondence").get()).toEqual({ count: 0 })
  })

  it("retries only a definite failure with the original saved audience", async () => {
    const db = setup()
    mocks.sendEmail.mockResolvedValueOnce({ status: "failed", provider: "gmail", providerMessageId: null, error: "provider rejected" })
      .mockResolvedValueOnce({ status: "sent", provider: "gmail", providerMessageId: "gmail-2", error: null })
    const first = await sendProjectEmail(email)
    expect(first).toMatchObject({ success: true, status: "failed" })
    if (!first.success) throw new Error("Expected a saved campaign")
    const retry = await retryFailedProjectEmail(email.projectId, first.conversationId)
    expect(retry).toMatchObject({ success: true, status: "sent" })
    expect(mocks.sendEmail).toHaveBeenCalledTimes(2)
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM project_email_campaigns").get()).toEqual({ count: 1 })
  })

  it("does not retry an unknown provider outcome", async () => {
    setup()
    mocks.sendEmail.mockRejectedValueOnce(new Error("network timeout"))
    const result = await sendProjectEmail(email)
    expect(result).toMatchObject({ success: true, status: "unknown" })
    if (!result.success) throw new Error("Expected a saved campaign")
    expect((await retryFailedProjectEmail(email.projectId, result.conversationId)).success).toBe(false)
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1)
  })
})
