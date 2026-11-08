import { drizzle } from "drizzle-orm/d1"
import { beforeEach, describe, expect, it } from "vitest"

import { migratedDatabase } from "@/lib/domain/contacts/__tests__/directory-seed"
import { d1Over } from "@/lib/domain/__tests__/sqlite-d1"
import { resolveParticipantGroup } from "@/lib/domain/conversations/imported-participant-group-resolve"
import { listUnresolvedParticipants } from "@/lib/domain/conversations/imported-participant-review"
import { runAutoResolve } from "@/lib/domain/conversations/participant-auto-resolve"
import { addAlternateEmail } from "@/lib/domain/identity/alternate-emails"
import { DEFAULT_RECORD_PAGE_QUERY } from "@/lib/record-page"
import { isRecord } from "@/lib/shared/guards"
import type { Db } from "@/lib/server/action-context"

/*
 * Resolving unresolved imported participants a whole name or email at a
 * time: the grouped list, one decision for every row of a name, and the
 * automatic pass. Legal-hold projects never change, and nothing is shared,
 * notified or emailed.
 */

type Sqlite = ReturnType<typeof migratedDatabase>
type Row = Record<string, unknown>

const ORG = "org-1"
const P1 = "proj-1"
const P2 = "proj-2"
const HOLD = "proj-hold"
const NOW = "2026-11-01T00:00:00.000Z"
const LATER = "2026-11-08T00:00:00.000Z"

let sqlite: Sqlite
let db: Db
let messageNumber = 0

function insert(table: string, row: Record<string, string | number | null>): void {
  const keys = Object.keys(row)
  sqlite.prepare(`INSERT INTO ${table} (${keys.map((key) => `"${key}"`).join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).run(...Object.values(row))
}

function rows(query: string, ...binds: readonly unknown[]): Row[] {
  return sqlite.prepare(query).all(...binds).filter(isRecord)
}

/** A staff-only imported conversation on a project. */
function thread(projectId: string, threadId: string): string {
  const channelId = `channel-${threadId}`
  insert("channels", {
    id: channelId, name: `Thread ${threadId}`, type: "text", organization_id: ORG, project_id: projectId, is_private: 1,
    audience: "staff", created_by: "u-dan", sort_order: 0, created_at: NOW, updated_at: NOW, source_system: "buildertrend", source_thread_id: threadId,
  })
  return channelId
}

/** One message in a conversation that names someone the importer could not resolve. */
function unresolved(projectId: string, channelId: string, key: string, name: string, role = "to"): string {
  messageNumber += 1
  const messageId = `m-${messageNumber}`
  insert("messages", { id: `msg-${messageId}`, channel_id: channelId, user_id: "u-dan", content: "Hi", is_pinned: 0, reply_count: 0, created_at: NOW, source_system: "buildertrend", source_message_id: messageId })
  const id = `p-${messageNumber}`
  insert("project_source_record_participants", {
    id, organization_id: ORG, project_id: projectId, source_record_type: "buildertrend_message", source_record_id: messageId,
    source_participant_id: key, source_contact_name: name, participant_role: role, identity_status: "unmatched",
    audience: "external", membership_status: "pending", review_status: "unreviewed", active: 0, created_at: NOW, updated_at: NOW,
  })
  return id
}

function nothingSent(): Row[] {
  return rows(`SELECT (SELECT count(*) FROM notification_events) + (SELECT count(*) FROM notification_deliveries)
    + (SELECT count(*) FROM correspondence_outbox) + (SELECT count(*) FROM correspondence_email_deliveries) + (SELECT count(*) FROM channel_members) AS n`)
}

function participantRows(id: string): Row | undefined {
  return rows("SELECT user_id, project_contact_id, identity_status, review_status, active FROM project_source_record_participants WHERE id = ?", id)[0]
}

beforeEach(() => {
  messageNumber = 0
  sqlite = migratedDatabase()
  sqlite.pragma("foreign_keys = OFF")
  // @ts-expect-error The test binding implements only what drizzle's D1 driver calls.
  db = drizzle(d1Over(sqlite))
  insert("organizations", { id: ORG, name: ORG, slug: ORG, type: "company", is_active: 1, created_at: NOW, updated_at: NOW })
  for (const [id, staffOnly] of [[P1, 0], [P2, 0], [HOLD, 1]] as const) {
    insert("projects", { id, organization_id: ORG, name: id, status: "OPEN", imported_conversations_staff_only: staffOnly, created_at: NOW, updated_at: NOW })
  }
  insert("users", { id: "u-dan", email: "dan@new.example", display_name: "Dan Vogel", role: "office", is_active: 1, created_at: NOW, updated_at: NOW })
  insert("organization_members", { id: "om-dan", organization_id: ORG, user_id: "u-dan", role: "office", joined_at: NOW })
  insert("internal_contacts", { id: "ic-dan", organization_id: ORG, user_id: "u-dan", name: "Dan Vogel", email: "dan@new.example", active: 1, created_at: NOW, updated_at: NOW })
  insert("users", { id: "u-vendor", email: "vendor.login@bldr.example", display_name: "Vendor Login", role: "supplier", is_active: 1, created_at: NOW, updated_at: NOW })
  insert("organization_members", { id: "om-vendor", organization_id: ORG, user_id: "u-vendor", role: "supplier", joined_at: NOW })
  // The company's own old address also sits on a vendor contact ("our own subcontractor" vendor).
  insert("vendors", { id: "v-own", organization_id: ORG, name: "Our Own Subcontractor", category: "Subcontractor", directory_status: "active", created_at: NOW, updated_at: NOW })
  insert("vendor_contacts", { id: "vc-dan-old", vendor_id: "v-own", name: "Dan Vogel", email: "dan@old.example", active: 1, created_at: NOW, updated_at: NOW })
  insert("vendors", { id: "v-bldr", organization_id: ORG, name: "Builders Supply", category: "Supplier", directory_status: "active", created_at: NOW, updated_at: NOW })
  insert("vendor_contacts", { id: "vc-aaron", vendor_id: "v-bldr", name: "Alex South", email: "aaron@bldr.example", active: 1, created_at: NOW, updated_at: NOW })

  const t1 = thread(P1, "t-1")
  const t2 = thread(P2, "t-2")
  const hold = thread(HOLD, "t-9")
  // Dan's old address on many messages, on two projects and a legal-hold one.
  unresolved(P1, t1, "unknown:email:dan@old.example", "dan@old.example", "cc")
  unresolved(P1, t1, "unknown:email:dan@old.example", "dan@old.example", "cc")
  unresolved(P2, t2, "internal:123", "Dan Vogel <dan@old.example>", "sender")
  unresolved(HOLD, hold, "unknown:email:dan@old.example", "dan@old.example", "cc")
  // A vendor person by exact email, and a new one at the same company by domain.
  unresolved(P1, t1, "unknown:email:aaron@bldr.example", "aaron@bldr.example")
  unresolved(P2, t2, "unknown:email:dana@bldr.example", "Dana West <dana@bldr.example>")
  // Nobody can tell who these are.
  unresolved(P1, t1, "owner:1", "Kim and Jo Harper")
  unresolved(P2, t2, "unknown:email:pal@gmail.com", "pal@gmail.com")
})

describe("grouped list", () => {
  it("lists one row per name or email across projects, with the true count", async () => {
    const page = await listUnresolvedParticipants(db, ORG, DEFAULT_RECORD_PAGE_QUERY)
    expect(page.total).toBe(5)
    const danRow = page.rows.find((row) => row.literal === "Dan Vogel <dan@old.example>")
    expect(danRow).toMatchObject({ projectCount: 3, messageCount: 4, someLegalHold: true, readOnlyReason: null, canPick: true })
  })
})

describe("one decision for every row of a name", () => {
  it("applies a pick to every project and leaves legal-hold rows unchanged", async () => {
    const anchor = rows("SELECT id FROM project_source_record_participants WHERE project_id = ? AND source_contact_name = 'dan@old.example' LIMIT 1", P1)[0]?.id
    expect(typeof anchor).toBe("string")
    const result = await resolveParticipantGroup({ db, organizationId: ORG, rowId: String(anchor), decision: { type: "pick", ref: "internal:ic-dan" }, apply: true, now: LATER, includeStaffOnlyProjects: false })
    expect(result).toMatchObject({ success: true, data: { changed: true, projects: 2, rowsReviewed: 3, legalHoldRows: 1, people: ["Dan Vogel"] } })
    expect(rows("SELECT project_id, user_id, review_status FROM project_source_record_participants WHERE source_record_type = 'buildertrend_message' AND (source_contact_name LIKE '%dan@old.example%') ORDER BY project_id, id"))
      .toEqual([
        { project_id: P1, user_id: "u-dan", review_status: "reviewed" },
        { project_id: P1, user_id: "u-dan", review_status: "reviewed" },
        { project_id: P2, user_id: "u-dan", review_status: "reviewed" },
        { project_id: HOLD, user_id: null, review_status: "unreviewed" },
      ])
    // One thread row per conversation, active while the conversation is staff-only; nothing shared or sent.
    expect(rows("SELECT project_id, source_record_id, user_id, participant_role, active FROM project_source_record_participants WHERE source_record_type = 'buildertrend_message_thread' ORDER BY project_id"))
      .toEqual([
        { project_id: P1, source_record_id: "t-1", user_id: "u-dan", participant_role: "staff", active: 1 },
        { project_id: P2, source_record_id: "t-2", user_id: "u-dan", participant_role: "staff", active: 1 },
      ])
    expect(rows("SELECT DISTINCT audience FROM channels")).toEqual([{ audience: "staff" }])
    expect(nothingSent()).toEqual([{ n: 0 }])
    // A repeat finds nothing left to change outside the legal hold.
    const again = await resolveParticipantGroup({ db, organizationId: ORG, rowId: String(anchor), decision: { type: "leave" }, apply: true, now: LATER, includeStaffOnlyProjects: false })
    expect(again).toMatchObject({ success: false })
  })

  it("refuses a decision when every row is on a legal-hold project", async () => {
    const anchor = rows("SELECT id FROM project_source_record_participants WHERE project_id = ? LIMIT 1", HOLD)[0]?.id
    await resolveParticipantGroup({ db, organizationId: ORG, rowId: String(anchor), decision: { type: "pick", ref: "internal:ic-dan" }, apply: true, now: LATER, includeStaffOnlyProjects: false })
    const result = await resolveParticipantGroup({ db, organizationId: ORG, rowId: String(anchor), decision: { type: "leave" }, apply: true, now: LATER, includeStaffOnlyProjects: false })
    expect(result).toMatchObject({ success: false })
    expect(participantRows(String(anchor))).toMatchObject({ review_status: "unreviewed", user_id: null })
  })

  it("adds a person as a new contact of a vendor", async () => {
    const anchor = rows("SELECT id FROM project_source_record_participants WHERE source_contact_name LIKE 'Dana%'")[0]?.id
    const result = await resolveParticipantGroup({ db, organizationId: ORG, rowId: String(anchor), decision: { type: "vendor", vendorId: "v-bldr" }, apply: true, now: LATER, includeStaffOnlyProjects: false })
    expect(result).toMatchObject({ success: true, data: { people: ["Dana West"], rowsReviewed: 1 } })
    expect(rows("SELECT vendor_id, name, email FROM vendor_contacts WHERE email = 'dana@bldr.example'")).toEqual([{ vendor_id: "v-bldr", name: "Dana West", email: "dana@bldr.example" }])
    expect(rows("SELECT owner_portal_visible, sub_vendor_portal_visible, vendor_id FROM project_contacts WHERE project_id = ?", P2))
      .toEqual([{ owner_portal_visible: 0, sub_vendor_portal_visible: 0, vendor_id: "v-bldr" }])
    expect(await resolveParticipantGroup({ db, organizationId: ORG, rowId: String(anchor), decision: { type: "vendor", vendorId: "v-elsewhere" }, apply: true, now: LATER, includeStaffOnlyProjects: false })).toMatchObject({ success: false })
  })
})

describe("automatic pass", () => {
  it("previews without writing, then resolves clear matches with staff winning over the vendor contact", async () => {
    // Dan's old address is listed as his other email address.
    expect(await addAlternateEmail(db, { organizationId: ORG, userId: "u-dan", email: "Dan@Old.example", actorUserId: "u-dan", now: NOW })).toMatchObject({ success: true })

    const preview = await runAutoResolve(db, { organizationId: ORG, apply: false, now: LATER, includeStaffOnlyProjects: false })
    expect(preview.byMatchType.staff_other_email).toEqual({ identities: 1, groups: 2, rows: 3 })
    expect(preview.byMatchType.same_email).toEqual({ identities: 1, groups: 1, rows: 1 })
    expect(preview.byMatchType.vendor_domain).toEqual({ identities: 1, groups: 1, rows: 1 })
    expect(preview.legalHold).toEqual({ identities: 1, groups: 1, rows: 1 })
    expect(preview.leftover).toEqual({ identities: 2, groups: 2, rows: 2 })
    expect(rows("SELECT count(*) AS n FROM project_source_record_participants WHERE review_status = 'reviewed'")).toEqual([{ n: 0 }])

    const summary = await runAutoResolve(db, { organizationId: ORG, apply: true, now: LATER, includeStaffOnlyProjects: false })
    expect(summary.resolved).toEqual({ identities: 3, groups: 4, rows: 5 })
    // Dan, not the vendor contact with his old address.
    expect(rows("SELECT DISTINCT user_id, project_contact_id FROM project_source_record_participants WHERE source_record_type = 'buildertrend_message' AND source_contact_name LIKE '%dan@old.example%' AND review_status = 'reviewed'"))
      .toEqual([{ user_id: "u-dan", project_contact_id: null }])
    // The legal-hold row and the unclear people are untouched.
    expect(rows("SELECT project_id, source_contact_name FROM project_source_record_participants WHERE source_record_type = 'buildertrend_message' AND review_status = 'unreviewed' ORDER BY id"))
      .toEqual([
        { project_id: HOLD, source_contact_name: "dan@old.example" },
        { project_id: P1, source_contact_name: "Kim and Jo Harper" },
        { project_id: P2, source_contact_name: "pal@gmail.com" },
      ])
    // Aaron links to his vendor contact on the project, uninvited.
    expect(rows("SELECT pc.vendor_contact_id FROM project_source_record_participants p JOIN project_contacts pc ON pc.id = p.project_contact_id WHERE p.source_contact_name = 'aaron@bldr.example'"))
      .toEqual([{ vendor_contact_id: "vc-aaron" }])
    expect(nothingSent()).toEqual([{ n: 0 }])
    // A second run finds nothing more.
    expect((await runAutoResolve(db, { organizationId: ORG, apply: true, now: LATER, includeStaffOnlyProjects: false })).resolved.rows).toBe(0)
  })
})

describe("projects whose imported conversations are kept staff-only", () => {
  it("are included in the automatic pass only when asked, and their conversations stay staff-only", async () => {
    expect(await addAlternateEmail(db, { organizationId: ORG, userId: "u-dan", email: "dan@old.example", actorUserId: "u-dan", now: NOW })).toMatchObject({ success: true })
    const preview = await runAutoResolve(db, { organizationId: ORG, apply: false, now: LATER, includeStaffOnlyProjects: true })
    expect(preview.includedStaffOnlyProjects).toBe(true)
    expect(preview.byMatchType.staff_other_email).toEqual({ identities: 1, groups: 3, rows: 4 })
    expect(preview.legalHold).toEqual({ identities: 0, groups: 0, rows: 0 })
    const summary = await runAutoResolve(db, { organizationId: ORG, apply: true, now: LATER, includeStaffOnlyProjects: true })
    expect(summary.resolved.rows).toBe(6)
    expect(rows("SELECT user_id, review_status FROM project_source_record_participants WHERE project_id = ? AND source_record_type = 'buildertrend_message'", HOLD))
      .toEqual([{ user_id: "u-dan", review_status: "reviewed" }])
    expect(rows("SELECT imported_conversations_staff_only AS held FROM projects WHERE id = ?", HOLD)).toEqual([{ held: 1 }])
    expect(rows("SELECT DISTINCT audience FROM channels")).toEqual([{ audience: "staff" }])
    expect(nothingSent()).toEqual([{ n: 0 }])
  })

  it("are included in a manual decision only when asked", async () => {
    const anchor = String(rows("SELECT id FROM project_source_record_participants WHERE project_id = ? LIMIT 1", HOLD)[0]?.id)
    expect(await resolveParticipantGroup({ db, organizationId: ORG, rowId: anchor, decision: { type: "pick", ref: "internal:ic-dan" }, apply: false, now: LATER }))
      .toMatchObject({ success: true, data: { projects: 2, rowsReviewed: 3, legalHoldRows: 1 } })
    const result = await resolveParticipantGroup({ db, organizationId: ORG, rowId: anchor, decision: { type: "pick", ref: "internal:ic-dan" }, apply: true, now: LATER, includeStaffOnlyProjects: true })
    expect(result).toMatchObject({ success: true, data: { projects: 3, rowsReviewed: 4, legalHoldRows: 0, stillStaffOnly: true } })
    expect(participantRows(anchor)).toMatchObject({ user_id: "u-dan", review_status: "reviewed" })
    expect(rows("SELECT active FROM project_source_record_participants WHERE source_record_type = 'buildertrend_message_thread' AND project_id = ?", HOLD)).toEqual([{ active: 1 }])
    expect(rows("SELECT DISTINCT audience FROM channels")).toEqual([{ audience: "staff" }])
  })
})

describe("former staff without an account", () => {
  it("are matched by their email on a company domain and linked as former staff", async () => {
    insert("organization_feature_settings", { organization_id: ORG, feature_key: "company-email-domains", value: JSON.stringify({ domains: ["old.example", "new.example"] }), updated_at: NOW })
    insert("internal_contacts", { id: "ic-mia", organization_id: ORG, user_id: null, name: "Mia Stone", email: "mia@old.example", active: 0, created_at: NOW, updated_at: NOW })
    const t3 = thread(P1, "t-3")
    const exact = unresolved(P1, t3, "unknown:email:mia@old.example", "mia@old.example")
    const otherDomain = unresolved(P2, thread(P2, "t-4"), "unknown:email:mia@new.example", "Mia Stone <mia@new.example>")
    const preview = await runAutoResolve(db, { organizationId: ORG, apply: false, now: LATER, includeStaffOnlyProjects: false })
    expect(preview.byMatchType.staff_record_email).toEqual({ identities: 2, groups: 2, rows: 2 })
    await runAutoResolve(db, { organizationId: ORG, apply: true, now: LATER, includeStaffOnlyProjects: false })
    for (const id of [exact, otherDomain]) {
      const row = participantRows(id)
      expect(row).toMatchObject({ user_id: null, review_status: "reviewed", identity_status: "matched" })
      expect(rows("SELECT internal_contact_id, contact_type, owner_portal_visible, sub_vendor_portal_visible FROM project_contacts WHERE id = ?", row?.project_contact_id))
        .toEqual([{ internal_contact_id: "ic-mia", contact_type: "internal", owner_portal_visible: 0, sub_vendor_portal_visible: 0 }])
    }
    expect(rows("SELECT participant_role, audience FROM project_source_record_participants WHERE source_record_type = 'buildertrend_message_thread' AND source_record_id = 't-3'"))
      .toEqual([{ participant_role: "former_staff", audience: "internal" }])
    expect(nothingSent()).toEqual([{ n: 0 }])
  })
})

describe("other email addresses", () => {
  it("validates and keeps one owner per address", async () => {
    expect(await addAlternateEmail(db, { organizationId: ORG, userId: "u-dan", email: "not an email", actorUserId: null, now: NOW })).toMatchObject({ success: false })
    expect(await addAlternateEmail(db, { organizationId: ORG, userId: "u-dan", email: "dan@new.example", actorUserId: null, now: NOW })).toEqual({ success: false, error: "That is already this person's sign-in email." })
    expect(await addAlternateEmail(db, { organizationId: ORG, userId: "u-dan", email: "VENDOR.login@bldr.example", actorUserId: null, now: NOW })).toEqual({ success: false, error: "That address is another person's sign-in email." })
    expect(await addAlternateEmail(db, { organizationId: ORG, userId: "u-vendor", email: "x@bldr.example", actorUserId: null, now: NOW })).toMatchObject({ success: false })
    expect(await addAlternateEmail(db, { organizationId: ORG, userId: "u-dan", email: " dan@old.example ", actorUserId: null, now: NOW })).toMatchObject({ success: true, data: { email: "dan@old.example" } })
    expect(await addAlternateEmail(db, { organizationId: ORG, userId: "u-dan", email: "DAN@old.example", actorUserId: null, now: NOW })).toEqual({ success: false, error: "This address is already listed." })
  })
})
