import { and, eq, inArray, sql } from "drizzle-orm"

import { buildDirectorySnapshot, collectDirectoryRows } from "../../../../scripts/export-bt-directory-snapshot.mjs"
import {
  contactFor,
  createParticipantResolver,
  importedProjectContactRow,
  parseDirectory,
  participantKey,
} from "../../../../scripts/import-buildertrend-participants.mjs"
import { projectSourceRecordParticipants } from "@/db/schema-participants"
import type { ActionResult } from "@/lib/action-result"
import { insertProjectContactIfMissingStatement } from "@/lib/domain/contacts/store"
import { PROJECT_CONTACT_TYPES } from "@/lib/domain/contacts/statuses"
import {
  insertSourceRecordParticipantIfMissingStatement,
  updateSourceRecordParticipantsStatement,
  type Statement,
} from "@/lib/domain/documents/store"
import { cleanText, field, isRecord } from "@/lib/shared/guards"
import type { Db } from "@/lib/server/action-context"

import {
  MATCHABLE_SOURCES,
  REVIEW_IDENTITY_STATUSES,
  THREAD_RECORD_SUFFIX,
  literalNamespace,
  loadReviewGroup,
  parseParticipantKey,
  type ReviewGroup,
  type ReviewGroupRow,
} from "./imported-participant-review"

/*
 * Staff decisions on unresolved imported participants (Contacts → Needs
 * review). Exact matching is the importer's own code, run against the same
 * directory the importer reads (scripts/export-bt-directory-snapshot.mjs ->
 * scripts/import-buildertrend-participants.mjs), so review can never match
 * more loosely than the import did. The BT people catalog is not stored in
 * Compass, so its tier is not used here.
 *
 * - Pick person (ambiguous): only the exact candidates that tie.
 * - Split into people (run-together): staff mark the names; each is resolved
 *   exactly as the importer resolves a proven participant, so it links to its
 *   single exact match or becomes a new uninvited, unassigned contact.
 * - Leave as is: reviewed, no person.
 *
 * The original literal is never edited. Resolution is written on the
 * participant rows (person, identity_status, review_status) and as additive
 * per-message rows for split names. A thread-level row lets the existing
 * "Share with owner/vendor…" include the person later; it is active only
 * while the conversation is still staff-only, so nothing becomes visible to
 * an outside audience until staff share it. Per-message rows stay inactive.
 * Projects that keep imported conversations staff-only (legal hold) refuse
 * every change. Nothing is notified or emailed.
 */

export type ReviewDecision =
  | { readonly type: "pick"; readonly personKey: string }
  | { readonly type: "split"; readonly pieces: readonly string[] }
  | { readonly type: "leave" }

export type ReviewCandidate = {
  readonly personKey: string
  readonly name: string
  readonly kind: string
  readonly emails: readonly string[]
}

export type SplitPieceOutcome = {
  readonly piece: string
  readonly name: string
  readonly outcome: "linked" | "new_contact"
}

export type ReviewOutcome = {
  /** False when the same decision was already recorded (a repeat is a no-op). */
  readonly changed: boolean
  readonly decision: ReviewDecision["type"]
  readonly literal: string
  readonly projectId: string
  readonly channelId: string | null
  readonly channelName: string | null
  /** The conversation is still visible to staff only; sharing stays a staff decision. */
  readonly stillStaffOnly: boolean
  readonly people: readonly string[]
  readonly rowsReviewed: number
}

const MAX_PIECES = 30
const MAX_PIECE_LENGTH = 200
export const LEGAL_HOLD_ERROR = "This project keeps imported conversations staff-only (for example a legal hold), so its participants cannot be changed."

type Fail = { readonly success: false; readonly error: string }
const fail = (error: string): Fail => ({ success: false, error })

// ---- The importer's resolver, typed at the boundary --------------------------

type Entry = {
  readonly raw: Readonly<Record<string, unknown>>
  readonly kind: string
  readonly userId: string | null
  readonly unassigned: boolean
  readonly displayName: string | null
}

type Ref = { readonly participantId: null; readonly namespace: string; readonly email: string | null; readonly displayName: string | null; readonly kind: string }

type Resolver = {
  readonly resolve: (ref: Ref, projectId: string) => { readonly entry: Entry } | { readonly reason: string }
  readonly candidates: (ref: Ref, projectId: string) => readonly (ReviewCandidate & { readonly entry: Entry })[]
}

function entryOf(value: unknown): Entry | null {
  if (!isRecord(value)) return null
  return {
    raw: value,
    kind: cleanText(value.kind) ?? "vendor",
    userId: cleanText(value.userId),
    unassigned: value.unassigned === true,
    displayName: cleanText(value.displayName),
  }
}

/**
 * The importer's resolver over this organization's directory, read with the
 * export's own paged SELECTs (LIMIT 500 each). Built only when staff open a
 * pick or submit a split, never for the list.
 */
async function loadParticipantResolver(db: Db, organizationId: string): Promise<Resolver> {
  const rows = await collectDirectoryRows(organizationId, (query: string) => db.all(sql.raw(query)))
  const directory = parseDirectory(buildDirectorySnapshot(rows))
  const resolver = createParticipantResolver({ participantMap: new Map(), directory, catalog: [], organizationId })
  return {
    resolve: (ref, projectId) => {
      const result: unknown = resolver(ref, projectId)
      const entry = entryOf(field(result, "entry"))
      return entry ? { entry } : { reason: cleanText(field(result, "reason")) ?? "participant_unmatched" }
    },
    candidates: (ref, projectId) => {
      const list: unknown = resolver.candidates(ref, projectId)
      if (!Array.isArray(list)) return []
      return list.flatMap((item: unknown) => {
        const entry = entryOf(field(item, "entry"))
        const personKey = cleanText(field(item, "personKey"))
        if (!entry || !personKey) return []
        const emails = field(item, "emails")
        return [{
          personKey,
          name: cleanText(field(item, "displayName")) ?? personKey,
          kind: cleanText(field(item, "kind")) ?? entry.kind,
          emails: Array.isArray(emails) ? emails.filter((email): email is string => typeof email === "string") : [],
          entry,
        }]
      })
    },
  }
}

// ---- Pure rules ---------------------------------------------------------------

/** "Jane Doe <jane@x.com>", "jane@x.com" or "Jane Doe": the name and email a marked piece shows. */
export function parsePiece(piece: string): { readonly displayName: string | null; readonly email: string | null } {
  const value = piece.trim().replace(/\s+/g, " ")
  const angled = /^(.*?)\s*<\s*([^<>\s]+@[^<>\s]+)\s*>$/.exec(value)
  if (angled) return { displayName: angled[1]?.trim() || null, email: angled[2] ?? null }
  if (value.includes("@") && !/\s/.test(value)) return { displayName: null, email: value }
  return { displayName: value || null, email: null }
}

const squash = (value: string): string => value.trim().replace(/\s+/g, " ")

/**
 * Staff mark the boundaries; they never type new text. Every piece must be
 * text from the literal, and a sender is one person.
 */
export function checkPieces(literal: string, pieces: readonly string[], role: string): readonly string[] | string {
  const cleaned = pieces.map(squash).filter((piece) => piece !== "")
  if (cleaned.length === 0) return "Mark at least one name."
  if (cleaned.length > MAX_PIECES) return `Mark at most ${MAX_PIECES} names.`
  if (role === "sender" && cleaned.length !== 1) return "A sender is one person: mark exactly one name."
  const whole = squash(literal)
  for (const piece of cleaned) {
    if (piece.length > MAX_PIECE_LENGTH) return "A name is too long."
    if (!whole.includes(piece)) return `"${piece}" is not part of the original text.`
  }
  if (new Set(cleaned).size !== cleaned.length) return "The same name is marked twice."
  return cleaned
}

function isMatchable(group: ReviewGroup): boolean {
  return MATCHABLE_SOURCES.some((source) => source === group.sourceSystem)
}

function personRef(group: ReviewGroup): Ref {
  const keyed = parseParticipantKey(group.anchor.participantKey)
  return { participantId: null, namespace: keyed.namespace, email: keyed.email, displayName: group.anchor.name ?? keyed.name, kind: group.anchor.role }
}

/** The exact candidates staff may pick for an ambiguous participant. */
export async function reviewCandidates(db: Db, organizationId: string, rowId: string): Promise<ActionResult<readonly ReviewCandidate[]>> {
  const group = await loadReviewGroup(db, organizationId, rowId)
  if (!group) return fail("This participant was not found.")
  if (group.kind === "run_together") return fail("Split this one into people instead.")
  if (!isMatchable(group)) return { success: true, data: [] }
  const resolver = await loadParticipantResolver(db, organizationId)
  const data = resolver.candidates(personRef(group), group.anchor.projectId).map((candidate) => ({ personKey: candidate.personKey, name: candidate.name, kind: candidate.kind, emails: candidate.emails }))
  return { success: true, data }
}

// ---- Writes -------------------------------------------------------------------

type Person = { readonly key: string; readonly name: string; readonly entry: Entry; readonly contactId: string | null }

function projectContactStatement(db: Db, person: { readonly key: string; readonly entry: Entry }, projectId: string, now: string): { readonly id: string | null; readonly statement: Statement | null } {
  if (person.entry.kind === "staff") return { id: null, statement: null }
  const contact: unknown = contactFor({ key: person.key, entry: person.entry.raw }, projectId)
  const id = cleanText(field(contact, "id"))
  if (!id) return { id: null, statement: null }
  if (field(contact, "create") !== true) return { id, statement: null }
  const row: unknown = importedProjectContactRow({ key: person.key, entry: person.entry.raw }, { contactId: id, projectId, now })
  const contactType = PROJECT_CONTACT_TYPES.find((type) => type === field(row, "contact_type")) ?? "subcontractor"
  const text = (key: string): string | null => cleanText(field(row, key))
  return {
    id,
    statement: insertProjectContactIfMissingStatement(db, {
      id, projectId, contactType,
      sourceSystem: text("source_system") ?? "buildertrend",
      sourceEntityType: text("source_entity_type") ?? "buildertrend_participant",
      sourceEntityId: text("source_entity_id"),
      internalContactId: text("internal_contact_id"),
      displayName: text("display_name") ?? person.key,
      companyName: text("company_name"),
      email: text("email"),
      vendorId: text("vendor_id"), vendorContactId: text("vendor_contact_id"),
      customerId: text("customer_id"), customerContactId: text("customer_contact_id"),
      ownerPortalVisible: false, subVendorPortalVisible: false, internalVisible: true,
      active: field(row, "active") !== 0,
      createdAt: now, updatedAt: now,
    }),
  }
}

const notStaffOnlyProject = (projectId: string) =>
  sql`NOT EXISTS (SELECT 1 FROM projects WHERE id = ${projectId} AND imported_conversations_staff_only = 1)`

/** Marks rows reviewed, only while still unreviewed and never on a staff-only project. */
function reviewRowsStatement(db: Db, group: ReviewGroup, rows: readonly ReviewGroupRow[], set: Parameters<typeof updateSourceRecordParticipantsStatement>[2]): Statement | null {
  if (rows.length === 0) return null
  return updateSourceRecordParticipantsStatement(db, and(
    eq(projectSourceRecordParticipants.organizationId, group.anchor.organizationId),
    inArray(projectSourceRecordParticipants.id, rows.map((row) => row.id)),
    eq(projectSourceRecordParticipants.reviewStatus, "unreviewed"),
    notStaffOnlyProject(group.anchor.projectId),
  ), set)
}

/** The thread row the Share action reads; active only while the thread is staff-only. */
function threadRowStatement(db: Db, group: ReviewGroup, person: Person, now: string): Statement | null {
  if (!group.sourceThreadId) return null
  const staffOnly = group.channelAudience === "staff"
  return insertSourceRecordParticipantIfMissingStatement(db, {
    id: crypto.randomUUID(),
    organizationId: group.anchor.organizationId,
    projectId: group.anchor.projectId,
    sourceRecordType: `${group.sourceSystem}${THREAD_RECORD_SUFFIX}`,
    sourceRecordId: group.sourceThreadId,
    sourceParticipantId: person.key,
    sourceContactName: person.name,
    participantRole: person.entry.kind,
    audience: person.entry.kind === "staff" || person.entry.kind === "former_staff" ? "internal" : "external",
    projectContactId: person.contactId,
    userId: person.entry.userId,
    identityStatus: REVIEW_IDENTITY_STATUSES.matched,
    membershipStatus: staffOnly ? "active" : "pending",
    reviewStatus: "reviewed",
    active: staffOnly,
    createdAt: now,
    updatedAt: now,
  })
}

/** What was already decided for a fully reviewed group, to make a repeat a no-op. */
function recordedDecision(group: ReviewGroup): ReviewDecision["type"] {
  if (group.rows.some((row) => row.identityStatus === REVIEW_IDENTITY_STATUSES.split)) return "split"
  if (group.rows.some((row) => row.projectContactId !== null || row.userId !== null)) return "pick"
  return "leave"
}

export type ResolveInput = {
  readonly db: Db
  readonly organizationId: string
  readonly rowId: string
  readonly decision: ReviewDecision
  /** False: check and describe the outcome without writing (split preview). */
  readonly apply: boolean
  readonly now: string
}

export type ResolveResult = ActionResult<ReviewOutcome & { readonly pieces: readonly SplitPieceOutcome[] }>

export async function resolveImportedParticipant(input: ResolveInput): Promise<ResolveResult> {
  const { db, organizationId, decision, now } = input
  const group = await loadReviewGroup(db, organizationId, input.rowId)
  if (!group) return fail("This participant was not found.")
  if (group.projectStaffOnly) return fail(LEGAL_HOLD_ERROR)
  if (decision.type === "split" && group.kind !== "run_together") return fail("Only names run together can be split.")
  if (decision.type === "pick" && group.kind === "run_together") return fail("Split names run together into people instead.")
  if (decision.type !== "leave" && !isMatchable(group)) return fail("People from this source can only be left as is.")

  const base = {
    decision: decision.type, literal: group.literal, projectId: group.anchor.projectId,
    channelId: group.channelId, channelName: group.channelName, stillStaffOnly: group.channelAudience === "staff",
  }
  const unreviewed = group.rows.filter((row) => row.reviewStatus === "unreviewed")
  if (unreviewed.length === 0) {
    // Idempotent: the same decision again changes nothing; a different one is refused.
    if (recordedDecision(group) !== decision.type) return fail("Someone already reviewed this participant differently.")
    return { success: true, data: { ...base, changed: false, people: [], rowsReviewed: 0, pieces: [] } }
  }

  if (decision.type === "leave") {
    const statement = reviewRowsStatement(db, group, unreviewed, { reviewStatus: "reviewed", updatedAt: now })
    if (input.apply && statement) await db.batch([statement])
    return { success: true, data: { ...base, changed: input.apply, people: [], rowsReviewed: unreviewed.length, pieces: [] } }
  }

  const resolver = await loadParticipantResolver(db, organizationId)
  const projectId = group.anchor.projectId
  const contactStatements = new Map<string, Statement>()
  const withContact = (key: string, name: string, entry: Entry): Person => {
    const contact = projectContactStatement(db, { key, entry }, projectId, now)
    if (contact.id && contact.statement) contactStatements.set(contact.id, contact.statement)
    return { key, name, entry, contactId: contact.id }
  }

  if (decision.type === "pick") {
    const ref = personRef(group)
    const candidate = resolver.candidates(ref, projectId).find((item) => item.personKey === decision.personKey)
    if (!candidate) return fail("Pick one of the people whose exact name or email matches.")
    const person = withContact(group.anchor.participantKey, candidate.name, candidate.entry)
    const statements = [
      ...contactStatements.values(),
      reviewRowsStatement(db, group, unreviewed, {
        projectContactId: person.contactId, userId: person.entry.userId,
        identityStatus: REVIEW_IDENTITY_STATUSES.matched, reviewStatus: "reviewed", updatedAt: now,
      }),
      threadRowStatement(db, group, person, now),
    ].filter((statement): statement is Statement => statement !== null)
    if (input.apply) await runBatch(db, statements)
    return { success: true, data: { ...base, changed: input.apply, people: [candidate.name], rowsReviewed: unreviewed.length, pieces: [] } }
  }

  // Split into people.
  const literalRows = unreviewed.filter((row) => row.role.endsWith("_literal"))
  const role = (literalRows[0]?.role ?? group.anchor.role).replace(/_literal$/, "")
  const checked = checkPieces(group.literal, decision.pieces, role)
  if (typeof checked === "string") return fail(checked)
  const namespace = literalNamespace(literalRows[0]?.participantKey ?? group.anchor.participantKey)
  const people: Person[] = []
  const outcomes: SplitPieceOutcome[] = []
  const problems: string[] = []
  for (const piece of checked) {
    const parsed = parsePiece(piece)
    const ref: Ref = { participantId: null, namespace, email: parsed.email, displayName: parsed.displayName, kind: role }
    const result = resolver.resolve(ref, projectId)
    if (!("entry" in result)) {
      problems.push(result.reason === "participant_ambiguous" ? `"${piece}" matches more than one contact.` : `"${piece}" is not a full name or email.`)
      continue
    }
    const name = parsed.displayName ?? parsed.email ?? piece
    const keyValue: unknown = participantKey(ref)
    const key = typeof keyValue === "string" ? keyValue : piece
    people.push(withContact(key, name, result.entry))
    outcomes.push({ piece, name: result.entry.displayName ?? name, outcome: result.entry.unassigned ? "new_contact" : "linked" })
  }
  if (problems.length > 0) return fail(`${problems.join(" ")} Mark the names differently, or leave this as is.`)

  const messageRows: Statement[] = literalRows.flatMap((row) => people.map((person) => insertSourceRecordParticipantIfMissingStatement(db, {
    id: crypto.randomUUID(),
    organizationId: row.organizationId,
    projectId: row.projectId,
    sourceRecordType: row.recordType,
    sourceRecordId: row.recordId,
    sourceParticipantId: person.key,
    sourceContactName: person.name,
    participantRole: role,
    audience: person.entry.kind === "staff" || person.entry.kind === "former_staff" ? "internal" : "external",
    projectContactId: person.contactId,
    userId: person.entry.userId,
    identityStatus: REVIEW_IDENTITY_STATUSES.matched,
    membershipStatus: "pending",
    reviewStatus: "reviewed",
    // Per-message rows never grant access.
    active: false,
    createdAt: now,
    updatedAt: now,
  })))
  // An undivided sender's plain sender row is that one person.
  const senderRows = unreviewed.filter((row) => !row.role.endsWith("_literal"))
  const sender = people[0]
  const statements = [
    ...contactStatements.values(),
    ...messageRows,
    reviewRowsStatement(db, group, literalRows, { identityStatus: REVIEW_IDENTITY_STATUSES.split, reviewStatus: "reviewed", updatedAt: now }),
    sender && people.length === 1
      ? reviewRowsStatement(db, group, senderRows, {
          projectContactId: sender.contactId, userId: sender.entry.userId,
          identityStatus: REVIEW_IDENTITY_STATUSES.matched, reviewStatus: "reviewed", updatedAt: now,
        })
      : reviewRowsStatement(db, group, senderRows, { reviewStatus: "reviewed", updatedAt: now }),
    ...people.map((person) => threadRowStatement(db, group, person, now)),
  ].filter((statement): statement is Statement => statement !== null)
  if (input.apply) await runBatch(db, statements)
  return {
    success: true,
    data: { ...base, changed: input.apply, people: outcomes.map((outcome) => outcome.name), rowsReviewed: unreviewed.length, pieces: outcomes },
  }
}

/** All or nothing in one D1 batch. */
async function runBatch(db: Db, statements: readonly Statement[]): Promise<void> {
  const [first, ...rest] = statements
  if (!first) return
  await db.batch([first, ...rest])
}
