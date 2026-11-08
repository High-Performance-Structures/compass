import { and, eq, isNull, sql, type SQL } from "drizzle-orm"

import { importedVendorContactId } from "../../../../scripts/import-buildertrend-participants.mjs"
import {
  customerContacts,
  customers,
  internalContacts,
  organizationMembers,
  projectContacts,
  projects,
  userAlternateEmails,
  users,
  vendorContacts,
  vendors,
} from "@/db/schema"
import { projectSourceRecordParticipants } from "@/db/schema-participants"
import type { DirectoryPerson } from "@/lib/domain/contacts/people-search"
import { insertVendorPersonStatement } from "@/lib/domain/contacts/store"
import {
  insertThreadParticipantsForMessagesStatement,
  updateSourceRecordParticipantsStatement,
  type Statement,
} from "@/lib/domain/documents/store"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { cleanText, field, finiteNumber } from "@/lib/shared/guards"
import type { Db } from "@/lib/server/action-context"
import { isInternalStaffRole } from "@/lib/user-roles"

import { audienceOf, knownContactKey, resolvePerson, type Resolved } from "./imported-participant-resolve"
import { REVIEW_IDENTITY_STATUSES } from "./imported-participant-review"
import { buildMatchDirectory, type BuiltDirectory, type DirectoryRows } from "./participant-directory"
import {
  IDENTITY_KEY_SQL,
  MATCH_TYPES,
  identityFromKey,
  matchParticipant,
  parseParticipantText,
  type MatchResult,
  type MatchType,
  type ParticipantIdentity,
} from "./participant-matching"

/*
 * Resolves unresolved imported participants a whole identity at a time
 * (owner-approved plan 2026-11-08): the automatic pass over every clearly
 * matched identity, and one staff decision applied to every row of a name on
 * Contacts → Needs review.
 *
 * Rows are grouped by identity (IDENTITY_KEY_SQL) and project, and written by
 * that key in SQL, so no row ids are loaded. The writes are the single
 * review's: the person on the rows (matched, reviewed), the project contact
 * when the person is new to the project (uninvited), and the thread row
 * "Share with owner/vendor…" reads, active only while the conversation is
 * staff-only. Projects that keep imported conversations staff-only (legal
 * hold) are left out unless staff explicitly include them
 * (`includeStaffOnlyProjects`, default off); either way conversation
 * visibility never changes. Nothing is shared, notified or emailed.
 */

const NOT_LEGAL_HOLD = sql`NOT EXISTS (SELECT 1 FROM projects lh WHERE lh.id = p.project_id AND lh.imported_conversations_staff_only = 1)`
const KEY = sql.raw(IDENTITY_KEY_SQL)

/** Unresolved person rows of one company (run-together literals and an undivided sender's plain rows are left to the split review). */
function unresolvedPersonRows(organizationId: string): SQL {
  return sql`p.organization_id = ${organizationId}
    AND p.review_status = 'unreviewed' AND p.active = 0
    AND p.project_contact_id IS NULL AND p.user_id IS NULL
    AND p.source_record_type LIKE '%\\_message' ESCAPE '\\'
    AND p.identity_status = 'unmatched'
    AND NOT EXISTS (
      SELECT 1 FROM project_source_record_participants l
      WHERE l.organization_id = p.organization_id AND l.project_id = p.project_id
        AND l.source_record_type = p.source_record_type AND l.source_record_id = p.source_record_id
        AND l.identity_status LIKE 'boundary\\_unproven:%' ESCAPE '\\' AND l.source_contact_name = p.source_contact_name)`
}

/** Leaves out projects that keep imported conversations staff-only, unless staff included them. */
const projectFilter = (includeStaffOnlyProjects: boolean): SQL => (includeStaffOnlyProjects ? sql`1 = 1` : NOT_LEGAL_HOLD)

/** The unresolved rows of one identity on one project that may be changed. */
function writableRows(organizationId: string, projectId: string, key: string, includeStaffOnlyProjects: boolean): SQL {
  return sql`${unresolvedPersonRows(organizationId)} AND p.project_id = ${projectId} AND ${KEY} = ${key} AND ${projectFilter(includeStaffOnlyProjects)}`
}

/** A group the decision leaves alone: its project keeps imported conversations staff-only and staff did not include those. */
export const isHeldGroup = (group: IdentityGroup, includeStaffOnlyProjects: boolean): boolean => group.projectStaffOnly && !includeStaffOnlyProjects

export type IdentityGroup = {
  readonly key: string
  readonly projectId: string
  readonly projectStaffOnly: boolean
  readonly rows: number
  readonly messages: number
  /** The fullest text the source showed ("Name <email>" when there is one). */
  readonly literal: string
}

const MAX_GROUPS = 5000

/** Unresolved person rows by identity and project (one bounded aggregate; optionally one identity). */
export async function listIdentityGroups(db: Db, organizationId: string, onlyKey: string | null = null): Promise<readonly IdentityGroup[]> {
  const rows = await db.all(sql`
    SELECT ${KEY} AS identity_key, p.project_id AS project_id, MAX(pr.imported_conversations_staff_only) AS staff_only,
      COUNT(*) AS row_count, COUNT(DISTINCT p.source_record_id) AS message_count,
      COALESCE(MAX(CASE WHEN instr(p.source_contact_name, '<') > 0 THEN p.source_contact_name END), MIN(p.source_contact_name), MIN(p.source_participant_id)) AS literal
    FROM project_source_record_participants p
    JOIN projects pr ON pr.id = p.project_id AND pr.organization_id = ${organizationId}
    WHERE ${unresolvedPersonRows(organizationId)} ${onlyKey === null ? sql`` : sql`AND ${KEY} = ${onlyKey}`}
    GROUP BY 1, 2
    ORDER BY row_count DESC
    LIMIT ${MAX_GROUPS}`)
  return rows.flatMap((row) => {
    const key = cleanText(field(row, "identity_key"))
    const projectId = cleanText(field(row, "project_id"))
    if (!key || !projectId || key.startsWith("literal:")) return []
    return [{
      key, projectId,
      projectStaffOnly: finiteNumber(field(row, "staff_only")) === 1,
      rows: finiteNumber(field(row, "row_count")) ?? 0,
      messages: finiteNumber(field(row, "message_count")) ?? 0,
      literal: cleanText(field(row, "literal")) ?? key,
    }]
  })
}

/** The identity key of one participant row (for a grouped decision from a listed row). */
export async function identityKeyOfRow(db: Db, organizationId: string, rowId: string): Promise<string | null> {
  const rows = await db.all(sql`SELECT ${KEY} AS identity_key FROM project_source_record_participants p
    WHERE p.id = ${rowId} AND p.organization_id = ${organizationId} LIMIT 1`)
  return cleanText(field(rows[0], "identity_key"))
}

// ---- The directory --------------------------------------------------------------

/**
 * Every directory person of the company, for matching (each read scoped to
 * the organization). `withClients` also counts client companies for domain
 * matching (Contacts → Unassigned can connect a person to a client).
 */
export async function loadMatchDirectory(db: Db, organizationId: string, withClients = false): Promise<BuiltDirectory> {
  const [staff, internal, alternates, vendorRows, vendorPeople, clientPeople, contacts, domains, clientRows] = await Promise.all([
    db.select({ userId: users.id, email: users.email, displayName: users.displayName, firstName: users.firstName, lastName: users.lastName, role: organizationMembers.role, active: users.isActive, phone: users.phone })
      .from(organizationMembers).innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(eq(organizationMembers.organizationId, organizationId)),
    db.select({ id: internalContacts.id, userId: internalContacts.userId, name: internalContacts.name, email: internalContacts.email, active: internalContacts.active, phone: internalContacts.phone })
      .from(internalContacts).where(eq(internalContacts.organizationId, organizationId)),
    db.select({ userId: userAlternateEmails.userId, email: userAlternateEmails.email })
      .from(userAlternateEmails).where(eq(userAlternateEmails.organizationId, organizationId)),
    db.select({ id: vendors.id, name: vendors.name, email: vendors.email, primaryEmail: vendors.primaryEmail, category: vendors.category })
      .from(vendors).where(and(eq(vendors.organizationId, organizationId), isNull(vendors.mergedIntoVendorId))),
    db.select({ id: vendorContacts.id, vendorId: vendorContacts.vendorId, vendorName: vendors.name, name: vendorContacts.name, email: vendorContacts.email, userId: vendorContacts.userId, active: vendorContacts.active, phone: vendorContacts.phone })
      .from(vendorContacts).innerJoin(vendors, eq(vendors.id, vendorContacts.vendorId))
      .where(and(eq(vendors.organizationId, organizationId), isNull(vendors.mergedIntoVendorId), isNull(vendorContacts.mergedIntoPersonId))),
    db.select({ id: customerContacts.id, customerId: customerContacts.customerId, customerName: sql<string>`COALESCE(NULLIF(trim(${customers.company}), ''), ${customers.name})`, name: customerContacts.name, email: customerContacts.email, userId: customerContacts.userId, active: customerContacts.active, phone: customerContacts.phone })
      .from(customerContacts).innerJoin(customers, eq(customers.id, customerContacts.customerId))
      .where(and(eq(customers.organizationId, organizationId), isNull(customers.mergedIntoCustomerId), isNull(customerContacts.mergedIntoPersonId))),
    db.select({
      id: projectContacts.id, projectId: projectContacts.projectId, name: projectContacts.displayName, email: projectContacts.email, phone: projectContacts.phone,
      contactType: projectContacts.contactType, vendorId: projectContacts.vendorId, customerId: projectContacts.customerId,
      vendorContactId: projectContacts.vendorContactId, customerContactId: projectContacts.customerContactId, internalContactId: projectContacts.internalContactId,
      sourceEntityType: projectContacts.sourceEntityType, sourceEntityId: projectContacts.sourceEntityId, active: projectContacts.active,
    }).from(projectContacts).innerJoin(projects, eq(projects.id, projectContacts.projectId)).where(eq(projects.organizationId, organizationId)),
    readFeatureSettings(db, organizationId, "company-email-domains"),
    withClients
      ? db.select({ id: customers.id, name: sql<string>`COALESCE(NULLIF(trim(${customers.company}), ''), ${customers.name})`, email: customers.email })
        .from(customers).where(and(eq(customers.organizationId, organizationId), isNull(customers.mergedIntoCustomerId)))
      : Promise.resolve([]),
  ])
  const rows: DirectoryRows = {
    staff: staff.filter((row) => isInternalStaffRole(row.role)).map((row) => ({
      userId: row.userId, email: row.email, active: row.active, phone: row.phone,
      name: row.displayName ?? (`${row.firstName ?? ""} ${row.lastName ?? ""}`.trim() || null),
    })),
    internal, alternates, vendors: vendorRows, vendorPeople, clientPeople, projectContacts: contacts,
    companyDomains: domains.domains,
    customers: clientRows,
  }
  return buildMatchDirectory(rows)
}

// ---- Planning -------------------------------------------------------------------

type PlannedGroup = IdentityGroup & { readonly identity: ParticipantIdentity; readonly result: MatchResult }

/** What the automatic pass would do with each group (pure). */
function planIdentityGroups(directory: BuiltDirectory, groups: readonly IdentityGroup[]): readonly PlannedGroup[] {
  return groups.flatMap((group) => {
    const identity = identityFromKey(group.key)
    if (!identity) return []
    return [{ ...group, identity, result: matchParticipant(directory.directory, identity, group.projectId) }]
  })
}

// ---- Writing --------------------------------------------------------------------

/** A decision for one identity: an existing directory person, or a new contact of a vendor. */
export type IdentityTarget =
  | { readonly kind: "person"; readonly person: DirectoryPerson }
  | { readonly kind: "vendor"; readonly vendorId: string; readonly vendorName: string }

/** The vendor person a domain decision adds (one per address and company; a re-run adds nothing). */
function vendorPersonFor(organizationId: string, target: Extract<IdentityTarget, { kind: "vendor" }>, group: IdentityGroup, now: string): { readonly person: DirectoryPerson; readonly statement: (db: Db) => Statement } {
  const parsed = parseParticipantText(group.literal)
  const email = group.key.startsWith("email:") ? group.key.slice(6) : parsed.email
  const name = parsed.name ?? email ?? group.literal
  const idValue: unknown = importedVendorContactId(organizationId, email ? `new:email:${email}` : `new:name:${name.toLowerCase()}`)
  const id = typeof idValue === "string" ? idValue : `bt-vendor-contact-${group.key}`
  return {
    person: {
      ref: `vendor_contact:${id}`, type: "vendor_contact", id, name, label: `Vendor: ${target.vendorName}`, email, phone: null, userId: null, active: true,
      vendorId: target.vendorId, customerId: null, projectId: null, contactType: null, sourceEntityId: null, unassigned: false,
    },
    statement: (db) => insertVendorPersonStatement(db, {
      id, vendorId: target.vendorId, name, email, isPrimary: false, active: true, sourceSystem: "buildertrend", sourceRecordId: null, createdAt: now, updatedAt: now,
    }, true),
  }
}

type Written = { readonly statements: readonly Statement[]; readonly resolved: Resolved }

/** The statements that resolve one identity's rows on one project to a person. */
async function groupStatements(
  db: Db,
  input: {
    readonly organizationId: string
    readonly group: IdentityGroup
    readonly target: IdentityTarget
    readonly known: Map<string, string>
    readonly now: string
    readonly includeStaffOnlyProjects: boolean
  },
): Promise<Written> {
  const { organizationId, group, known, now } = input
  const chosen = input.target.kind === "vendor" ? vendorPersonFor(organizationId, input.target, group, now) : { person: input.target.person, statement: null }
  const person = chosen.person
  const resolved = await resolvePerson(db, `review:${person.ref}`, person, group.projectId, now, known)
  // A contact created here stands for the person on this project for the rest of the run.
  const linkType = person.type === "internal" || person.type === "vendor_contact" || person.type === "customer_contact" ? person.type : null
  if (linkType && resolved.contactId) known.set(knownContactKey(group.projectId, linkType, person.id), resolved.contactId)
  const rows = writableRows(organizationId, group.projectId, group.key, input.includeStaffOnlyProjects)
  const statements = [
    chosen.statement ? chosen.statement(db) : null,
    resolved.contactStatement,
    // The thread rows first: the update below takes these rows out of the filter.
    insertThreadParticipantsForMessagesStatement(db, rows, {
      organizationId, projectId: group.projectId, participantKey: resolved.key, name: resolved.name, role: resolved.kind,
      audience: audienceOf(resolved.kind), projectContactId: resolved.contactId, userId: resolved.userId, now,
    }),
    updateSourceRecordParticipantsStatement(db, sql`${projectSourceRecordParticipants.id} IN (SELECT p.id FROM project_source_record_participants p WHERE ${rows})`, {
      projectContactId: resolved.contactId, userId: resolved.userId,
      identityStatus: REVIEW_IDENTITY_STATUSES.matched, reviewStatus: "reviewed", updatedAt: now,
    }),
  ]
  return { statements: statements.filter((statement): statement is Statement => statement !== null), resolved }
}

const BATCH_STATEMENTS = 40

/** Runs statements in bounded D1 batches (each batch is all or nothing). */
async function runBatches(db: Db, statements: readonly Statement[]): Promise<void> {
  for (let index = 0; index < statements.length; index += BATCH_STATEMENTS) {
    const [first, ...rest] = statements.slice(index, index + BATCH_STATEMENTS)
    if (first) await db.batch([first, ...rest])
  }
}

/** Marks every writable row of an identity reviewed with no person ("Leave as is"). */
function leaveStatement(db: Db, organizationId: string, key: string, now: string, includeStaffOnlyProjects: boolean): Statement {
  return updateSourceRecordParticipantsStatement(db, sql`${projectSourceRecordParticipants.id} IN (SELECT p.id FROM project_source_record_participants p
      WHERE ${unresolvedPersonRows(organizationId)} AND ${KEY} = ${key} AND ${projectFilter(includeStaffOnlyProjects)})`, { reviewStatus: "reviewed", updatedAt: now })
}

export type IdentityDecisionOutcome = {
  readonly key: string
  readonly literal: string
  readonly people: readonly string[]
  readonly refs: readonly string[]
  readonly projects: number
  readonly rowsReviewed: number
  /** Rows left untouched because their project keeps imported conversations staff-only. */
  readonly legalHoldRows: number
}

/**
 * One staff decision applied to every unresolved row of an identity, across
 * every project and conversation (legal-hold projects are skipped unless
 * `includeStaffOnlyProjects`; their conversations stay staff-only).
 */
export async function decideIdentity(
  db: Db,
  input: {
    readonly organizationId: string
    readonly key: string
    readonly target: IdentityTarget | { readonly kind: "leave" }
    /** Preloaded project contacts for the chosen person (by link), from `knownContactsFor`. */
    readonly known: Map<string, string>
    readonly now: string
    readonly includeStaffOnlyProjects: boolean
  },
): Promise<IdentityDecisionOutcome> {
  const include = input.includeStaffOnlyProjects
  const groups = await listIdentityGroups(db, input.organizationId, input.key)
  const writable = groups.filter((group) => !isHeldGroup(group, include))
  const legalHoldRows = groups.filter((group) => isHeldGroup(group, include)).reduce((sum, group) => sum + group.rows, 0)
  const rowsReviewed = writable.reduce((sum, group) => sum + group.rows, 0)
  const literal = groups[0]?.literal ?? input.key
  const base = { key: input.key, literal, projects: writable.length, rowsReviewed, legalHoldRows }
  if (writable.length === 0) return { ...base, people: [], refs: [], rowsReviewed: 0 }
  const target = input.target
  if (target.kind === "leave") {
    await runBatches(db, [leaveStatement(db, input.organizationId, input.key, input.now, include)])
    return { ...base, people: [], refs: [] }
  }
  const statements: Statement[] = []
  let name = target.kind === "vendor" ? target.vendorName : target.person.name
  let ref = target.kind === "person" ? target.person.ref : null
  for (const group of writable) {
    const written = await groupStatements(db, { organizationId: input.organizationId, group, target, known: input.known, now: input.now, includeStaffOnlyProjects: include })
    statements.push(...written.statements)
    name = written.resolved.name
    ref = written.resolved.ref ?? ref
  }
  await runBatches(db, statements)
  return { ...base, people: [name], refs: ref ? [ref] : [] }
}

/** The project contacts that already stand for one directory person, on any of the company's projects. */
export async function knownContactsFor(db: Db, organizationId: string, person: DirectoryPerson): Promise<Map<string, string>> {
  const known = new Map<string, string>()
  const column = person.type === "internal" ? projectContacts.internalContactId
    : person.type === "vendor_contact" ? projectContacts.vendorContactId
      : person.type === "customer_contact" ? projectContacts.customerContactId : null
  if (!column || (person.type !== "internal" && person.type !== "vendor_contact" && person.type !== "customer_contact")) return known
  const type = person.type
  const rows = await db
    .select({ id: projectContacts.id, projectId: projectContacts.projectId })
    .from(projectContacts)
    .innerJoin(projects, eq(projects.id, projectContacts.projectId))
    .where(and(eq(projects.organizationId, organizationId), eq(column, person.id)))
    .orderBy(sql`${projectContacts.active} DESC`, projectContacts.id)
  for (const row of rows) {
    const key = knownContactKey(row.projectId, type, person.id)
    if (!known.has(key)) known.set(key, row.id)
  }
  return known
}

// ---- The automatic pass ------------------------------------------------------------

type MatchTypeTotals = { readonly identities: number; readonly groups: number; readonly rows: number }

type AutoResolveExample = {
  readonly literal: string
  readonly target: string
  readonly matchType: MatchType
  readonly projects: number
  readonly rows: number
}

export type AutoResolveSummary = {
  readonly applied: boolean
  /** Projects that keep imported conversations staff-only were included (their conversations stay staff-only). */
  readonly includedStaffOnlyProjects: boolean
  readonly identities: number
  readonly rows: number
  readonly resolved: MatchTypeTotals
  readonly byMatchType: Readonly<Record<MatchType, MatchTypeTotals>>
  readonly legalHold: MatchTypeTotals
  readonly leftover: MatchTypeTotals
  /** The largest resolutions, for staff to check before applying. */
  readonly examples: readonly AutoResolveExample[]
}

function totals(groups: readonly PlannedGroup[]): MatchTypeTotals {
  return { identities: new Set(groups.map((group) => group.key)).size, groups: groups.length, rows: groups.reduce((sum, group) => sum + group.rows, 0) }
}

const targetLabel = (directory: BuiltDirectory, result: MatchResult): string => {
  if (result.kind === "vendor") return `New contact of ${result.vendorName}`
  if (result.kind !== "person") return ""
  const person = directory.people.get(result.ref)
  return person ? `${person.name} (${person.label})` : result.ref
}

/** Summarizes a plan: what would be resolved, by match type, and what is left. */
function summarizePlan(directory: BuiltDirectory, planned: readonly PlannedGroup[], applied: boolean, include: boolean): AutoResolveSummary {
  const writable = planned.filter((group) => !isHeldGroup(group, include))
  const decided = writable.filter((group) => group.result.kind !== "none")
  const byMatchType = Object.fromEntries(MATCH_TYPES.map((type) => [type, totals(decided.filter((group) => group.result.kind !== "none" && group.result.matchType === type))]))
  const exampleMap = new Map<string, { literal: string; target: string; matchType: MatchType; projects: number; rows: number }>()
  for (const group of decided) {
    if (group.result.kind === "none") continue
    const target = targetLabel(directory, group.result)
    const id = `${group.key}|${target}`
    const current = exampleMap.get(id)
    if (current) {
      current.projects += 1
      current.rows += group.rows
    } else {
      exampleMap.set(id, { literal: group.literal, target, matchType: group.result.matchType, projects: 1, rows: group.rows })
    }
  }
  return {
    applied,
    includedStaffOnlyProjects: include,
    identities: new Set(planned.map((group) => group.key)).size,
    rows: planned.reduce((sum, group) => sum + group.rows, 0),
    resolved: totals(decided),
    byMatchType: {
      staff_email: byMatchType.staff_email ?? totals([]), staff_other_email: byMatchType.staff_other_email ?? totals([]),
      staff_company_domain: byMatchType.staff_company_domain ?? totals([]), staff_record_email: byMatchType.staff_record_email ?? totals([]), staff_name: byMatchType.staff_name ?? totals([]),
      same_email: byMatchType.same_email ?? totals([]), same_name: byMatchType.same_name ?? totals([]), vendor_domain: byMatchType.vendor_domain ?? totals([]),
    },
    legalHold: totals(planned.filter((group) => isHeldGroup(group, include))),
    leftover: totals(writable.filter((group) => group.result.kind === "none")),
    examples: [...exampleMap.values()].sort((a, b) => b.rows - a.rows).slice(0, 50),
  }
}

/**
 * The automatic pass: every identity the matcher decides clearly, on every
 * project except legal-hold ones (included only when
 * `includeStaffOnlyProjects`). `apply: false` only reports what it would do
 * (the preview staff check first).
 */
export async function runAutoResolve(
  db: Db,
  input: { readonly organizationId: string; readonly apply: boolean; readonly now: string; readonly includeStaffOnlyProjects: boolean },
): Promise<AutoResolveSummary> {
  const include = input.includeStaffOnlyProjects
  const [directory, groups] = await Promise.all([loadMatchDirectory(db, input.organizationId), listIdentityGroups(db, input.organizationId)])
  const planned = planIdentityGroups(directory, groups)
  const summary = summarizePlan(directory, planned, input.apply, include)
  if (!input.apply) return summary
  const known = new Map(directory.known)
  const statements: Statement[] = []
  for (const group of planned) {
    if (isHeldGroup(group, include)) continue
    const result = group.result
    let target: IdentityTarget | null = null
    if (result.kind === "vendor" && result.companyKind === "vendor") target = { kind: "vendor", vendorId: result.vendorId, vendorName: result.vendorName }
    if (result.kind === "person") {
      const person = directory.people.get(result.ref)
      target = person ? { kind: "person", person } : null
    }
    if (!target) continue
    const written = await groupStatements(db, { organizationId: input.organizationId, group, target, known, now: input.now, includeStaffOnlyProjects: include })
    statements.push(...written.statements)
  }
  await runBatches(db, statements)
  return summary
}
