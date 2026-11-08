import { and, eq, inArray, sql, type AnyColumn } from "drizzle-orm"

import {
  importedContactId,
  importedProjectContactRow,
  normalizeEmail,
  normalizeName,
  participantKey,
} from "../../../../scripts/import-buildertrend-participants.mjs"
import { projectContacts } from "@/db/schema"
import { projectSourceRecordParticipants } from "@/db/schema-participants"
import type { ActionResult } from "@/lib/action-result"
import {
  exactDirectoryPeople,
  findDirectoryPerson,
  searchDirectoryPeople,
  type DirectoryPerson,
} from "@/lib/domain/contacts/people-search"
import { insertProjectContactIfMissingStatement } from "@/lib/domain/contacts/store"
import { PROJECT_CONTACT_TYPES } from "@/lib/domain/contacts/statuses"
import {
  insertSourceRecordParticipantIfMissingStatement,
  updateSourceRecordParticipantsStatement,
  type Statement,
} from "@/lib/domain/documents/store"
import { cleanText, field } from "@/lib/shared/guards"
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
 * review). This is a manual review: staff may pick ANY person in their
 * company's directory (owner decision 2026-11-03). People whose full name or
 * email is exactly the text shown are offered first as "Suggested", a hint
 * only. The importer itself stays exact-only.
 *
 * - Pick person: any staff account or internal contact (archived ones too),
 *   vendor person, client person, or unassigned / project-only contact.
 * - Split into people: staff mark the names; for each one they keep the
 *   suggested person, pick anyone, or add a new uninvited, unassigned
 *   contact. Staff may type any name (the literal is only a guide) and a
 *   sender may resolve to several people (owner decision 2026-11-03).
 * - Leave as is: reviewed, no person.
 *
 * The original literal is never edited. Resolution is written on the
 * participant rows (person, identity_status, review_status) and as additive
 * per-message rows for split names. A thread-level row lets the existing
 * "Share with owner/vendor…" include the person; it is active only while the
 * conversation is still staff-only, so nothing becomes visible to an outside
 * audience until staff share it. Per-message rows stay inactive. Projects
 * that keep imported conversations staff-only (legal hold) refuse every
 * change. Nothing is notified or emailed. A reviewed decision is not changed
 * here: a repeat of the same decision is a no-op, a different one is refused.
 */

/** A name line of a split: a directory person, or a new unassigned contact. */
export type SplitChoice = { readonly type: "person"; readonly ref: string } | { readonly type: "new" }

export type ReviewDecision =
  | { readonly type: "pick"; readonly ref: string }
  | { readonly type: "split"; readonly pieces: readonly { readonly text: string; readonly choice: SplitChoice }[] }
  | { readonly type: "leave" }

/** A person shown in the pickers; `ref` is what a decision sends back. */
export type ReviewPerson = {
  readonly ref: string
  readonly name: string
  readonly label: string
  readonly email: string | null
  readonly phone: string | null
}

type SplitPieceOutcome = {
  readonly piece: string
  readonly name: string
  readonly outcome: "linked" | "new_contact"
}

type ReviewOutcome = {
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
  /** The directory references staff chose, for the Activity record. */
  readonly refs: readonly string[]
  readonly rowsReviewed: number
}

const MAX_PIECES = 30
const MAX_PIECE_LENGTH = 200
export const LEGAL_HOLD_ERROR = "This project keeps imported conversations staff-only (for example a legal hold), so its participants cannot be changed."

type Fail = { readonly success: false; readonly error: string }
const fail = (error: string): Fail => ({ success: false, error })

const reviewPerson = (person: DirectoryPerson): ReviewPerson => ({ ref: person.ref, name: person.name, label: person.label, email: person.email, phone: person.phone })

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
 * Staff write one person per line. The literal is a guide, not a limit: the
 * imported text may be truncated or mangled, so staff may type the full name
 * they know. The original literal itself is never edited.
 */
export function checkPieces(pieces: readonly string[]): readonly string[] | string {
  const cleaned = pieces.map(squash).filter((piece) => piece !== "")
  if (cleaned.length === 0) return "Mark at least one name."
  if (cleaned.length > MAX_PIECES) return `Mark at most ${MAX_PIECES} names.`
  for (const piece of cleaned) {
    if (piece.length > MAX_PIECE_LENGTH) return "A name is too long."
  }
  if (new Set(cleaned).size !== cleaned.length) return "The same name is marked twice."
  return cleaned
}

function isMatchable(group: ReviewGroup): boolean {
  return MATCHABLE_SOURCES.some((source) => source === group.sourceSystem)
}

// ---- Reads for the pickers ------------------------------------------------------

/** The suggested people for a review row (exact name or email), plus the project the search is scoped to. */
export async function reviewSuggestions(db: Db, organizationId: string, rowId: string, text: string | null): Promise<ActionResult<readonly ReviewPerson[]>> {
  const group = await loadReviewGroup(db, organizationId, rowId)
  if (!group) return fail("This participant was not found.")
  const keyed = parseParticipantKey(group.anchor.participantKey)
  // For a split line the line's own name or email; otherwise what the row shows.
  const parsed = text ? parsePiece(text) : { displayName: group.anchor.name ?? keyed.name, email: keyed.email }
  const seen = new Map<string, ReviewPerson>()
  for (const value of [parsed.email, parsed.displayName]) {
    if (!value) continue
    for (const person of await exactDirectoryPeople(db, organizationId, group.anchor.projectId, value)) seen.set(person.ref, reviewPerson(person))
  }
  return { success: true, data: [...seen.values()] }
}

/** Anyone in the organization's directory, by name, email or phone (bounded). */
export async function reviewPeopleSearch(db: Db, organizationId: string, rowId: string, search: string): Promise<ActionResult<readonly ReviewPerson[]>> {
  const group = await loadReviewGroup(db, organizationId, rowId)
  if (!group) return fail("This participant was not found.")
  const people = await searchDirectoryPeople(db, organizationId, group.anchor.projectId, search)
  return { success: true, data: people.map(reviewPerson) }
}

// ---- Who the chosen person is on this project ----------------------------------

type Entry = Readonly<Record<string, unknown>> & { readonly kind: string }

export type Resolved = {
  /** The participant key for thread rows and split per-message rows. */
  readonly key: string
  readonly name: string
  readonly ref: string | null
  readonly kind: string
  readonly userId: string | null
  readonly contactId: string | null
  readonly contactStatement: Statement | null
}

export type ContactLinkType = "internal" | "vendor_contact" | "customer_contact"

/** Known project contacts by `<projectId>|<link type>|<directory id>`, preloaded for a bulk decision. */
export type KnownProjectContacts = ReadonlyMap<string, string>

export const knownContactKey = (projectId: string, type: ContactLinkType, id: string): string => `${projectId}|${type}|${id}`

const LINK_COLUMN: Readonly<Record<ContactLinkType, AnyColumn>> = {
  internal: projectContacts.internalContactId,
  vendor_contact: projectContacts.vendorContactId,
  customer_contact: projectContacts.customerContactId,
}

/** The project's own contact row for a directory person, when it already has one. */
async function existingProjectContact(db: Db, projectId: string, type: ContactLinkType, id: string): Promise<string | null> {
  const row = await db
    .select({ id: projectContacts.id })
    .from(projectContacts)
    .where(and(eq(projectContacts.projectId, projectId), eq(LINK_COLUMN[type], id)))
    .orderBy(sql`${projectContacts.active} DESC`, projectContacts.id)
    .get()
  return row?.id ?? null
}

/** A project contact for a person new to the project, built by the importer's own row builder. */
function newContact(db: Db, key: string, entry: Entry, projectId: string, now: string): { readonly id: string; readonly statement: Statement } {
  const identityValue = cleanText(entry.identity) ?? key
  const contactIdValue: unknown = importedContactId(projectId, identityValue)
  const id = typeof contactIdValue === "string" ? contactIdValue : `bt-contact-${identityValue}`
  const row: unknown = importedProjectContactRow({ key, entry }, { contactId: id, projectId, now })
  const text = (name: string): string | null => cleanText(field(row, name))
  return {
    id,
    statement: insertProjectContactIfMissingStatement(db, {
      id, projectId,
      contactType: PROJECT_CONTACT_TYPES.find((type) => type === field(row, "contact_type")) ?? "subcontractor",
      sourceSystem: text("source_system") ?? "buildertrend",
      sourceEntityType: text("source_entity_type") ?? "buildertrend_participant",
      sourceEntityId: text("source_entity_id"),
      internalContactId: text("internal_contact_id"),
      displayName: text("display_name") ?? key,
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

/**
 * The chosen directory person as a participant of this project (adds them to
 * the project when needed, uninvited). `known`, when given, answers which
 * project contact already stands for the person (a bulk decision preloads it).
 */
export async function resolvePerson(db: Db, key: string, person: DirectoryPerson, projectId: string, now: string, known?: KnownProjectContacts): Promise<Resolved> {
  const common = { key, name: person.name, ref: person.ref }
  const withContact = async (kind: string, type: ContactLinkType, entry: Entry): Promise<Resolved> => {
    const existing = known ? known.get(knownContactKey(projectId, type, person.id)) ?? null : await existingProjectContact(db, projectId, type, person.id)
    if (existing) return { ...common, kind, userId: person.userId, contactId: existing, contactStatement: null }
    const created = newContact(db, key, entry, projectId, now)
    return { ...common, kind, userId: person.userId, contactId: created.id, contactStatement: created.statement }
  }
  const named = { displayName: person.name, email: person.email, companyName: null }
  switch (person.type) {
    case "user":
      return { ...common, kind: "staff", userId: person.id, contactId: null, contactStatement: null }
    case "internal":
      // A staff account is the person; an archived contact without one is a former employee.
      if (person.userId) return { ...common, kind: "staff", userId: person.userId, contactId: null, contactStatement: null }
      return withContact("former_staff", "internal", { ...named, kind: "former_staff", identity: `internal:${person.id}`, links: { internalContactId: person.id } })
    case "vendor_contact":
      return withContact("vendor", "vendor_contact", { ...named, kind: "vendor", identity: `person:vendor_contact:${person.id}`, links: { vendorId: person.vendorId, vendorContactId: person.id } })
    case "customer_contact":
      return withContact("owner", "customer_contact", { ...named, kind: "owner", identity: `person:customer_contact:${person.id}`, links: { customerId: person.customerId, customerContactId: person.id } })
    case "project_contact": {
      const kind = person.contactType === "owner" ? "owner" : person.contactType === "internal" ? "former_staff" : "vendor"
      if (person.projectId === projectId) return { ...common, kind, userId: null, contactId: person.id, contactStatement: null }
      // An unassigned person from another project: the same person, added to this one.
      const created = newContact(db, key, { ...named, kind, unassigned: true, identity: person.sourceEntityId ?? `project_contact:${person.id}`, links: {} }, projectId, now)
      return { ...common, kind, userId: null, contactId: created.id, contactStatement: created.statement }
    }
  }
}

/** A name staff chose to add as a new, uninvited, unassigned contact (keyed as the importer keys new people). */
function resolveNewPerson(db: Db, key: string, piece: { readonly displayName: string | null; readonly email: string | null }, namespace: string, projectId: string, now: string): Resolved {
  const emailValue: unknown = normalizeEmail(piece.email)
  const email = typeof emailValue === "string" ? emailValue : null
  const nameValue: unknown = normalizeName(piece.displayName)
  const identity = email ? `new:email:${email}` : `new:name:${typeof nameValue === "string" ? nameValue : key}`
  const displayName = piece.displayName ?? email ?? key
  const kind = namespace === "owner" ? "owner" : "vendor"
  const created = newContact(db, key, { kind, unassigned: true, identity, displayName, email, companyName: null, links: {} }, projectId, now)
  return { key, name: displayName, ref: null, kind, userId: null, contactId: created.id, contactStatement: created.statement }
}

// ---- Writes -------------------------------------------------------------------

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

export const audienceOf = (kind: string): string => (kind === "staff" || kind === "former_staff" ? "internal" : "external")

/** The thread row the Share action reads; active only while the thread is staff-only. */
function threadRowStatement(db: Db, group: ReviewGroup, person: Resolved, now: string): Statement | null {
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
    participantRole: person.kind,
    audience: audienceOf(person.kind),
    projectContactId: person.contactId,
    userId: person.userId,
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

const ALREADY_REVIEWED = "Someone already reviewed this participant differently."

export async function resolveImportedParticipant(input: ResolveInput): Promise<ResolveResult> {
  const { db, organizationId, decision, now } = input
  const group = await loadReviewGroup(db, organizationId, input.rowId)
  if (!group) return fail("This participant was not found.")
  if (group.projectStaffOnly) return fail(LEGAL_HOLD_ERROR)
  if (decision.type === "split" && group.kind !== "run_together") return fail("Only names run together can be split.")
  if (decision.type === "pick" && group.kind === "run_together") return fail("Split names run together into people instead.")
  if (decision.type !== "leave" && !isMatchable(group)) return fail("People from this source can only be left as is.")

  const projectId = group.anchor.projectId
  const base = {
    decision: decision.type, literal: group.literal, projectId,
    channelId: group.channelId, channelName: group.channelName, stillStaffOnly: group.channelAudience === "staff",
  }
  const unreviewed = group.rows.filter((row) => row.reviewStatus === "unreviewed")
  const repeat = { success: true as const, data: { ...base, changed: false, people: [], refs: [], rowsReviewed: 0, pieces: [] } }

  if (decision.type === "leave") {
    if (unreviewed.length === 0) return recordedDecision(group) === "leave" ? repeat : fail(ALREADY_REVIEWED)
    const statement = reviewRowsStatement(db, group, unreviewed, { reviewStatus: "reviewed", updatedAt: now })
    if (input.apply && statement) await db.batch([statement])
    return { success: true, data: { ...base, changed: input.apply, people: [], refs: [], rowsReviewed: unreviewed.length, pieces: [] } }
  }

  if (decision.type === "pick") {
    // Any person in this organization's directory; a reference from another company is not found.
    const chosen = await findDirectoryPerson(db, organizationId, projectId, decision.ref)
    if (!chosen) return fail("That person was not found in this company's directory.")
    const person = await resolvePerson(db, group.anchor.participantKey, chosen, projectId, now)
    if (unreviewed.length === 0) {
      // Idempotent: the same person again changes nothing; anything else is refused.
      const same = recordedDecision(group) === "pick" && group.rows.every((row) => row.userId === person.userId && row.projectContactId === person.contactId)
      return same ? repeat : fail(ALREADY_REVIEWED)
    }
    const statements = [
      person.contactStatement,
      reviewRowsStatement(db, group, unreviewed, {
        projectContactId: person.contactId, userId: person.userId,
        identityStatus: REVIEW_IDENTITY_STATUSES.matched, reviewStatus: "reviewed", updatedAt: now,
      }),
      threadRowStatement(db, group, person, now),
    ].filter((statement): statement is Statement => statement !== null)
    if (input.apply) await runBatch(db, statements)
    return { success: true, data: { ...base, changed: input.apply, people: [person.name], refs: [chosen.ref], rowsReviewed: unreviewed.length, pieces: [] } }
  }

  // Split into people.
  if (unreviewed.length === 0) return recordedDecision(group) === "split" ? repeat : fail(ALREADY_REVIEWED)
  const literalRows = unreviewed.filter((row) => row.role.endsWith("_literal"))
  const role = (literalRows[0]?.role ?? group.anchor.role).replace(/_literal$/, "")
  const checked = checkPieces(decision.pieces.map((piece) => piece.text))
  if (typeof checked === "string") return fail(checked)
  const namespace = literalNamespace(literalRows[0]?.participantKey ?? group.anchor.participantKey)
  const people: Resolved[] = []
  const outcomes: SplitPieceOutcome[] = []
  for (const [index, piece] of checked.entries()) {
    const choice = decision.pieces[index]?.choice ?? { type: "new" }
    const parsed = parsePiece(piece)
    const keyValue: unknown = participantKey({ participantId: null, namespace, email: parsed.email, displayName: parsed.displayName })
    const key = typeof keyValue === "string" ? keyValue : `${namespace}:name:${piece.toLowerCase()}`
    if (choice.type === "person") {
      const chosen = await findDirectoryPerson(db, organizationId, projectId, choice.ref)
      if (!chosen) return fail(`The person chosen for "${piece}" was not found in this company's directory.`)
      const person = await resolvePerson(db, key, chosen, projectId, now)
      people.push(person)
      outcomes.push({ piece, name: person.name, outcome: "linked" })
    } else {
      const person = resolveNewPerson(db, key, parsed, namespace, projectId, now)
      people.push(person)
      outcomes.push({ piece, name: person.name, outcome: "new_contact" })
    }
  }

  const contactStatements = new Map<string, Statement>()
  for (const person of people) {
    if (person.contactId && person.contactStatement) contactStatements.set(person.contactId, person.contactStatement)
  }
  const messageRows: Statement[] = literalRows.flatMap((row) => people.map((person) => insertSourceRecordParticipantIfMissingStatement(db, {
    id: crypto.randomUUID(),
    organizationId: row.organizationId,
    projectId: row.projectId,
    sourceRecordType: row.recordType,
    sourceRecordId: row.recordId,
    sourceParticipantId: person.key,
    sourceContactName: person.name,
    participantRole: role,
    audience: audienceOf(person.kind),
    projectContactId: person.contactId,
    userId: person.userId,
    identityStatus: REVIEW_IDENTITY_STATUSES.matched,
    membershipStatus: "pending",
    reviewStatus: "reviewed",
    // Per-message rows never grant access.
    active: false,
    createdAt: now,
    updatedAt: now,
  })))
  // An undivided sender's plain sender row takes the person only when there is
  // exactly one; a sender split into several people is reviewed without one.
  const senderRows = unreviewed.filter((row) => !row.role.endsWith("_literal"))
  const sender = people[0]
  const statements = [
    ...contactStatements.values(),
    ...messageRows,
    reviewRowsStatement(db, group, literalRows, { identityStatus: REVIEW_IDENTITY_STATUSES.split, reviewStatus: "reviewed", updatedAt: now }),
    sender && people.length === 1
      ? reviewRowsStatement(db, group, senderRows, {
          projectContactId: sender.contactId, userId: sender.userId,
          identityStatus: REVIEW_IDENTITY_STATUSES.matched, reviewStatus: "reviewed", updatedAt: now,
        })
      : reviewRowsStatement(db, group, senderRows, { reviewStatus: "reviewed", updatedAt: now }),
    ...people.map((person) => threadRowStatement(db, group, person, now)),
  ].filter((statement): statement is Statement => statement !== null)
  if (input.apply) await runBatch(db, statements)
  return {
    success: true,
    data: {
      ...base, changed: input.apply, people: people.map((person) => person.name),
      refs: people.flatMap((person) => (person.ref ? [person.ref] : [])), rowsReviewed: unreviewed.length, pieces: outcomes,
    },
  }
}

/** All or nothing in one D1 batch. */
async function runBatch(db: Db, statements: readonly Statement[]): Promise<void> {
  const [first, ...rest] = statements
  if (!first) return
  await db.batch([first, ...rest])
}
