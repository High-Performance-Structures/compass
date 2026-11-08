import { and, asc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm"

import { customers, projectAccessInvitations, projectContacts, projects, users, vendors } from "@/db/schema"
import type { Db } from "@/lib/server/action-context"

import { normalizeCompanyName } from "./rules"
import { unassignedPersonKeys } from "./unassigned-matching"

/*
 * People added from imported (Buildertrend) messages who are not connected to
 * any vendor or customer company yet (owner decision 2026-11-02). Staff find
 * them on the Contacts page and connect each one to the company they work for
 * ("Connect to company…", see connect-unassigned-person.ts). One row per
 * person with every project they appear on. The importer gave each address
 * or name its own identity, so identities that are the same person (the same
 * email, case-insensitive, also when written "Name <email>") are one row; its
 * `identity` then lists them all (owner decision 2026-11-08).
 */

/** Separates the importer identities of one listed person. */
const IDENTITY_SEPARATOR = "\u001f"

/** The importer identities a listed person stands for. */
function splitUnassignedIdentity(identity: string): readonly string[] {
  return [...new Set(identity.split(IDENTITY_SEPARATOR).map((value) => value.trim()).filter(Boolean))].slice(0, 50)
}

/** Rows of one listed person: their identities, or the contact id when the importer gave none. */
export function unassignedIdentityWhere(identity: string): SQL {
  const identities = [...splitUnassignedIdentity(identity)]
  const where = or(
    inArray(projectContacts.sourceEntityId, identities),
    and(isNull(projectContacts.sourceEntityId), inArray(projectContacts.id, identities)),
  )
  if (!where) throw new Error("Unassigned identity filter is empty")
  return where
}

export type UnassignedPerson = {
  readonly identity: string
  readonly name: string
  readonly email: string | null
  readonly phone: string | null
  /** The company name the imported messages showed, if any. */
  readonly companyName: string | null
  /**
   * True once they accepted a Compass invitation on one of these rows: the
   * edit form then locks their sign-in email (the save re-checks this).
   */
  readonly hasAccount: boolean
  readonly projects: readonly {
    readonly projectId: string
    readonly projectName: string
    readonly projectNumber: string | null
    readonly contactId: string
  }[]
}

/** The importer's source entity type for a person not yet connected to a company. */
const NEW_PERSON_SOURCE = "buildertrend_new_person"
const MAX_ROWS = 2000

/** Imported people in the organization's projects not yet connected to a vendor or client. */
export function unassignedPersonWhere(organizationId: string): SQL {
  const where = and(
    sql`${projectContacts.projectId} in (select ${projects.id} from ${projects} where ${projects.organizationId} = ${organizationId})`,
    eq(projectContacts.sourceEntityType, NEW_PERSON_SOURCE),
    eq(projectContacts.active, true),
    isNull(projectContacts.vendorId),
    isNull(projectContacts.customerId),
  )
  if (!where) throw new Error("Unassigned person filter is empty")
  return where
}

export async function listUnassignedPeople(db: Db, organizationId: string): Promise<readonly UnassignedPerson[]> {
  const rows = await db
    .select({
      contactId: projectContacts.id,
      identity: projectContacts.sourceEntityId,
      name: projectContacts.displayName,
      email: projectContacts.email,
      phone: projectContacts.phone,
      companyName: projectContacts.companyName,
      projectId: projects.id,
      projectName: projects.name,
      projectNumber: projects.projectNumber,
      accepted: sql<number>`exists (select 1 from ${projectAccessInvitations} inner join ${users} on ${users.id} = ${projectAccessInvitations.acceptedBy} where ${projectAccessInvitations.projectContactId} = ${projectContacts.id} and ${projectAccessInvitations.status} = 'accepted' and ${users.isActive} = 1)`,
    })
    .from(projectContacts)
    .innerJoin(projects, eq(projects.id, projectContacts.projectId))
    .where(and(eq(projects.organizationId, organizationId), unassignedPersonWhere(organizationId)))
    .orderBy(asc(projectContacts.displayName), asc(projects.name))
    .limit(MAX_ROWS)

  type Person = { name: string; email: string | null; phone: string | null; companyName: string | null; hasAccount: boolean; identities: Set<string>; projects: UnassignedPerson["projects"][number][] }
  const people = new Map<string, Person>()
  // The same person under several importer identities is one row.
  const keys = unassignedPersonKeys(rows.map((row) => ({ identity: row.identity ?? row.contactId, name: row.name, email: row.email })))
  for (const row of rows) {
    const identity = row.identity ?? row.contactId
    const { key, email } = keys.get(identity) ?? { key: `identity:${identity}`, email: null }
    // The plain address, also when the import stored "Name <email>".
    const person = people.get(key) ?? { name: row.name, email: email ?? row.email, phone: row.phone, companyName: null, hasAccount: false, identities: new Set<string>(), projects: [] }
    person.identities.add(identity)
    person.projects.push({ projectId: row.projectId, projectName: row.projectName, projectNumber: row.projectNumber, contactId: row.contactId })
    if (!person.email && row.email) person.email = row.email
    if (Number(row.accepted) === 1) person.hasAccount = true
    if (!person.phone && row.phone) person.phone = row.phone
    if (!person.companyName && row.companyName?.trim()) person.companyName = row.companyName.trim()
    people.set(key, person)
  }
  return [...people.values()].map(({ identities, ...person }) => ({ identity: [...identities].sort().join(IDENTITY_SEPARATOR), ...person }))
}

export type CompanySuggestion = { readonly kind: "vendor" | "customer"; readonly id: string; readonly name: string }

const SUGGESTION_SCAN_LIMIT = 200

/**
 * The vendor (or, failing that, client company) whose name is the person's
 * imported company name once case, spacing, punctuation and a trailing legal
 * suffix (LLC, Inc, …) are ignored. Exact matches only; null when there is
 * none or more than one.
 */
export async function suggestCompanyForImportedName(
  db: Db,
  organizationId: string,
  companyName: string | null
): Promise<CompanySuggestion | null> {
  const target = normalizeCompanyName(companyName)
  // One plain word narrows the scan; the exact comparison happens below.
  const token = target?.split(" ").find((word) => /^[a-z0-9]{2,}$/.test(word))
  if (!target || !token) return null
  const pattern = `%${token}%`
  const vendorRows = await db
    .select({ id: vendors.id, name: vendors.name })
    .from(vendors)
    .where(and(
      eq(vendors.organizationId, organizationId),
      eq(vendors.directoryStatus, "active"),
      sql`lower(trim(${vendors.category})) <> 'internal'`,
      sql`lower(${vendors.name}) like ${pattern}`,
    ))
    .limit(SUGGESTION_SCAN_LIMIT)
  const vendorMatches = vendorRows.filter((row) => normalizeCompanyName(row.name) === target)
  if (vendorMatches.length > 1) return null
  const vendor = vendorMatches[0]
  if (vendor) return { kind: "vendor", id: vendor.id, name: vendor.name }
  const customerRows = await db
    .select({ id: customers.id, company: customers.company })
    .from(customers)
    .where(and(
      eq(customers.organizationId, organizationId),
      isNull(customers.mergedIntoCustomerId),
      sql`lower(${customers.company}) like ${pattern}`,
    ))
    .limit(SUGGESTION_SCAN_LIMIT)
  const customerMatches = customerRows.filter((row) => normalizeCompanyName(row.company) === target)
  const customer = customerMatches.length === 1 ? customerMatches[0] : undefined
  return customer?.company ? { kind: "customer", id: customer.id, name: customer.company } : null
}
