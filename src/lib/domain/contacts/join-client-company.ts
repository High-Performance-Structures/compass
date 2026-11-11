/**
 * "Company" on a client person's record (owner decision 2026-11-10): choosing
 * an existing client company makes the person part of it, in one atomic batch.
 *
 * 1. The person is listed under the company: the company's active person with
 *    the same email is reused; otherwise the record's own person who is this
 *    same person (same email or name) moves with it and is used; otherwise a
 *    new company person is added from the record's name, email and phone.
 * 2. The record is merged into the company with the duplicate merge
 *    (`companyMergeStatements`): its jobs, invoices, Activity and everything
 *    else that points at it move to the company, and the merge audit keeps a
 *    snapshot of what moved. The record's own copies of this same person are
 *    merged into the company person with the people merge.
 * 3. Its project contacts are repointed by UPDATE to the company and that
 *    person (clientCompanyJoinStatements), keeping their ids; rows that name
 *    another of the record's people keep that person.
 * 4. A Compass sign-in on the record (its own person's login, or an accepted
 *    invitation on its project contacts) moves to the company person. The
 *    sign-in email stays locked as before, because the same invitation rows
 *    now name that person.
 *
 * A Sage-linked record is blocked: merging it would hide that Sage client.
 * Nothing is queued to Sage. There is no "leave company": a joined record is
 * merged, so only standalone records can join.
 */
import { activityEventSelectStatement } from "@/lib/activity-log"
import { isRecord } from "@/lib/shared/guards"

import { companyMergeStatements, inspectCompanyMerge, type CompanyMergeCount } from "./company-merge"
import { companyMoveGuard, type CompanyReferenceMove } from "./company-merge-references"
import { normalizeDirectoryKey, normalizeEmailKey } from "./rules"
import { clientCompanyJoinPersonStatement, clientCompanyJoinStatements, contactAccountLinkStatements, contactMergeStatements } from "./store"

type Row = Record<string, unknown>

export type ClientCompanyJoinPair = {
  readonly organizationId: string
  /** The standalone client record that joins. */
  readonly recordId: string
  /** The client company it joins. */
  readonly companyId: string
}

/** Who the record becomes on the company. */
export type ClientCompanyJoinPerson =
  | { readonly kind: "existing"; readonly personId: string; readonly name: string }
  | { readonly kind: "own"; readonly personId: string; readonly name: string }
  | { readonly kind: "new"; readonly personId: string; readonly name: string; readonly email: string | null; readonly phone: string | null; readonly isPrimary: boolean }

export type ClientCompanyJoinPlan = {
  readonly pair: ClientCompanyJoinPair
  readonly recordName: string
  readonly companyName: string
  readonly person: ClientCompanyJoinPerson
  /** The record's own people who are this same person, merged into `person`. */
  readonly samePersonIds: readonly string[]
  /** The record's other people, who join the company as they are. */
  readonly otherPeople: readonly string[]
  /** The Compass sign-in that moves to `person`, and the person it moves from (null: the record's accepted invitation). */
  readonly signIn: { readonly userId: string; readonly fromPersonId: string | null } | null
  readonly projectContacts: readonly { readonly id: string; readonly projectId: string }[]
  readonly demotePrimary: boolean
  readonly moves: readonly CompanyMergeCount[]
  readonly warnings: readonly string[]
  readonly blockers: readonly string[]
  readonly snapshots: { readonly record: Row; readonly company: Row; readonly people: readonly Row[] }
}

const ACTIVE_SAGE = ["queued", "running", "awaiting_review", "pending", "approved", "needs_reconciliation", "sent"]

function text(row: Row | undefined, key: string): string | null {
  const value = row?.[key]
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null
}

async function rows(database: D1Database, query: string, ...binds: readonly unknown[]): Promise<Row[]> {
  const result = await database.prepare(query).bind(...binds).all()
  return result.results.filter(isRecord)
}

function placeholders(values: readonly unknown[]): string {
  return values.map(() => "?").join(", ")
}

/** The live client companies a standalone record can join: every other unmerged client of the company. */
export async function clientCompanyJoinOptions(
  database: D1Database,
  input: { readonly organizationId: string; readonly recordId: string }
): Promise<readonly { readonly id: string; readonly name: string; readonly sageClientNumber: string | null }[]> {
  const found = await rows(database, `SELECT id, name, sage_client_number FROM customers
    WHERE organization_id = ? AND merged_into_customer_id IS NULL AND id <> ? ORDER BY name COLLATE NOCASE`, input.organizationId, input.recordId)
  return found.flatMap((row) => typeof row.id === "string" && typeof row.name === "string"
    ? [{ id: row.id, name: row.name, sageClientNumber: text(row, "sage_client_number") }]
    : [])
}

/** What joining would do, and what blocks it. Reads only. */
export async function inspectClientCompanyJoin(database: D1Database, pair: ClientCompanyJoinPair): Promise<ClientCompanyJoinPlan> {
  const { organizationId, recordId, companyId } = pair
  if (recordId === companyId) throw new Error("Choose a different client company.")
  const records = await rows(database, "SELECT * FROM customers WHERE id IN (?, ?) AND organization_id = ?", recordId, companyId, organizationId)
  const record = records.find((row) => row.id === recordId)
  const company = records.find((row) => row.id === companyId)
  if (!record || !company) throw new Error("Both clients must exist in this company.")
  if (text(record, "merged_into_customer_id")) throw new Error("This client already belongs to a company.")
  if (text(company, "merged_into_customer_id")) throw new Error("That client company was merged into another record. Choose the record it was merged into.")
  const recordName = text(record, "name") ?? ""
  const companyName = text(company, "name") ?? ""

  const blockers: string[] = []
  const warnings: string[] = []
  const sageNumber = text(record, "sage_client_number")
  if (sageNumber || text(record, "sage_client_id")) {
    blockers.push(`${recordName} is linked to Sage${sageNumber ? ` client ${sageNumber}` : ""}. Joining a company would hide that Sage client in Compass, so it cannot join. Nothing is changed in Sage.`)
  }
  if (text(record, "netsuite_id")) blockers.push(`${recordName} is linked to NetSuite, so it cannot join a company.`)

  const people = await rows(database, `SELECT id, customer_id, user_id, name, email, phone, is_primary, active, merged_into_person_id,
      sage_contact_id, sage_line_number FROM customer_contacts WHERE customer_id IN (?, ?)`, recordId, companyId)
  const live = (row: Row): boolean => Number(row.active) === 1 && row.merged_into_person_id === null
  const companyPeople = people.filter((row) => row.customer_id === companyId && live(row))
  const ownPeople = people.filter((row) => row.customer_id === recordId && live(row))
  if (people.some((row) => row.customer_id === recordId && (text(row, "sage_contact_id") || row.sage_line_number !== null))) {
    blockers.push(`A person on ${recordName} is linked to a Sage contact. Joining would hide that Sage contact, so it cannot join.`)
  }

  // Who this person is on the company.
  const email = normalizeEmailKey(text(record, "email") ?? text(record, "primary_email"))
  const nameKey = normalizeDirectoryKey(recordName)
  const sameAsRecord = (row: Row): boolean =>
    (email !== "" && normalizeEmailKey(text(row, "email")) === email) || (nameKey !== "" && normalizeDirectoryKey(text(row, "name")) === nameKey)
  const existing = email ? companyPeople.find((row) => normalizeEmailKey(text(row, "email")) === email) : undefined
  const ownSame = ownPeople.filter(sameAsRecord).sort((a, b) => Number(Boolean(b.user_id)) - Number(Boolean(a.user_id)))
  const ownTarget = existing ? undefined : ownSame[0]
  const person: ClientCompanyJoinPerson = existing
    ? { kind: "existing", personId: String(existing.id), name: text(existing, "name") ?? recordName }
    : ownTarget
      ? { kind: "own", personId: String(ownTarget.id), name: text(ownTarget, "name") ?? recordName }
      : {
          kind: "new", personId: crypto.randomUUID(), name: recordName,
          email: text(record, "email") ?? text(record, "primary_email"), phone: text(record, "phone"),
          isPrimary: companyPeople.length === 0 && ownPeople.length === 0,
        }
  const samePeople = ownSame.filter((row) => row.id !== person.personId)
  const otherPeople = ownPeople.filter((row) => row.id !== person.personId && !samePeople.includes(row))

  const projectRows = await rows(database, `SELECT id, project_id, customer_contact_id FROM project_contacts
    WHERE customer_id = ? OR (customer_id IS NULL AND source_entity_type = 'customer' AND source_entity_id = ?) ORDER BY id`, recordId, recordId)

  // Sign-ins: the record's same-person logins, and accepted invitations on the record's own project contacts
  // by a client member of the company (only they may hold a client person's sign-in).
  const invited = await rows(database, `SELECT DISTINCT i.accepted_by AS user_id FROM project_access_invitations i
      JOIN project_contacts pc ON pc.id = i.project_contact_id JOIN users u ON u.id = i.accepted_by
      JOIN organization_members om ON om.user_id = i.accepted_by AND om.organization_id = ? AND om.role = 'client'
    WHERE i.status = 'accepted' AND u.is_active = 1 AND pc.customer_contact_id IS NULL
      AND (pc.customer_id = ? OR (pc.source_entity_type = 'customer' AND pc.source_entity_id = ?))`, organizationId, recordId, recordId)
  const targetRow = existing ?? ownTarget
  const targetUser = text(targetRow, "user_id")
  const logins = new Map<string, string | null>()
  for (const row of samePeople) {
    const userId = text(row, "user_id")
    if (userId) logins.set(userId, String(row.id))
  }
  for (const row of invited) {
    const userId = text(row, "user_id")
    if (userId && !logins.has(userId)) logins.set(userId, null)
  }
  if (targetUser) logins.delete(targetUser)
  if (logins.size > 1 || (logins.size === 1 && targetUser)) {
    blockers.push(`${recordName} has more than one Compass sign-in. Keep one sign-in per person before joining ${companyName}.`)
  }
  const [moving] = [...logins.entries()]
  const signIn = moving && logins.size === 1 && !targetUser ? { userId: moving[0], fromPersonId: moving[1] } : null
  // A person may hold a company's sign-in only once.
  const companyUsers = new Map(companyPeople.flatMap((row) => {
    const userId = text(row, "user_id")
    return userId && row.id !== person.personId ? [[userId, text(row, "name") ?? "another person"] as const] : []
  }))
  const arriving = [signIn?.userId ?? null, ...otherPeople.map((row) => text(row, "user_id"))].filter((id): id is string => id !== null)
  for (const userId of arriving) {
    const holder = companyUsers.get(userId)
    if (holder) blockers.push(`That Compass sign-in is already on ${holder} at ${companyName}. Merge those people first.`)
  }

  // Sage work still open on the record or its people, as the duplicate merge checks.
  const ownIds = [recordId, ...people.filter((row) => row.customer_id === recordId).map((row) => String(row.id))]
  const binds = [organizationId, ...ownIds]
  const [reviews, snapshots, creates, writes, adds] = await Promise.all([
    rows(database, `SELECT status FROM sage_contact_read_requests WHERE organization_id = ? AND kind IN ('client_company', 'client_person') AND entity_id IN (${placeholders(ownIds)})
      UNION ALL SELECT status FROM sage_contact_change_proposals WHERE organization_id = ? AND kind IN ('client_company', 'client_person') AND entity_id IN (${placeholders(ownIds)})`, ...binds, ...binds),
    rows(database, `SELECT id FROM sage_contact_snapshots WHERE organization_id = ? AND kind IN ('client_company', 'client_person') AND entity_id IN (${placeholders(ownIds)}) LIMIT 1`, ...binds),
    rows(database, "SELECT status FROM sage_contact_create_proposals WHERE organization_id = ? AND customer_id = ?", organizationId, recordId),
    rows(database, "SELECT status FROM sage_client_project_write_operations WHERE organization_id = ? AND customer_id = ?", organizationId, recordId),
    rows(database, `SELECT status FROM sage_directory_add_requests WHERE organization_id = ? AND kind IN ('client_company', 'client_person') AND entity_id IN (${placeholders(ownIds)})`, ...binds),
  ])
  if ([...reviews, ...creates, ...writes, ...adds].some((row) => typeof row.status === "string" && ACTIVE_SAGE.includes(row.status))) {
    blockers.push(`A Sage review, add request or write is still open for ${recordName}. Finish or reject it first.`)
  }
  if (snapshots.length > 0) blockers.push(`${recordName} has a Sage record in Compass. Joining would hide it, so it cannot join.`)

  const details = await inspectCompanyMerge(database, { side: "customer", organizationId, sourceId: recordId, destinationId: companyId })
  blockers.push(...details.blockers)
  warnings.push(...details.warnings)
  const relationship = text(company, "relationship_type") ?? "client"
  if ((text(record, "relationship_type") ?? "client") !== relationship) {
    warnings.push(`${recordName} is a ${text(record, "relationship_type") ?? "client"} and ${companyName} is a ${relationship}; ${companyName} stays a ${relationship}.`)
  }
  if (otherPeople.length > 0) {
    warnings.push(`${otherPeople.length} other ${otherPeople.length === 1 ? "person" : "people"} on ${recordName} also join ${companyName}: ${otherPeople.map((row) => text(row, "name") ?? "unnamed").join(", ")}.`)
  }
  const demotePrimary = companyPeople.some((row) => Number(row.is_primary) === 1) && ownPeople.some((row) => Number(row.is_primary) === 1)

  return {
    pair, recordName, companyName, person,
    samePersonIds: samePeople.map((row) => String(row.id)),
    otherPeople: otherPeople.map((row) => text(row, "name") ?? "unnamed"),
    signIn,
    projectContacts: projectRows.map((row) => ({ id: String(row.id), projectId: String(row.project_id) })),
    demotePrimary,
    // Project contacts and people are moved by the join itself and shown separately.
    moves: details.moves.filter((move) => move.category !== "project_contacts" && move.category !== "people"),
    warnings, blockers,
    snapshots: { record, company, people: people.filter((row) => row.customer_id === recordId) },
  }
}

/**
 * The whole join as one atomic batch: the Activity entry (what moved), the
 * join's own moves, the sign-in move, the company merge, then the record's
 * same-person copies merged into the company person. Run only a plan without
 * blockers; every write is guarded, so a stale plan changes nothing.
 */
export function clientCompanyJoinBatch(
  database: D1Database,
  plan: ClientCompanyJoinPlan,
  actor: { readonly userId: string; readonly name: string; readonly role: string; readonly now: string }
): D1PreparedStatement[] {
  const { organizationId, recordId, companyId } = plan.pair
  const now = actor.now
  const move: CompanyReferenceMove = { side: "customer", mode: "merge", organizationId, sourceId: recordId, destinationId: companyId, now }
  const guard = companyMoveGuard(move)
  const what = {
    recordId, companyId, personId: plan.person.personId, person: plan.person.kind,
    samePersonIds: plan.samePersonIds, otherPeople: plan.otherPeople,
    projectContactIds: plan.projectContacts.map((row) => row.id),
    signInMoved: plan.signIn !== null, moves: plan.moves,
  }
  const activity = activityEventSelectStatement(database, {
    organizationId, actorUserId: actor.userId, actorName: actor.name, actorRole: actor.role,
    category: "account", action: "customer.joined_company", entityType: "customer", entityId: companyId,
    summary: `${plan.recordName} joined ${plan.companyName} as ${plan.person.kind === "existing" ? "an existing" : "a"} person; the client record was merged into the company.`,
    metadata: { sql: "json(?)", binds: [JSON.stringify(what)] }, condition: guard, now,
  })
  const signIn = plan.signIn
  const signInStatements = signIn ? [
    ...(signIn.fromPersonId ? contactAccountLinkStatements(database, {
      kind: "client_person", organizationId, personId: signIn.fromPersonId, previousUserId: signIn.userId, nextUserId: null,
      changedByUserId: actor.userId, now, guard,
    }) : []),
    ...contactAccountLinkStatements(database, {
      kind: "client_person", organizationId, personId: plan.person.personId, previousUserId: null, nextUserId: signIn.userId,
      changedByUserId: actor.userId, now, guard,
    }),
  ] : []
  const newPerson = plan.person.kind === "new" ? plan.person : null
  const people = plan.snapshots.people
  return [
    activity,
    ...(newPerson ? [clientCompanyJoinPersonStatement(database, { move, personId: newPerson.personId, person: newPerson })] : []),
    ...signInStatements,
    ...clientCompanyJoinStatements(database, {
      move, personId: plan.person.personId, samePersonIds: plan.samePersonIds, demotePrimary: plan.demotePrimary,
    }),
    ...companyMergeStatements(database, {
      kind: "customer_company", organizationId, sourceId: recordId, destinationId: companyId,
      sourceSnapshot: JSON.stringify({ record: plan.snapshots.record, join: what }),
      destinationSnapshot: JSON.stringify(plan.snapshots.company),
      peopleCount: people.length, projectContactCount: plan.projectContacts.length, userId: actor.userId, now,
    }),
    ...plan.samePersonIds.flatMap((sourceId) => contactMergeStatements(database, {
      kind: "customer_person", organizationId, sourceId, destinationId: plan.person.personId,
      sourceSnapshot: JSON.stringify(people.find((row) => row.id === sourceId) ?? { id: sourceId }),
      destinationSnapshot: JSON.stringify({ id: plan.person.personId, name: plan.person.name }),
      peopleCount: 0, projectContactCount: 0, userId: actor.userId, now,
    })),
  ]
}
