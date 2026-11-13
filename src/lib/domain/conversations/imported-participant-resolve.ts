import { and, eq, inArray, sql, type AnyColumn } from "drizzle-orm"

import { projectContacts } from "@/db/schema"
import { projectSourceRecordParticipants } from "@/db/schema-participants"
import type { ActionResult } from "@/lib/action-result"
import {
  exactDirectoryPeople,
  findDirectoryPerson,
  searchDirectoryPeople,
  type DirectoryPerson,
} from "@/lib/domain/contacts/people-search"
import { PROJECT_CONTACT_DIRECTORY_REQUIRED } from "@/lib/domain/contacts/rules"
import { insertProjectContactIfMissingStatement } from "@/lib/domain/contacts/store"
import { MANAGED_PARTICIPANT_STATUSES, RECORDED_PARTICIPANT_STATUSES } from "@/lib/domain/documents/participant-machines"
import {
  insertSourceRecordParticipantIfMissingStatement,
  reviewSourceRecordParticipantsStatement,
  type Statement,
} from "@/lib/domain/documents/store"
import { cleanText } from "@/lib/shared/guards"
import type { Db } from "@/lib/server/action-context"

import {
  importedContactId,
  importedContactSource,
  participantKey,
  type ImportedParticipantKind,
} from "./bt-participant-identity"
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
 *   suggested person or pick anyone. Staff may type any name (the literal is
 *   only a guide) and a sender may resolve to several people (owner decision
 *   2026-11-03). Someone not in the directory is added in Contacts first:
 *   job contacts always come from the directory (owner decision 2026-11-10).
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

/** A name line of a split: always a directory person. */
export type SplitChoice = { readonly type: "person"; readonly ref: string }

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
  readonly outcome: "linked"
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

/** A directory person as a new project contact: who they are and which directory record they link to. */
type Entry = {
  readonly kind: ImportedParticipantKind
  readonly identity: string
  readonly displayName: string
  readonly email: string | null
  readonly companyName: string | null
  readonly links: {
    readonly internalContactId?: string | null
    readonly vendorId?: string | null
    readonly vendorContactId?: string | null
    readonly customerId?: string | null
    readonly customerContactId?: string | null
  }
}

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

/** A project contact for a person new to the project, with the same id and source fields the importer used. */
function newContact(db: Db, key: string, entry: Entry, projectId: string, now: string): { readonly id: string; readonly statement: Statement } {
  const identity = cleanText(entry.identity) ?? key
  const id = importedContactId(projectId, identity)
  const source = importedContactSource({ kind: entry.kind, key, identity })
  return {
    id,
    statement: insertProjectContactIfMissingStatement(db, {
      id, projectId,
      contactType: source.contactType,
      sourceSystem: "buildertrend",
      sourceEntityType: source.sourceEntityType,
      sourceEntityId: source.sourceEntityId,
      internalContactId: entry.links.internalContactId ?? null,
      displayName: cleanText(entry.displayName) ?? key,
      companyName: entry.companyName,
      email: entry.email,
      vendorId: entry.links.vendorId ?? null, vendorContactId: entry.links.vendorContactId ?? null,
      customerId: entry.links.customerId ?? null, customerContactId: entry.links.customerContactId ?? null,
      ownerPortalVisible: false, subVendorPortalVisible: false, internalVisible: true,
      active: source.active,
      createdAt: now, updatedAt: now,
    }),
  }
}

/**
 * The chosen directory person as a participant of this project (adds them to
 * the project when needed, uninvited). `known`, when given, answers which
 * project contact already stands for the person (a bulk decision preloads it).
 * Every added project contact is linked to the directory; a person who is only
 * an unlinked contact on another project is refused (add them in Contacts first).
 */
export async function resolvePerson(db: Db, key: string, person: DirectoryPerson, projectId: string, now: string, known?: KnownProjectContacts): Promise<ActionResult<Resolved>> {
  const common = { key, name: person.name, ref: person.ref }
  const ok = (resolved: Resolved): ActionResult<Resolved> => ({ success: true, data: resolved })
  const withContact = async (kind: string, type: ContactLinkType, entry: Entry): Promise<ActionResult<Resolved>> => {
    const existing = known ? known.get(knownContactKey(projectId, type, person.id)) ?? null : await existingProjectContact(db, projectId, type, person.id)
    if (existing) return ok({ ...common, kind, userId: person.userId, contactId: existing, contactStatement: null })
    const created = newContact(db, key, entry, projectId, now)
    return ok({ ...common, kind, userId: person.userId, contactId: created.id, contactStatement: created.statement })
  }
  const named = { displayName: person.name, email: person.email, companyName: null }
  switch (person.type) {
    case "user":
      return ok({ ...common, kind: "staff", userId: person.id, contactId: null, contactStatement: null })
    case "internal":
      // A staff account is the person; an archived contact without one is a former employee.
      if (person.userId) return ok({ ...common, kind: "staff", userId: person.userId, contactId: null, contactStatement: null })
      return withContact("former_staff", "internal", { ...named, kind: "former_staff", identity: `internal:${person.id}`, links: { internalContactId: person.id } })
    case "vendor_contact":
      return withContact("vendor", "vendor_contact", { ...named, kind: "vendor", identity: `person:vendor_contact:${person.id}`, links: { vendorId: person.vendorId, vendorContactId: person.id } })
    case "customer_contact":
      return withContact("owner", "customer_contact", { ...named, kind: "owner", identity: `person:customer_contact:${person.id}`, links: { customerId: person.customerId, customerContactId: person.id } })
    case "project_contact": {
      const kind = person.contactType === "owner" ? "owner" : person.contactType === "internal" ? "former_staff" : "vendor"
      // This project's own contact row is reused as is; nothing is inserted.
      if (person.projectId === projectId) return ok({ ...common, kind, userId: null, contactId: person.id, contactStatement: null })
      // Copying an unlinked contact onto another project would add a contact outside the directory.
      return fail(PROJECT_CONTACT_DIRECTORY_REQUIRED)
    }
  }
}

// ---- Writes -------------------------------------------------------------------

const notStaffOnlyProject = (projectId: string) =>
  sql`NOT EXISTS (SELECT 1 FROM projects WHERE id = ${projectId} AND imported_conversations_staff_only = 1)`

/**
 * review (participant-machines.ts): marks rows reviewed, only while still
 * unreviewed (the store's compare-and-set) and never on a staff-only project
 * unless staff included those.
 */
function reviewRowsStatement(
  db: Db,
  group: ReviewGroup,
  rows: readonly ReviewGroupRow[],
  change: Parameters<typeof reviewSourceRecordParticipantsStatement>[2],
  includeStaffOnlyProjects: boolean,
): Statement | null {
  if (rows.length === 0) return null
  return reviewSourceRecordParticipantsStatement(db, and(
    eq(projectSourceRecordParticipants.organizationId, group.anchor.organizationId),
    inArray(projectSourceRecordParticipants.id, rows.map((row) => row.id)),
    includeStaffOnlyProjects ? undefined : notStaffOnlyProject(group.anchor.projectId),
  ), change)
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
    ...(staffOnly ? MANAGED_PARTICIPANT_STATUSES : RECORDED_PARTICIPANT_STATUSES),
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
  /** Also change rows on a project that keeps imported conversations staff-only (default off); the conversation stays staff-only. */
  readonly includeStaffOnlyProjects?: boolean
}

export type ResolveResult = ActionResult<ReviewOutcome & { readonly pieces: readonly SplitPieceOutcome[] }>

const ALREADY_REVIEWED = "Someone already reviewed this participant differently."

export async function resolveImportedParticipant(input: ResolveInput): Promise<ResolveResult> {
  const { db, organizationId, decision, now } = input
  const group = await loadReviewGroup(db, organizationId, input.rowId)
  if (!group) return fail("This participant was not found.")
  const include = input.includeStaffOnlyProjects === true
  if (group.projectStaffOnly && !include) return fail(LEGAL_HOLD_ERROR)
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
    const statement = reviewRowsStatement(db, group, unreviewed, { set: { updatedAt: now } }, include)
    if (input.apply && statement) await db.batch([statement])
    return { success: true, data: { ...base, changed: input.apply, people: [], refs: [], rowsReviewed: unreviewed.length, pieces: [] } }
  }

  if (decision.type === "pick") {
    // Any person in this organization's directory; a reference from another company is not found.
    const chosen = await findDirectoryPerson(db, organizationId, projectId, decision.ref)
    if (!chosen) return fail("That person was not found in this company's directory.")
    const resolved = await resolvePerson(db, group.anchor.participantKey, chosen, projectId, now)
    if (!resolved.success) return resolved
    const person = resolved.data
    if (unreviewed.length === 0) {
      // Idempotent: the same person again changes nothing; anything else is refused.
      const same = recordedDecision(group) === "pick" && group.rows.every((row) => row.userId === person.userId && row.projectContactId === person.contactId)
      return same ? repeat : fail(ALREADY_REVIEWED)
    }
    const statements = [
      person.contactStatement,
      reviewRowsStatement(db, group, unreviewed, {
        identity: "match",
        set: { projectContactId: person.contactId, userId: person.userId, updatedAt: now },
      }, include),
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
    // Every name is a directory person; someone new is added in Contacts first.
    const choice = decision.pieces[index]?.choice
    if (!choice) return fail(`Choose a person for "${piece}". ${PROJECT_CONTACT_DIRECTORY_REQUIRED}`)
    const parsed = parsePiece(piece)
    const key = participantKey({ participantId: null, namespace, email: parsed.email, displayName: parsed.displayName })
    const chosen = await findDirectoryPerson(db, organizationId, projectId, choice.ref)
    if (!chosen) return fail(`The person chosen for "${piece}" was not found in this company's directory.`)
    const resolved = await resolvePerson(db, key, chosen, projectId, now)
    if (!resolved.success) return fail(`"${piece}": ${resolved.error}`)
    people.push(resolved.data)
    outcomes.push({ piece, name: resolved.data.name, outcome: "linked" })
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
    ...RECORDED_PARTICIPANT_STATUSES,
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
    reviewRowsStatement(db, group, literalRows, { identity: "split", set: { updatedAt: now } }, include),
    sender && people.length === 1
      ? reviewRowsStatement(db, group, senderRows, {
          identity: "match",
          set: { projectContactId: sender.contactId, userId: sender.userId, updatedAt: now },
        }, include)
      : reviewRowsStatement(db, group, senderRows, { set: { updatedAt: now } }, include),
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
