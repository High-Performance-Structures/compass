import { sql, type SQL } from "drizzle-orm"

import { isFullPersonText } from "../../../../scripts/import-buildertrend-participants.mjs"
import { containsPattern, type RecordPage, type RecordPageQuery } from "@/lib/record-page"
import { cleanText, field, finiteNumber, isRecord } from "@/lib/shared/guards"
import type { Db } from "@/lib/server/action-context"

import { IDENTITY_KEY_SQL } from "./participant-matching"

/*
 * Imported conversation participants the importer could not resolve, for
 * staff review (Contacts → Needs review). Two kinds are stored by the
 * importer (scripts/import-buildertrend-messages.mjs, messageStatements):
 *
 * - a run-together literal: one recipient/sender string that could not be
 *   split into people safely. Stored whole on a `<role>_literal` row with
 *   identity_status `boundary_unproven:<none|several|sender_several>`;
 * - a single person who matched more than one exact candidate (ambiguous):
 *   a `sender`/`to`/`cc` row with identity_status `unmatched` and no person.
 *   A full name or an email only stays unmatched when it was ambiguous: a
 *   zero-match full name or email becomes a new contact instead.
 *
 * Both are `review_status = 'unreviewed'`, `active = 0`, and their thread was
 * imported staff-only. The list shows one row per identity across every
 * project and conversation (the email the text shows, else the whole name;
 * see IDENTITY_KEY_SQL), so one decision covers every message that names
 * the person (owner decision 2026-11-08). Generic over `<source>_message`
 * record types; nothing here is specific to one company.
 */

/** Participant rows recorded per imported message end in this suffix. */
const MESSAGE_RECORD_SUFFIX = "_message"
/** The thread-level participant rows that conversation access reads. */
export const THREAD_RECORD_SUFFIX = "_message_thread"

type ReviewKind = "ambiguous" | "run_together" | "not_full_name"

/** identity_status values written by review (the importer writes `matched`, `unmatched`, `boundary_unproven:*`). */
export const REVIEW_IDENTITY_STATUSES = { matched: "matched", split: "boundary_split" } as const

const REVIEW_REASONS: Readonly<Record<ReviewKind, string>> = {
  ambiguous: "Not matched to one person",
  run_together: "Several names run together",
  not_full_name: "Not a full name or email",
}

export type ImportedParticipantReviewRow = {
  /** A participant row of the group; actions resolve the whole identity from it. */
  readonly id: string
  readonly kind: ReviewKind
  readonly reason: string
  /** The name or email as the source showed it (the fullest form, such as "Name <email>"). */
  readonly literal: string
  readonly role: string
  readonly sourceSystem: string
  /** The project of the anchor row; `projectCount` says how many projects the identity is on. */
  readonly projectId: string
  readonly projectName: string
  readonly projectNumber: string | null
  readonly projectCount: number
  /** The conversation when the identity is in exactly one; otherwise null. */
  readonly channelId: string | null
  readonly channelName: string | null
  readonly conversationCount: number
  readonly messageCount: number
  readonly firstAt: string | null
  readonly lastAt: string | null
  /** Set when every project of the identity keeps imported conversations staff-only (for example a legal hold): listed, never changed. */
  readonly readOnlyReason: string | null
  /** Some (not all) of its projects are on legal hold: a decision leaves those rows unchanged. */
  readonly someLegalHold: boolean
  readonly canPick: boolean
  readonly canSplit: boolean
  readonly canLeave: boolean
  /**
   * What staff may do when they explicitly include projects whose imported
   * conversations are kept staff-only (admins; the conversations stay staff-only).
   */
  readonly whenStaffOnlyIncluded: { readonly canPick: boolean; readonly canSplit: boolean; readonly canLeave: boolean }
}

export const REVIEW_SORT_IDS = ["literal", "projects", "messages", "date"] as const

/** Sources whose exact matching rules review can reuse (the importer's). Others may only be left as is. */
export const MATCHABLE_SOURCES = ["buildertrend"] as const

const LEGAL_HOLD_REASON = "This project keeps imported conversations staff-only, so its participants cannot be changed here."

/** `<ns>:email:<email>`, `<ns>:name:<name>` or `<ns>:<id>`: the importer's participant key. */
export function parseParticipantKey(key: string): { readonly namespace: string; readonly email: string | null; readonly name: string | null } {
  const [namespace = "unknown", type, ...rest] = key.split(":")
  const value = rest.join(":")
  if (type === "email") return { namespace, email: value || null, name: null }
  if (type === "name") return { namespace, email: null, name: value || null }
  return { namespace, email: null, name: null }
}

/** `<role>:<ns>:literal:<hash>` on a run-together row: the namespace of its people. */
export function literalNamespace(key: string): string {
  const [, namespace] = key.split(":")
  return namespace || "unknown"
}

/** The plain-words reason for an unresolved row. */
function reviewKindFor(input: { readonly identityStatus: string; readonly literal: string; readonly participantKey: string }): ReviewKind {
  if (input.identityStatus.startsWith("boundary_unproven:")) return "run_together"
  // Only an ambiguous full name or email stays unmatched (see header).
  if (parseParticipantKey(input.participantKey).email || isFullPersonText(input.literal)) return "ambiguous"
  return "not_full_name"
}

function sourceSystemOf(recordType: string): string {
  return recordType.endsWith(MESSAGE_RECORD_SUFFIX) ? recordType.slice(0, -MESSAGE_RECORD_SUFFIX.length) : recordType
}

function isMatchableSource(source: string): boolean {
  return MATCHABLE_SOURCES.some((value) => value === source)
}

/** Shared FROM/WHERE: unresolved message participants of one organization. */
function unresolvedFrom(organizationId: string, search: string): SQL {
  const searchClause = search
    ? sql`AND (lower(COALESCE(p.source_contact_name, p.source_participant_id)) LIKE ${containsPattern(search)} ESCAPE '\\'
        OR lower(pr.name) LIKE ${containsPattern(search)} ESCAPE '\\'
        OR lower(COALESCE(pr.project_number, '')) LIKE ${containsPattern(search)} ESCAPE '\\')`
    : sql``
  return sql`
    FROM project_source_record_participants p
    JOIN projects pr ON pr.id = p.project_id AND pr.organization_id = ${organizationId}
    LEFT JOIN messages m ON m.source_message_id IS NOT NULL
      AND m.source_system = substr(p.source_record_type, 1, length(p.source_record_type) - ${MESSAGE_RECORD_SUFFIX.length})
      AND m.source_message_id = p.source_record_id
    LEFT JOIN channels c ON c.id = m.channel_id
    WHERE p.organization_id = ${organizationId}
      AND p.review_status = 'unreviewed' AND p.active = 0
      AND p.project_contact_id IS NULL AND p.user_id IS NULL
      AND p.source_record_type LIKE ${`%${MESSAGE_RECORD_SUFFIX.replace("_", "\\_")}`} ESCAPE '\\'
      AND (p.identity_status = 'unmatched' OR p.identity_status LIKE 'boundary\\_unproven:%' ESCAPE '\\')
      -- An undivided sender also gets a plain sender row with the same text;
      -- the run-together row stands for both.
      AND NOT (p.identity_status = 'unmatched' AND EXISTS (
        SELECT 1 FROM project_source_record_participants l
        WHERE l.organization_id = p.organization_id AND l.project_id = p.project_id
          AND l.source_record_type = p.source_record_type AND l.source_record_id = p.source_record_id
          AND l.identity_status LIKE 'boundary\\_unproven:%' ESCAPE '\\' AND l.source_contact_name = p.source_contact_name))
      ${searchClause}`
}

/** One group per identity, across every project and conversation. */
const GROUP_KEY = sql.raw(IDENTITY_KEY_SQL)

const ORDER_BY: Readonly<Record<(typeof REVIEW_SORT_IDS)[number], SQL>> = {
  literal: sql`lower(literal)`,
  projects: sql`project_count`,
  messages: sql`message_count`,
  date: sql`last_at`,
}

function text(row: unknown, key: string): string | null {
  return cleanText(field(row, key))
}

/** One server page of unresolved participants, one row per identity (bounded LIMIT; no unions). */
export async function listUnresolvedParticipants(
  db: Db,
  organizationId: string,
  query: RecordPageQuery
): Promise<RecordPage<ImportedParticipantReviewRow>> {
  const from = unresolvedFrom(organizationId, query.search)
  const sortId = REVIEW_SORT_IDS.find((id) => id === query.sortId) ?? "messages"
  const direction = query.sortId === null ? sql`DESC` : query.sortDesc ? sql`DESC` : sql`ASC`
  const limit = Math.min(Math.max(query.pageSize, 1), 100)
  const offset = Math.max(query.pageIndex, 0) * limit
  const [rows, totals] = await Promise.all([
    db.all(sql`
      SELECT MIN(p.id) AS id, MIN(p.identity_status) AS identity_status, MIN(p.source_participant_id) AS participant_key,
        COALESCE(MAX(CASE WHEN instr(p.source_contact_name, '<') > 0 THEN p.source_contact_name END), MIN(p.source_contact_name), MIN(p.source_participant_id)) AS literal,
        MIN(p.participant_role) AS role, MIN(p.source_record_type) AS record_type,
        MIN(p.project_id) AS project_id, MIN(pr.name) AS project_name, MIN(pr.project_number) AS project_number,
        COUNT(DISTINCT p.project_id) AS project_count,
        MIN(pr.imported_conversations_staff_only) AS all_staff_only, MAX(pr.imported_conversations_staff_only) AS some_staff_only,
        MIN(m.channel_id) AS channel_id, MIN(c.name) AS channel_name, COUNT(DISTINCT m.channel_id) AS conversation_count,
        COUNT(DISTINCT p.project_id || ':' || p.source_record_id) AS message_count, MIN(m.created_at) AS first_at, MAX(m.created_at) AS last_at
      ${from}
      GROUP BY ${GROUP_KEY}
      ORDER BY ${ORDER_BY[sortId]} ${direction}, MIN(p.id)
      LIMIT ${limit} OFFSET ${offset}`),
    // The true number of identities (no cap).
    db.all(sql`SELECT COUNT(DISTINCT ${GROUP_KEY}) AS total ${from}`),
  ])
  const total = finiteNumber(field(totals[0], "total")) ?? 0
  return { rows: rows.flatMap((row) => (isRecord(row) ? [reviewRow(row)] : [])), total }
}

function reviewRow(row: Readonly<Record<string, unknown>>): ImportedParticipantReviewRow {
  const identityStatus = text(row, "identity_status") ?? "unmatched"
  const participantKey = text(row, "participant_key") ?? ""
  const keyed = parseParticipantKey(participantKey)
  const literal = typeof row.literal === "string" && row.literal !== participantKey ? row.literal : keyed.email ?? keyed.name ?? participantKey
  const kind = reviewKindFor({ identityStatus, literal, participantKey })
  const sourceSystem = sourceSystemOf(text(row, "record_type") ?? "")
  const readOnlyReason = finiteNumber(row.all_staff_only) === 1 ? LEGAL_HOLD_REASON : null
  const matchable = readOnlyReason === null && isMatchableSource(sourceSystem)
  const conversationCount = finiteNumber(row.conversation_count) ?? 0
  return {
    id: text(row, "id") ?? "",
    kind,
    reason: REVIEW_REASONS[kind],
    literal,
    role: (text(row, "role") ?? "").replace(/_literal$/, ""),
    sourceSystem,
    projectId: text(row, "project_id") ?? "",
    projectName: text(row, "project_name") ?? "",
    projectNumber: text(row, "project_number"),
    projectCount: finiteNumber(row.project_count) ?? 1,
    channelId: conversationCount === 1 ? text(row, "channel_id") : null,
    channelName: conversationCount === 1 ? text(row, "channel_name") : null,
    conversationCount,
    messageCount: finiteNumber(row.message_count) ?? 0,
    firstAt: text(row, "first_at"),
    lastAt: text(row, "last_at"),
    readOnlyReason,
    someLegalHold: readOnlyReason === null && finiteNumber(row.some_staff_only) === 1,
    canPick: matchable && kind !== "run_together",
    canSplit: matchable && kind === "run_together",
    canLeave: readOnlyReason === null,
    whenStaffOnlyIncluded: {
      canPick: isMatchableSource(sourceSystem) && kind !== "run_together",
      canSplit: isMatchableSource(sourceSystem) && kind === "run_together",
      canLeave: true,
    },
  }
}

/** Every participant row in a review group, read or unreviewed (bounded). */
export type ReviewGroupRow = {
  readonly id: string
  readonly organizationId: string
  readonly projectId: string
  readonly recordType: string
  readonly recordId: string
  readonly participantKey: string
  readonly name: string | null
  readonly role: string
  readonly identityStatus: string
  readonly reviewStatus: string
  readonly projectContactId: string | null
  readonly userId: string | null
  readonly channelId: string | null
}

export type ReviewGroup = {
  readonly anchor: ReviewGroupRow
  readonly kind: ReviewKind
  readonly literal: string
  readonly sourceSystem: string
  readonly projectStaffOnly: boolean
  readonly channelId: string | null
  readonly channelName: string | null
  readonly channelAudience: string | null
  readonly sourceThreadId: string | null
  /** The rows the decision applies to: the group, plus an undivided sender's plain sender rows. */
  readonly rows: readonly ReviewGroupRow[]
}

const MAX_GROUP_ROWS = 500

function groupRow(row: unknown): ReviewGroupRow | null {
  const id = text(row, "id")
  const projectId = text(row, "project_id")
  const recordType = text(row, "source_record_type")
  const recordId = text(row, "source_record_id")
  const participantKey = text(row, "source_participant_id")
  const organizationId = text(row, "organization_id")
  if (!id || !projectId || !recordType || !recordId || !participantKey || !organizationId) return null
  return {
    id, organizationId, projectId, recordType, recordId, participantKey,
    name: typeof field(row, "source_contact_name") === "string" ? String(field(row, "source_contact_name")) : null,
    role: text(row, "participant_role") ?? "",
    identityStatus: text(row, "identity_status") ?? "",
    reviewStatus: text(row, "review_status") ?? "",
    projectContactId: text(row, "project_contact_id"),
    userId: text(row, "user_id"),
    channelId: text(row, "channel_id"),
  }
}

const GROUP_COLUMNS = sql`p.id, p.organization_id, p.project_id, p.source_record_type, p.source_record_id, p.source_participant_id,
  p.source_contact_name, p.participant_role, p.identity_status, p.review_status, p.project_contact_id, p.user_id, m.channel_id`

const MESSAGE_JOIN = sql`LEFT JOIN messages m ON m.source_message_id IS NOT NULL
  AND m.source_system = substr(p.source_record_type, 1, length(p.source_record_type) - ${MESSAGE_RECORD_SUFFIX.length})
  AND m.source_message_id = p.source_record_id`

/**
 * The review group of one participant row, scoped to the organization: the
 * same literal (run-together) or the same participant key (person) in the
 * same conversation. Reviewed rows are included so a repeat is recognised.
 */
export async function loadReviewGroup(db: Db, organizationId: string, rowId: string): Promise<ReviewGroup | null> {
  const anchorRows = await db.all(sql`SELECT ${GROUP_COLUMNS}, pr.imported_conversations_staff_only AS staff_only,
      c.name AS channel_name, c.audience AS channel_audience, c.source_thread_id AS source_thread_id
    FROM project_source_record_participants p
    JOIN projects pr ON pr.id = p.project_id AND pr.organization_id = ${organizationId}
    ${MESSAGE_JOIN}
    LEFT JOIN channels c ON c.id = m.channel_id
    WHERE p.id = ${rowId} AND p.organization_id = ${organizationId}
      AND p.source_record_type LIKE ${`%${MESSAGE_RECORD_SUFFIX.replace("_", "\\_")}`} ESCAPE '\\'
    LIMIT 1`)
  const rawAnchor = anchorRows[0]
  const anchor = groupRow(rawAnchor)
  if (!anchor) return null
  const literalRow = anchor.role.endsWith("_literal")
  const sameThread = anchor.channelId === null ? sql`m.channel_id IS NULL AND p.id = ${anchor.id}` : sql`m.channel_id = ${anchor.channelId}`
  const sameText = literalRow
    // The literal rows, and an undivided sender's plain row with the same text.
    ? sql`(p.participant_role LIKE '%\\_literal' ESCAPE '\\' OR p.participant_role = 'sender') AND p.source_contact_name = ${anchor.name ?? ""}`
    : sql`p.participant_role NOT LIKE '%\\_literal' ESCAPE '\\' AND p.source_participant_id = ${anchor.participantKey}`
  const rows = await db.all(sql`SELECT ${GROUP_COLUMNS}
    FROM project_source_record_participants p
    ${MESSAGE_JOIN}
    WHERE p.organization_id = ${organizationId} AND p.project_id = ${anchor.projectId}
      AND p.source_record_type = ${anchor.recordType} AND ${sameThread} AND ${sameText}
    ORDER BY p.id
    LIMIT ${MAX_GROUP_ROWS}`)
  const members = rows.flatMap((row) => {
    const parsed = groupRow(row)
    return parsed ? [parsed] : []
  })
  const keyed = parseParticipantKey(anchor.participantKey)
  const literal = anchor.name ?? keyed.email ?? keyed.name ?? anchor.participantKey
  return {
    anchor,
    kind: reviewKindFor({ identityStatus: literalRow ? "boundary_unproven:" : anchor.identityStatus, literal, participantKey: anchor.participantKey }),
    literal,
    sourceSystem: sourceSystemOf(anchor.recordType),
    projectStaffOnly: finiteNumber(field(rawAnchor, "staff_only")) === 1,
    channelId: anchor.channelId,
    channelName: text(rawAnchor, "channel_name"),
    channelAudience: text(rawAnchor, "channel_audience"),
    sourceThreadId: text(rawAnchor, "source_thread_id"),
    rows: members,
  }
}
