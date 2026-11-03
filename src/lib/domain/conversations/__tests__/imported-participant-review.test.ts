import { drizzle } from "drizzle-orm/d1"
import { beforeEach, describe, expect, it } from "vitest"

import { migratedDatabase } from "@/lib/domain/contacts/__tests__/directory-seed"
import { d1Over } from "@/lib/domain/__tests__/sqlite-d1"
import {
  LEGAL_HOLD_ERROR,
  checkPieces,
  parsePiece,
  resolveImportedParticipant,
  reviewCandidates,
  type ReviewDecision,
} from "@/lib/domain/conversations/imported-participant-resolve"
import { listUnresolvedParticipants } from "@/lib/domain/conversations/imported-participant-review"
import { DEFAULT_RECORD_PAGE_QUERY } from "@/lib/record-page"
import { isRecord } from "@/lib/shared/guards"
import type { Db } from "@/lib/server/action-context"

/*
 * Staff review of imported participants the importer could not resolve,
 * against a database built from every migration. Matching is exact only (the
 * importer's own resolver), resolving never shares a conversation or grants
 * access, a legal-hold project is read only, and a repeat changes nothing.
 */

type Sqlite = ReturnType<typeof migratedDatabase>
type Row = Record<string, unknown>

const ORG = "org-1"
const PROJECT = "proj-1"
const LACASSE = "proj-bt-o-58-3674-forest"
const NOW = "2026-11-01T00:00:00.000Z"
const LITERAL = "Jane Doe; Bob Smith <bob@example.com>"

let sqlite: Sqlite
let db: Db

function insert(table: string, row: Record<string, string | number | null>): void {
  const keys = Object.keys(row)
  sqlite.prepare(`INSERT INTO ${table} (${keys.map((key) => `"${key}"`).join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`)
    .run(...Object.values(row))
}

function rows(query: string, ...binds: readonly unknown[]): Row[] {
  return sqlite.prepare(query).all(...binds).filter(isRecord)
}

function contact(id: string, projectId: string, name: string): void {
  insert("project_contacts", {
    id, project_id: projectId, contact_type: "owner", source_system: "compass", source_entity_type: "manual",
    display_name: name, owner_portal_visible: 0, sub_vendor_portal_visible: 0, internal_visible: 1, active: 1,
    created_at: NOW, updated_at: NOW,
  })
}

/** A staff-only imported conversation with one message. */
function thread(projectId: string, threadId: string, messageId: string): string {
  const channelId = `channel-${threadId}`
  insert("channels", {
    id: channelId, name: `Thread ${threadId}`, type: "text", organization_id: ORG, project_id: projectId, is_private: 1,
    audience: "staff", created_by: "staff-1", sort_order: 0, created_at: NOW, updated_at: NOW,
    source_system: "buildertrend", source_thread_id: threadId,
  })
  insert("messages", {
    id: `msg-${messageId}`, channel_id: channelId, user_id: "staff-1", content: "Hello", is_pinned: 0, reply_count: 0,
    created_at: NOW, source_system: "buildertrend", source_message_id: messageId,
  })
  return channelId
}

function participant(id: string, projectId: string, messageId: string, values: Record<string, string | number | null>): void {
  insert("project_source_record_participants", {
    id, organization_id: ORG, project_id: projectId, source_record_type: "buildertrend_message", source_record_id: messageId,
    audience: "external", membership_status: "pending", review_status: "unreviewed", active: 0,
    created_at: NOW, updated_at: NOW, ...values,
  })
}

/** No notification, delivery or outgoing email row was written. */
function nothingSent(): Row[] {
  return rows(`SELECT (SELECT count(*) FROM notification_events) + (SELECT count(*) FROM notification_deliveries)
    + (SELECT count(*) FROM correspondence_outbox) + (SELECT count(*) FROM correspondence_email_deliveries) AS n`)
}

async function resolve(rowId: string, decision: ReviewDecision, apply = true): ReturnType<typeof resolveImportedParticipant> {
  return resolveImportedParticipant({ db, organizationId: ORG, rowId, decision, apply, now: "2026-11-03T00:00:00.000Z" })
}

beforeEach(() => {
  sqlite = migratedDatabase()
  sqlite.pragma("foreign_keys = OFF")
  // @ts-expect-error The test binding implements only what drizzle's D1 driver calls.
  db = drizzle(d1Over(sqlite))
  insert("organizations", { id: ORG, name: ORG, slug: ORG, type: "company", is_active: 1, created_at: NOW, updated_at: NOW })
  insert("projects", { id: PROJECT, organization_id: ORG, name: "Hiker", status: "OPEN", created_at: NOW, updated_at: NOW })
  insert("projects", { id: LACASSE, organization_id: ORG, name: "Forest Lakes", status: "OPEN", imported_conversations_staff_only: 1, created_at: NOW, updated_at: NOW })
  // Two contacts with the exact same name make "Daniel Vogel" ambiguous; a near name never counts.
  contact("pc-dan-a", PROJECT, "Daniel Vogel")
  contact("pc-dan-b", PROJECT, "Daniel  vogel")
  contact("pc-dan-near", PROJECT, "Dan Vogel")
  contact("pc-jane", PROJECT, "Jane Doe")
  contact("pc-lacasse-a", LACASSE, "Pat Lee")
  contact("pc-lacasse-b", LACASSE, "Pat Lee")

  thread(PROJECT, "t-1", "m-1")
  participant("p-dan", PROJECT, "m-1", { source_participant_id: "unknown:name:daniel vogel", source_contact_name: "Daniel Vogel", participant_role: "to", identity_status: "unmatched" })
  thread(PROJECT, "t-2", "m-2")
  participant("p-literal", PROJECT, "m-2", { source_participant_id: "to:owner:literal:abc", source_contact_name: LITERAL, participant_role: "to_literal", identity_status: "boundary_unproven:none" })
  thread(PROJECT, "t-3", "m-3")
  participant("p-sender-literal", PROJECT, "m-3", { source_participant_id: "sender:unknown:literal:def", source_contact_name: "Jane Doe; Someone", participant_role: "sender_literal", identity_status: "boundary_unproven:none" })
  participant("p-sender-plain", PROJECT, "m-3", { source_participant_id: "unknown:name:jane doe; someone", source_contact_name: "Jane Doe; Someone", participant_role: "sender", identity_status: "unmatched" })
  thread(LACASSE, "t-9", "m-9")
  participant("p-lacasse", LACASSE, "m-9", { source_participant_id: "unknown:name:pat lee", source_contact_name: "Pat Lee", participant_role: "to", identity_status: "unmatched" })
})

describe("listing", () => {
  it("lists each unresolved participant once, in plain words, with the legal-hold project read only", async () => {
    const page = await listUnresolvedParticipants(db, ORG, DEFAULT_RECORD_PAGE_QUERY)
    expect(page.total).toBe(4)
    const byLiteral = new Map(page.rows.map((row) => [row.literal, row]))
    expect(byLiteral.get("Daniel Vogel")).toMatchObject({ reason: "Name matches more than one contact", canPick: true, canSplit: false, messageCount: 1, channelId: "channel-t-1" })
    expect(byLiteral.get(LITERAL)).toMatchObject({ reason: "Several names run together", canPick: false, canSplit: true, role: "to" })
    // An undivided sender appears once, as its run-together row.
    expect(page.rows.filter((row) => row.literal === "Jane Doe; Someone")).toHaveLength(1)
    expect(byLiteral.get("Pat Lee")).toMatchObject({ canPick: false, canSplit: false, canLeave: false })
    expect(byLiteral.get("Pat Lee")?.readOnlyReason).toBeTruthy()
  })

  it("pages with a bounded limit and searches", async () => {
    const first = await listUnresolvedParticipants(db, ORG, { ...DEFAULT_RECORD_PAGE_QUERY, pageSize: 25, search: "vogel" })
    expect(first.rows.map((row) => row.literal)).toEqual(["Daniel Vogel"])
    expect(await listUnresolvedParticipants(db, "org-other", DEFAULT_RECORD_PAGE_QUERY)).toEqual({ rows: [], total: 0 })
  })
})

describe("pick person", () => {
  it("offers only the exact-name candidates", async () => {
    const result = await reviewCandidates(db, ORG, "p-dan")
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.map((candidate) => candidate.personKey).sort()).toEqual(["project_contact:pc-dan-a", "project_contact:pc-dan-b"])
  })

  it("links the person without sharing the conversation, and a repeat is a no-op", async () => {
    const result = await resolve("p-dan", { type: "pick", personKey: "project_contact:pc-dan-a" })
    expect(result).toMatchObject({ success: true, data: { changed: true, stillStaffOnly: true, people: ["Daniel Vogel"] } })
    expect(rows("SELECT project_contact_id, identity_status, review_status, active, source_contact_name FROM project_source_record_participants WHERE id = 'p-dan'")[0])
      .toEqual({ project_contact_id: "pc-dan-a", identity_status: "matched", review_status: "reviewed", active: 0, source_contact_name: "Daniel Vogel" })
    // The thread row lets "Share with owner/vendor…" include them later; the conversation stays staff-only.
    expect(rows("SELECT project_contact_id, active FROM project_source_record_participants WHERE source_record_type = 'buildertrend_message_thread'"))
      .toEqual([{ project_contact_id: "pc-dan-a", active: 1 }])
    expect(rows("SELECT audience FROM channels WHERE id = 'channel-t-1'")).toEqual([{ audience: "staff" }])
    expect(rows("SELECT count(*) AS n FROM channel_members")).toEqual([{ n: 0 }])
    expect(nothingSent()).toEqual([{ n: 0 }])

    const again = await resolve("p-dan", { type: "pick", personKey: "project_contact:pc-dan-a" })
    expect(again).toMatchObject({ success: true, data: { changed: false } })
    expect(rows("SELECT count(*) AS n FROM project_source_record_participants WHERE source_record_type = 'buildertrend_message_thread'")).toEqual([{ n: 1 }])
    expect(await resolve("p-dan", { type: "leave" })).toMatchObject({ success: false })
  })

  it("refuses a person who is not an exact candidate", async () => {
    expect(await resolve("p-dan", { type: "pick", personKey: "project_contact:pc-dan-near" })).toMatchObject({ success: false })
    expect(rows("SELECT review_status FROM project_source_record_participants WHERE id = 'p-dan'")).toEqual([{ review_status: "unreviewed" }])
  })
})

describe("split into people", () => {
  it("checks names without writing, then links exact matches and adds new people uninvited", async () => {
    const preview = await resolve("p-literal", { type: "split", pieces: ["Jane Doe", "Bob Smith <bob@example.com>"] }, false)
    expect(preview).toMatchObject({ success: true, data: { changed: false, pieces: [{ piece: "Jane Doe", outcome: "linked" }, { piece: "Bob Smith <bob@example.com>", outcome: "new_contact" }] } })
    expect(rows("SELECT count(*) AS n FROM project_source_record_participants")).toEqual([{ n: 5 }])

    const result = await resolve("p-literal", { type: "split", pieces: ["Jane Doe", "Bob Smith <bob@example.com>"] })
    expect(result).toMatchObject({ success: true, data: { changed: true, stillStaffOnly: true } })
    // The original literal is kept exactly as written.
    expect(rows("SELECT source_contact_name, identity_status, review_status FROM project_source_record_participants WHERE id = 'p-literal'")[0])
      .toEqual({ source_contact_name: LITERAL, identity_status: "boundary_split", review_status: "reviewed" })
    const people = rows(`SELECT source_participant_id, project_contact_id, participant_role, active FROM project_source_record_participants
      WHERE source_record_type = 'buildertrend_message' AND source_record_id = 'm-2' AND id <> 'p-literal' ORDER BY source_participant_id`)
    expect(people).toEqual([
      { source_participant_id: "owner:email:bob@example.com", project_contact_id: expect.stringMatching(/^bt-contact-/), participant_role: "to", active: 0 },
      { source_participant_id: "owner:name:jane doe", project_contact_id: "pc-jane", participant_role: "to", active: 0 },
    ])
    expect(rows("SELECT source_entity_type, display_name, email, owner_portal_visible, sub_vendor_portal_visible FROM project_contacts WHERE id LIKE 'bt-contact-%'"))
      .toEqual([{ source_entity_type: "buildertrend_new_person", display_name: "Bob Smith", email: "bob@example.com", owner_portal_visible: 0, sub_vendor_portal_visible: 0 }])
    expect(rows("SELECT audience FROM channels WHERE id = 'channel-t-2'")).toEqual([{ audience: "staff" }])
    expect(nothingSent()).toEqual([{ n: 0 }])

    // Idempotent: the same split again adds nothing.
    const before = rows("SELECT count(*) AS n FROM project_source_record_participants")
    expect(await resolve("p-literal", { type: "split", pieces: ["Jane Doe", "Bob Smith <bob@example.com>"] })).toMatchObject({ success: true, data: { changed: false } })
    expect(rows("SELECT count(*) AS n FROM project_source_record_participants")).toEqual(before)
  })

  it("matches each name exactly: an ambiguous name or text not in the original is refused", async () => {
    insert("project_source_record_participants", {
      id: "p-literal-2", organization_id: ORG, project_id: PROJECT, source_record_type: "buildertrend_message", source_record_id: "m-2",
      source_participant_id: "cc:owner:literal:xyz", source_contact_name: "Daniel Vogel, Jane Doe", participant_role: "cc_literal",
      identity_status: "boundary_unproven:several", audience: "external", membership_status: "pending", review_status: "unreviewed", active: 0,
      created_at: NOW, updated_at: NOW,
    })
    expect(await resolve("p-literal-2", { type: "split", pieces: ["Daniel Vogel", "Jane Doe"] }))
      .toMatchObject({ success: false, error: expect.stringContaining("matches more than one contact") })
    expect(await resolve("p-literal", { type: "split", pieces: ["Janet Doe"] })).toMatchObject({ success: false })
    expect(rows("SELECT count(*) AS n FROM project_contacts WHERE id LIKE 'bt-contact-%'")).toEqual([{ n: 0 }])
  })

  it("resolves an undivided sender's plain sender row with it", async () => {
    expect(await resolve("p-sender-literal", { type: "split", pieces: ["Jane Doe", "Someone"] })).toMatchObject({ success: false, error: expect.stringContaining("one person") })
    expect(await resolve("p-sender-literal", { type: "split", pieces: ["Jane Doe"] })).toMatchObject({ success: true })
    expect(rows("SELECT project_contact_id, review_status FROM project_source_record_participants WHERE id = 'p-sender-plain'"))
      .toEqual([{ project_contact_id: "pc-jane", review_status: "reviewed" }])
  })
})

describe("leave as is", () => {
  it("marks the row reviewed with no person", async () => {
    expect(await resolve("p-dan", { type: "leave" })).toMatchObject({ success: true, data: { changed: true } })
    expect(rows("SELECT project_contact_id, user_id, identity_status, review_status, active FROM project_source_record_participants WHERE id = 'p-dan'"))
      .toEqual([{ project_contact_id: null, user_id: null, identity_status: "unmatched", review_status: "reviewed", active: 0 }])
    expect(await resolve("p-dan", { type: "leave" })).toMatchObject({ success: true, data: { changed: false } })
  })
})

describe("legal hold", () => {
  it("never changes participants on a project that keeps imported conversations staff-only", async () => {
    for (const decision of [{ type: "leave" }, { type: "pick", personKey: "project_contact:pc-lacasse-a" }] as const) {
      expect(await resolve("p-lacasse", decision)).toEqual({ success: false, error: LEGAL_HOLD_ERROR })
    }
    expect(rows("SELECT review_status, project_contact_id FROM project_source_record_participants WHERE id = 'p-lacasse'"))
      .toEqual([{ review_status: "unreviewed", project_contact_id: null }])
  })
})

describe("piece rules", () => {
  it("reads names and emails and keeps to the original text", () => {
    expect(parsePiece("Bob Smith <bob@example.com>")).toEqual({ displayName: "Bob Smith", email: "bob@example.com" })
    expect(parsePiece("bob@example.com")).toEqual({ displayName: null, email: "bob@example.com" })
    expect(checkPieces(LITERAL, ["Jane Doe", " Bob Smith "], "to")).toEqual(["Jane Doe", "Bob Smith"])
    expect(checkPieces(LITERAL, ["Jane Doe", "Jane Doe"], "to")).toBe("The same name is marked twice.")
    expect(checkPieces(LITERAL, ["Someone Else"], "to")).toContain("not part of the original")
  })
})
