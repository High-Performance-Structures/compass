import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { context, insertConversation, insertGrant, insertMessage, insertParticipant, openCorrespondenceTestDatabase, type CorrespondenceTestDatabase } from "../../../../__tests__/helpers/correspondence-core"

const mocks = vi.hoisted(() => ({ context: vi.fn() }))
vi.mock("@/lib/correspondence/access", async (original) => {
  const actual = await original<typeof import("@/lib/correspondence/access")>()
  return { ...actual, correspondenceContext: mocks.context }
})
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
import { searchCorrespondence } from "@/app/actions/project-correspondence"

describe("historical source audience search", () => {
  let database: CorrespondenceTestDatabase

  beforeEach(() => {
    database = openCorrespondenceTestDatabase()
    database.sqlite.exec(readFileSync(resolve(process.cwd(), "drizzle/0154_correspondence_source_audience.sql"), "utf8"))
    insertConversation(database.sqlite, { id: "search-conversation", projectId: "project-a" })
    insertParticipant(database.sqlite, { id: "search-staff", conversationId: "search-conversation", userId: "staff-a", role: "staff" })
    insertParticipant(database.sqlite, { id: "search-owner", conversationId: "search-conversation", userId: "owner-a", role: "owner" })
    insertMessage(database.sqlite, { id: "search-visible", conversationId: "search-conversation", authorUserId: "staff-a", source: "buildertrend", body: "cabinet historical decision", sentAt: "2026-08-01T08:00:00" })
    insertGrant(database.sqlite, { id: "search-visible-author", messageId: "search-visible", userId: "staff-a", kind: "author" })
    insertGrant(database.sqlite, { id: "search-visible-owner", messageId: "search-visible", userId: "owner-a", kind: "to" })
    insertMessage(database.sqlite, { id: "search-hidden", conversationId: "search-conversation", authorUserId: "staff-a", source: "buildertrend", body: "cabinet hidden decision", sentAt: "2026-08-02T08:00:00" })
    insertGrant(database.sqlite, { id: "search-hidden-author", messageId: "search-hidden", userId: "staff-a", kind: "author" })
    insertSourceMessage("search-visible", "2026-08-01 08:00", "Visible source subject", "visible-source")
    insertSourceMessage("search-hidden", "2026-08-02 08:00", "Hidden source subject", "hidden-source")
    database.sqlite.prepare(`INSERT INTO correspondence_source_recipients (id,source_message_id,source_recipient_key,source_user_id,source_name,source_email,kind,source_ordinal,evidence_json) VALUES (?,?,?,?,?,?,?,?,?)`).run("visible-to", "visible-source", "to-1", null, "Pending Original Recipient", "pending@example.test", "to", 0, "{}")
    database.sqlite.prepare(`INSERT INTO correspondence_source_recipients (id,source_message_id,source_recipient_key,source_user_id,source_name,source_email,kind,source_ordinal,evidence_json) VALUES (?,?,?,?,?,?,?,?,?)`).run("visible-bcc", "visible-source", "bcc-1", null, "Hidden Bcc", "hidden@example.test", "bcc", 1, "{}")
    database.sqlite.prepare(`INSERT INTO correspondence_source_recipients (id,source_message_id,source_recipient_key,source_user_id,source_name,source_email,kind,source_ordinal,evidence_json) VALUES (?,?,?,?,?,?,?,?,?)`).run("hidden-to", "hidden-source", "to-1", null, "Unseen Recipient", "unseen@example.test", "to", 0, "{}")
    mocks.context.mockImplementation(async () => context(database, "owner-a", "project-a"))
  })

  afterEach(() => {
    database.close()
    vi.clearAllMocks()
  })

  function insertSourceMessage(messageId: string, sourceSentLocal: string, subject: string, sourceId: string): void {
    database.sqlite.prepare(`INSERT INTO correspondence_source_messages
      (id,organization_id,project_id,conversation_id,message_id,source_account_id,source_project_id,source_message_id,source_subject,source_sent_display,source_sent_local,source_sent_at,source_timezone,source_body_sha256,source_evidence_json,captured_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      sourceId, "org-a", "project-a", "search-conversation", messageId, "bt-account", "bt-project", `bt-${messageId}`,
      subject, sourceSentLocal, sourceSentLocal, null, null, "b".repeat(64), "{}", "2026-09-05T12:00:00.000Z",
    )
  }

  it("returns source-local labels only for authorized hits and never exposes source Bcc roster", async () => {
    const result = await searchCorrespondence("project-a", "cabinet")
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.hits).toHaveLength(1)
    expect(result.data.hits[0]).toMatchObject({
      messageId: "search-visible",
      sourceSentDisplay: "2026-08-01 08:00",
      sourceSentAt: null,
    })
    expect(JSON.stringify(result.data.hits)).not.toContain("Hidden Bcc")
    expect(JSON.stringify(result.data.hits)).not.toContain("Unseen Recipient")
  })
})
