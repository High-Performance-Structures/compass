import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

import { context, openCorrespondenceTestDatabase, type CorrespondenceTestDatabase } from "./helpers/correspondence-core"
import { retryFailedProjectEmail, sendProjectEmail } from "@/app/actions/project-email"

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  contacts: vi.fn(),
  sendEmail: vi.fn(),
}))
vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/correspondence/access", () => ({ correspondenceContext: mocks.context, correspondenceContacts: mocks.contacts }))
vi.mock("@/lib/email/compass-email", () => ({ sendCompassEmail: mocks.sendEmail }))

let database: CorrespondenceTestDatabase | undefined
function setup(): CorrespondenceTestDatabase {
  const db = openCorrespondenceTestDatabase()
  database = db
  db.sqlite.exec(readFileSync("drizzle/0053_email_reply_threads.sql", "utf8").replaceAll("--> statement-breakpoint", ""))
  db.sqlite.exec(readFileSync("drizzle/0176_project_email_campaigns.sql", "utf8").replaceAll("--> statement-breakpoint", ""))
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
