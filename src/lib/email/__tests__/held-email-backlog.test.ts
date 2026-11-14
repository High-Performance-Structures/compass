import { readFileSync } from "node:fs"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { openCorrespondenceTestDatabase, type CorrespondenceTestDatabase } from "../../../../__tests__/helpers/correspondence-core"
import { postHeldEmailBacklog } from "../held-email-backlog"
import { UNVERIFIED_SENDER_NOTE } from "../sender-verification"

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  fetch: vi.fn(),
  route: vi.fn(),
  recognized: vi.fn(),
  settings: vi.fn(),
  activity: vi.fn(),
}))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/email/compass-email", () => ({ COMPASS_GMAIL_READONLY_SCOPE: "readonly", getCompassGmailAccessToken: mocks.access }))
vi.mock("@/lib/email/project-message-routing", () => ({ routeInboundProjectMessage: mocks.route }))
vi.mock("@/lib/email/project-inbound-routing", () => ({
  senderCanEmailProject: mocks.recognized,
  candidateBody: (candidate: { readonly textBody: string | null }) => candidate.textBody ?? "",
}))
vi.mock("@/lib/feature-settings/server", () => ({ readFeatureSettings: mocks.settings }))
vi.mock("@/lib/activity-log", () => ({ recordActivityEvents: mocks.activity }))

const PROJECT_ADDRESS = "Jarvis <jarvis+project-proj-h430@hps-colorado.com>"
const PASS = "mx.google.com; dkim=pass header.i=@bishopbuilt.test; spf=pass smtp.mailfrom=ezell@bishopbuilt.test; dmarc=pass header.from=bishopbuilt.test"
const FAIL = "mx.google.com; spf=fail smtp.mailfrom=ezell@bishopbuilt.test; dkim=none; dmarc=fail header.from=bishopbuilt.test"

let db: CorrespondenceTestDatabase

function heldRow(id: string, values: { readonly toAddress?: string | null; readonly subject?: string; readonly receivedAt?: string } = {}): void {
  db.sqlite.prepare(`INSERT INTO inbound_emails (id,organization_id,gmail_message_id,from_address,from_name,to_address,subject,text_body,matched_status,received_at,imported_at)
    VALUES (?,?,?,?,?,?,?,?,'needs_review',?,?)`).run(
    id, "org-a", `gmail-${id}`, "ezell@bishopbuilt.test", "Ezell", values.toAddress === undefined ? "Ezell <ezell@bishopbuilt.test>" : values.toAddress,
    values.subject ?? "Waterproofing change order", "@Staff A please see the change order.", values.receivedAt ?? "2026-10-16T12:00:00.000Z", "2026-10-16T12:00:00.000Z",
  )
}

function gmailMessage(id: string, headers: readonly { readonly name: string; readonly value: string }[]): Response {
  return new Response(JSON.stringify({
    id: `gmail-${id}`,
    threadId: `thread-${id}`,
    snippet: "please see the change order",
    internalDate: "1760616000000",
    payload: {
      mimeType: "text/plain",
      headers: [{ name: "From", value: "Ezell <ezell@bishopbuilt.test>" }, { name: "Subject", value: "Waterproofing change order" }, ...headers],
      body: { data: Buffer.from("@Staff A please see the change order.").toString("base64url") },
    },
  }))
}

function stored(id: string): { readonly to_address: string | null; readonly sender_authentication: string | null; readonly matched_status: string; readonly project_id: string | null } {
  const row: unknown = db.sqlite.prepare("SELECT to_address, sender_authentication, matched_status, project_id FROM inbound_emails WHERE id = ?").get(id)
  if (typeof row !== "object" || row === null) throw new Error(`no row ${id}`)
  return {
    to_address: "to_address" in row && typeof row.to_address === "string" ? row.to_address : null,
    sender_authentication: "sender_authentication" in row && typeof row.sender_authentication === "string" ? row.sender_authentication : null,
    matched_status: "matched_status" in row && typeof row.matched_status === "string" ? row.matched_status : "",
    project_id: "project_id" in row && typeof row.project_id === "string" ? row.project_id : null,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  db = openCorrespondenceTestDatabase()
  db.sqlite.exec(readFileSync("drizzle/0053_email_reply_threads.sql", "utf8").replaceAll("--> statement-breakpoint", ""))
  db.sqlite.exec(readFileSync("drizzle/0327_inbound_email_sender_authentication.sql", "utf8"))
  db.sqlite.exec(`INSERT INTO projects (id,organization_id,name,project_number) VALUES
    ('proj-h430','org-a','Bishop Built','H-430-1900'),('proj-o202','org-a','Loeffler','O-202-595'),('proj-other','org-b','Other company','H-999-0001')`)
  mocks.access.mockResolvedValue({ success: true, accessToken: "token", sender: "jarvis@hps-colorado.com" })
  mocks.recognized.mockResolvedValue(true)
  mocks.settings.mockResolvedValue({ mode: "enforce" })
  mocks.route.mockResolvedValue({ status: "posted", id: "message-1", filesLeftOut: false })
  vi.stubGlobal("fetch", mocks.fetch)
})
afterEach(() => {
  db.close()
  vi.unstubAllGlobals()
})

describe("held email backlog: re-reading Gmail", () => {
  it("routes a held email whose stored To lacks the job address but whose Gmail Cc has it, once", async () => {
    heldRow("cc")
    mocks.fetch.mockResolvedValueOnce(gmailMessage("cc", [
      { name: "Authentication-Results", value: PASS },
      { name: "To", value: "Ezell <ezell@bishopbuilt.test>" },
      { name: "Cc", value: PROJECT_ADDRESS },
    ]))

    const summary = await postHeldEmailBacklog({ db: db.db, env: {} })

    expect(summary).toMatchObject({ scanned: 1, posted: 1, stillHeld: 0, addressesRecovered: 1, rateLimited: false })
    // One Gmail read serves both the address and the files (this message has none).
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(mocks.route).toHaveBeenCalledTimes(1)
    const call = mocks.route.mock.calls[0]?.[0]
    expect(call).toMatchObject({ projectId: "proj-h430", quiet: true, postWhenJobKnown: true, ignoreMentions: false })
    expect(call?.candidate.toAddress).toBe(PROJECT_ADDRESS)
    expect(call?.candidate.senderAuthentication).toBe("pass")
    expect(stored("cc")).toEqual({ to_address: PROJECT_ADDRESS, sender_authentication: "pass", matched_status: "posted", project_id: "proj-h430" })

    // Running again finds nothing to do.
    const again = await postHeldEmailBacklog({ db: db.db, env: {} })
    expect(again.scanned).toBe(0)
    expect(mocks.route).toHaveBeenCalledTimes(1)
  })

  it("still ignores the @names of a known sender whose Gmail verdict fails (sender verification enforced)", async () => {
    heldRow("forged")
    mocks.fetch.mockResolvedValueOnce(gmailMessage("forged", [
      { name: "Authentication-Results", value: FAIL },
      { name: "To", value: "Ezell <ezell@bishopbuilt.test>" },
      { name: "Cc", value: PROJECT_ADDRESS },
    ]))

    const summary = await postHeldEmailBacklog({ db: db.db, env: {} })

    expect(summary.posted).toBe(1)
    const call = mocks.route.mock.calls[0]?.[0]
    expect(call).toMatchObject({ projectId: "proj-h430", quiet: true, ignoreMentions: true })
    expect(call?.body).toContain(UNVERIFIED_SENDER_NOTE)
    expect(stored("forged").sender_authentication).toBe("fail")
  })

  it("ignores the @names of a sender who is neither staff nor a job contact", async () => {
    heldRow("stranger")
    mocks.recognized.mockResolvedValue(false)
    mocks.fetch.mockResolvedValueOnce(gmailMessage("stranger", [{ name: "Authentication-Results", value: PASS }, { name: "Cc", value: PROJECT_ADDRESS }]))

    await postHeldEmailBacklog({ db: db.db, env: {} })

    expect(mocks.route.mock.calls[0]?.[0]).toMatchObject({ ignoreMentions: true })
  })

  it("never moves an email already addressed to a job, and never routes to another company's job", async () => {
    heldRow("addressed", { toAddress: "jarvis+project-proj-o202@hps-colorado.com", receivedAt: "2026-10-16T12:00:00.000Z" })
    heldRow("foreign", { receivedAt: "2026-10-17T12:00:00.000Z" })
    mocks.fetch
      .mockResolvedValueOnce(gmailMessage("addressed", [{ name: "Authentication-Results", value: PASS }, { name: "Cc", value: PROJECT_ADDRESS }]))
      .mockResolvedValueOnce(gmailMessage("foreign", [{ name: "Authentication-Results", value: PASS }, { name: "Cc", value: "jarvis+project-proj-other@hps-colorado.com" }]))

    const summary = await postHeldEmailBacklog({ db: db.db, env: {} })

    expect(summary).toMatchObject({ posted: 1, stillHeld: 1, addressesRecovered: 1 })
    expect(mocks.route.mock.calls.map((call) => call[0]?.projectId)).toEqual(["proj-o202"])
    expect(stored("addressed").to_address).toBe("jarvis+project-proj-o202@hps-colorado.com")
    // The other company's address is saved for the desk, but the email stays held.
    expect(stored("foreign")).toMatchObject({ matched_status: "needs_review", project_id: null })
  })

  it("keeps an email held, unchanged, when Gmail can't be read", async () => {
    heldRow("gone")
    mocks.fetch.mockResolvedValueOnce(new Response("Not found", { status: 404 }))

    const summary = await postHeldEmailBacklog({ db: db.db, env: {} })

    expect(summary).toMatchObject({ posted: 0, stillHeld: 1, addressesRecovered: 0, rateLimited: false })
    expect(mocks.route).not.toHaveBeenCalled()
    expect(stored("gone")).toMatchObject({ to_address: "Ezell <ezell@bishopbuilt.test>", sender_authentication: null, matched_status: "needs_review" })
  })

  it("stops the page at a Gmail rate limit and resumes from the email Gmail refused", async () => {
    heldRow("first", { receivedAt: "2026-10-16T12:00:00.000Z" })
    heldRow("second", { receivedAt: "2026-10-17T12:00:00.000Z" })
    heldRow("third", { receivedAt: "2026-10-18T12:00:00.000Z" })
    mocks.fetch
      .mockResolvedValueOnce(gmailMessage("first", [{ name: "Authentication-Results", value: PASS }, { name: "Cc", value: PROJECT_ADDRESS }]))
      .mockResolvedValueOnce(new Response("Rate limit exceeded", { status: 429 }))

    const summary = await postHeldEmailBacklog({ db: db.db, env: {} })

    expect(summary).toMatchObject({ posted: 1, rateLimited: true, nextAfter: "2026-10-16T12:00:00.000Z|first" })
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    expect(mocks.access).toHaveBeenCalledTimes(1)
    expect(stored("second").matched_status).toBe("needs_review")
  })
})
