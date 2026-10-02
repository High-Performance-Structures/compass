import { afterEach, describe, expect, it, vi } from "vitest"
import { Buffer } from "node:buffer"
import { openCorrespondenceTestDatabase, type CorrespondenceTestDatabase } from "../../../../__tests__/helpers/correspondence-core"
import { sendCompassEmail } from "../compass-email"

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/google/config", () => ({ getGoogleConfig: () => ({ encryptionKey: "test" }), getGoogleCryptoSalt: () => "test", parseServiceAccountKey: () => ({}) }))
vi.mock("@/lib/crypto", () => ({ decrypt: async () => "test" }))
vi.mock("@/lib/google/auth/service-account", () => ({ createServiceAccountJWT: async () => "test", exchangeJWTForAccessToken: async () => ({ access_token: "test" }) }))
let database: CorrespondenceTestDatabase | undefined
afterEach(() => { database?.close(); vi.unstubAllGlobals(); vi.resetAllMocks() })
function setup(): CorrespondenceTestDatabase {
  const db = openCorrespondenceTestDatabase(); database = db
  db.sqlite.exec("CREATE TABLE google_auth (id TEXT,organization_id TEXT,service_account_key_encrypted TEXT,workspace_domain TEXT,shared_drive_id TEXT,shared_drive_name TEXT,connected_by TEXT,created_at TEXT,updated_at TEXT); INSERT INTO google_auth VALUES ('auth','org-a','encrypted','example.test',NULL,NULL,'staff-a','now','now')")
  vi.stubGlobal("fetch", mocks.fetch)
  mocks.fetch.mockImplementation(async () => new Response(JSON.stringify({ id: "sent-1" })))
  return db
}
const attachment = { filename: "Plan.pdf", contentType: "application/pdf", content: new Uint8Array([0, 255, 1, 2]) }

describe("email provider attachment delivery", () => {
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
