import { afterEach, describe, expect, it, vi } from "vitest"
import { Buffer } from "node:buffer"
import { openCorrespondenceTestDatabase, type CorrespondenceTestDatabase } from "../../../../__tests__/helpers/correspondence-core"
import { sendCompassEmail } from "../compass-email"

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), jwt: vi.fn(), token: vi.fn() }))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/google/config", () => ({ getGoogleConfig: () => ({ encryptionKey: "test" }), getGoogleCryptoSalt: () => "test", parseServiceAccountKey: () => ({}) }))
vi.mock("@/lib/crypto", () => ({ decrypt: async () => "test" }))
vi.mock("@/lib/google/auth/service-account", () => ({ createServiceAccountJWT: mocks.jwt, exchangeJWTForAccessToken: mocks.token }))
let database: CorrespondenceTestDatabase | undefined
afterEach(() => { database?.close(); vi.unstubAllGlobals(); vi.resetAllMocks() })
function setup(): CorrespondenceTestDatabase {
  const db = openCorrespondenceTestDatabase(); database = db
  db.sqlite.exec("CREATE TABLE email_mailbox_state (mailbox TEXT PRIMARY KEY, next_allowed_at TEXT NOT NULL, lease_token TEXT, lease_expires_at TEXT NOT NULL)")
  db.sqlite.exec("CREATE TABLE google_auth (id TEXT,organization_id TEXT,service_account_key_encrypted TEXT,workspace_domain TEXT,shared_drive_id TEXT,shared_drive_name TEXT,connected_by TEXT,created_at TEXT,updated_at TEXT); INSERT INTO google_auth VALUES ('auth','org-a','encrypted','example.test',NULL,NULL,'staff-a','now','now')")
  vi.stubGlobal("fetch", mocks.fetch)
  mocks.fetch.mockImplementation(async () => new Response(JSON.stringify({ id: "sent-1" })))
  mocks.jwt.mockResolvedValue("test")
  mocks.token.mockResolvedValue({ access_token: "test" })
  return db
}
const attachment = { filename: "Plan.pdf", contentType: "application/pdf", content: new Uint8Array([0, 255, 1, 2]) }

describe("email provider attachment delivery", () => {
  it("authenticates as the selected staff mailbox and sends its From with tracked Reply-To", async () => {
    const db = setup()
    await sendCompassEmail({ env: { COMPASS_EMAIL_PROVIDER: "resend", RESEND_API_KEY: "test" }, db: db.db, organizationId: "org-a", sender: { address: "staff@example.test", name: "Staff, Person" }, to: ["owner@example.test"], replyTo: "Project <jarvis+track@example.test>", subject: "Plan", text: "Review" })
    expect(mocks.jwt).toHaveBeenCalledWith({}, "staff@example.test", ["https://www.googleapis.com/auth/gmail.send"])
    const request = JSON.parse(mocks.fetch.mock.calls[0]?.[1].body)
    const mime = Buffer.from(request.raw, "base64url").toString("utf8")
    expect(mime).toContain('From: "Staff, Person" <staff@example.test>')
    expect(mime).toContain("Reply-To: Project <jarvis+track@example.test>")
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })

  it("reports authorization failure without sending or changing to the fallback provider", async () => {
    const db = setup()
    mocks.token.mockRejectedValue(new Error("unauthorized_client"))
    const result = await sendCompassEmail({ env: { RESEND_API_KEY: "test" }, db: db.db, organizationId: "org-a", sender: { address: "staff@example.test", name: "Staff" }, to: ["owner@example.test"], subject: "Plan", text: "Review" })
    expect(result).toMatchObject({ status: "failed", provider: "gmail", error: expect.stringContaining("authorize") })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it("does not switch identities after Gmail rejects an explicit sender", async () => {
    const db = setup()
    mocks.fetch.mockResolvedValue(new Response("Mailbox rejected", { status: 403 }))
    expect(await sendCompassEmail({ env: { RESEND_API_KEY: "test" }, db: db.db, organizationId: "org-a", sender: { address: "staff@example.test", name: "Staff" }, to: ["owner@example.test"], subject: "Plan", text: "Review" })).toMatchObject({ status: "failed", provider: "gmail" })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })

  it("encodes non-ASCII names in the From header", async () => {
    const db = setup()
    await sendCompassEmail({ env: {}, db: db.db, organizationId: "org-a", sender: { address: "staff@example.test", name: "José" }, to: ["owner@example.test"], subject: "Plan", text: "Review" })
    const request = JSON.parse(mocks.fetch.mock.calls[0]?.[1].body)
    expect(Buffer.from(request.raw, "base64url").toString("utf8")).toContain(`From: =?UTF-8?B?${Buffer.from("José").toString("base64")}?= <staff@example.test>`)
  })

  it("keeps the configured system address when attributing a fallback send to staff", async () => {
    const db = setup()
    await sendCompassEmail({ env: { COMPASS_EMAIL_PROVIDER: "resend", RESEND_API_KEY: "test", COMPASS_EMAIL_FROM: "Compass <robot@other.test>" }, db: db.db, organizationId: "org-a", fromName: "Field Staff via Compass", to: ["owner@example.test"], subject: "Plan", text: "Review" })
    expect(JSON.parse(mocks.fetch.mock.calls[0]?.[1].body)).toMatchObject({ from: '"Field Staff via Compass" <robot@other.test>' })
  })
  it("sends Gmail multipart MIME with the binary attachment and tracked reply address", async () => {
    const db = setup()
    const result = await sendCompassEmail({ env: {}, db: db.db, organizationId: "org-a", to: ["owner@example.test"], replyTo: "Project <jarvis+track@example.test>", subject: "Plan", text: "Attached plan", attachments: [attachment] })
    expect(result.status).toBe("sent")
    const call = mocks.fetch.mock.calls[0]
    expect(call?.[0]).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send")
    const request: unknown = JSON.parse(call?.[1].body)
    if (typeof request !== "object" || request === null || !("raw" in request) || typeof request.raw !== "string") throw new Error("Expected MIME request")
    const mime = Buffer.from(request.raw, "base64url").toString("utf8")
    expect(mime).toContain("Content-Type: multipart/mixed")
    expect(mime).toContain("Reply-To: Project <jarvis+track@example.test>")
    expect(mime).toContain(Buffer.from(attachment.content).toString("base64"))
  })
  it("includes attachment content and MIME type in Resend requests", async () => {
    const db = setup()
    const result = await sendCompassEmail({ env: { COMPASS_EMAIL_PROVIDER: "resend", RESEND_API_KEY: "test" }, db: db.db, organizationId: "org-a", to: ["owner@example.test"], subject: "Plan", text: "Attached plan", attachments: [attachment] })
    expect(result.status).toBe("sent")
    expect(mocks.fetch.mock.calls[0]?.[0]).toBe("https://api.resend.com/emails")
    expect(JSON.parse(mocks.fetch.mock.calls[0]?.[1].body)).toMatchObject({ attachments: [{ filename: "Plan.pdf", content_type: "application/pdf", content: "AP8BAg==" }] })
  })
})

describe("provider rate limits and uncertain sends", () => {
  it("persists Google's retry time and skips further Gmail calls during cooldown", async () => {
    const db = setup()
    const retryAt = new Date(Date.now() + 900_000).toISOString()
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ error: { message: `User-rate limit exceeded. Retry after ${retryAt}` } }), { status: 429 }))
    const input = { env: {}, db: db.db, organizationId: "org-a", to: ["owner@example.test"], subject: "Welcome", text: "Welcome" }
    expect(await sendCompassEmail(input)).toMatchObject({ status: "rate_limited", error: expect.stringContaining(new Date(Date.parse(retryAt) + 5_000).toISOString()) })
    expect(await sendCompassEmail(input)).toMatchObject({ status: "rate_limited" })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(mocks.token).toHaveBeenCalledTimes(1)
  })
  it.each([500, 502, 503])("does not fail over after an uncertain Gmail %s response", async (status) => {
    const db = setup()
    mocks.fetch.mockResolvedValue(new Response("Server unavailable", { status }))
    expect(await sendCompassEmail({ env: { RESEND_API_KEY: "test" }, db: db.db, organizationId: "org-a", to: ["owner@example.test"], subject: "Welcome", text: "Welcome" })).toMatchObject({ status: "unknown", provider: "gmail" })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
  it("does not fail over after losing Gmail's response", async () => {
    const db = setup()
    mocks.fetch.mockRejectedValue(new Error("Lost response"))
    expect(await sendCompassEmail({ env: { RESEND_API_KEY: "test" }, db: db.db, organizationId: "org-a", to: ["owner@example.test"], subject: "Welcome", text: "Welcome" })).toMatchObject({ status: "unknown", provider: "gmail" })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
  it("holds a successful response without a provider ID for review", async () => {
    const db = setup()
    mocks.fetch.mockResolvedValue(new Response("{}"))
    expect(await sendCompassEmail({ env: {}, db: db.db, organizationId: "org-a", to: ["owner@example.test"], subject: "Welcome", text: "Welcome" })).toMatchObject({ status: "unknown" })
  })
  it("uses the existing configured fallback after a definite Gmail rejection", async () => {
    const db = setup()
    mocks.fetch.mockResolvedValueOnce(new Response("Rate limited", { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "fallback-message" })))
    expect(await sendCompassEmail({ env: { RESEND_API_KEY: "test" }, db: db.db, organizationId: "org-a", to: ["owner@example.test"], subject: "Welcome", text: "Welcome" })).toMatchObject({ status: "sent", provider: "resend", providerMessageId: "fallback-message" })
  })
})
