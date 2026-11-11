import { and, eq, isNull, ne, or, sql, type AnyColumn, type SQL } from "drizzle-orm"

import {
  customerContacts,
  customers,
  internalContacts,
  organizationMembers,
  projectContacts,
  projects,
  users,
  vendorContacts,
  vendors,
} from "@/db/schema"
import type { Db } from "@/lib/server/action-context"
import { isInternalStaffRole } from "@/lib/user-roles"
import { resolvedContactColumns, withContactDirectory } from "./resolved-columns"

/*
 * One person anywhere in an organization's directory, found by a bounded,
 * server-side search (each source LIMIT 20, no unions): staff accounts and
 * internal contacts (archived ones too), vendor people, client people, and
 * this project's own contacts that are not tied to a directory person
 * (another project's unlinked contacts are never offered: they would be
 * copied outside the directory).
 *
 * A person is addressed by a reference `<type>:<id>`. `findDirectoryPerson`
 * re-reads one reference scoped to the organization, so a reference from
 * another company is never accepted.
 */

const PERSON_REF_TYPES = ["user", "internal", "vendor_contact", "customer_contact", "project_contact"] as const
type PersonRefType = (typeof PERSON_REF_TYPES)[number]

export type DirectoryPerson = {
  readonly ref: string
  readonly type: PersonRefType
  readonly id: string
  readonly name: string
  /** What tells duplicates apart: "Staff", "Archived staff", "Vendor: Acme", "Client: Smith", "Unassigned", "Project contact". */
  readonly label: string
  readonly email: string | null
  readonly phone: string | null
  readonly userId: string | null
  readonly active: boolean
  /** Directory links, for adding the person to a project. */
  readonly vendorId: string | null
  readonly customerId: string | null
  /** For a project contact: its project, contact type and import identity. */
  readonly projectId: string | null
  readonly contactType: string | null
  readonly sourceEntityId: string | null
  readonly unassigned: boolean
}

const PER_SOURCE_LIMIT = 20
const MAX_TERM = 100
const NEW_PERSON_SOURCE = "buildertrend_new_person"

function parsePersonRef(ref: string): { readonly type: PersonRefType; readonly id: string } | null {
  const index = ref.indexOf(":")
  if (index <= 0) return null
  const type = PERSON_REF_TYPES.find((value) => value === ref.slice(0, index))
  const id = ref.slice(index + 1)
  return type && id ? { type, id } : null
}

type Match = { readonly mode: "contains" | "exact"; readonly term: string; readonly email: string | null }

function matcher(input: string, mode: Match["mode"]): Match | null {
  const term = input.trim().replace(/\s+/g, " ").slice(0, MAX_TERM).toLowerCase()
  if (term.length < 2) return null
  const email = /^[^\s@]+@[^\s@]+$/.test(term) ? term : null
  return { mode, term, email }
}

function digits(term: string): string | null {
  if (!/^[\d\s().+-]+$/.test(term)) return null
  const value = term.replace(/\D/g, "")
  return value.length >= 3 ? value : null
}

/** Name, email or phone contains the term (exact: the full name or email equals it). */
function matches(match: Match, name: AnyColumn | SQL, email: AnyColumn | SQL, phones: readonly (AnyColumn | SQL)[]): SQL {
  if (match.mode === "exact") {
    return or(
      sql`lower(trim(${name})) = ${match.term}`,
      match.email ? sql`lower(trim(${email})) = ${match.email}` : undefined,
    ) ?? sql`0`
  }
  const phoneDigits = digits(match.term)
  return or(
    sql`instr(lower(${name}), ${match.term}) > 0`,
    sql`instr(lower(COALESCE(${email}, '')), ${match.term}) > 0`,
    ...(phoneDigits
      ? phones.map((phone) => sql`instr(replace(replace(replace(replace(replace(COALESCE(${phone}, ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', ''), ${phoneDigits}) > 0`)
      : []),
  ) ?? sql`0`
}

const base = { userId: null, vendorId: null, customerId: null, projectId: null, contactType: null, sourceEntityId: null, unassigned: false } as const

function person(type: PersonRefType, id: string, values: Partial<DirectoryPerson> & { readonly name: string; readonly label: string }): DirectoryPerson {
  return { ...base, email: null, phone: null, active: true, ...values, ref: `${type}:${id}`, type, id }
}

/** Every source, each bounded; `only` narrows to one reference for a re-read. */
async function readPeople(db: Db, organizationId: string, projectId: string, match: Match | null, only: { readonly type: PersonRefType; readonly id: string } | null): Promise<readonly DirectoryPerson[]> {
  const want = (type: PersonRefType): boolean => only === null || only.type === type
  const filter = (type: PersonRefType, idColumn: AnyColumn, condition: (m: Match) => SQL): SQL | undefined =>
    only ? (only.type === type ? eq(idColumn, only.id) : sql`0`) : match ? condition(match) : sql`0`
  const limit = only ? 1 : PER_SOURCE_LIMIT
  const [staff, internal, vendorPeople, clientPeople, projectPeople] = await Promise.all([
    want("user") ? db
      .select({ id: users.id, name: sql<string>`COALESCE(${users.displayName}, trim(COALESCE(${users.firstName}, '') || ' ' || COALESCE(${users.lastName}, '')), ${users.email})`, email: users.email, phone: users.phone, role: organizationMembers.role, active: users.isActive })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(and(
        eq(organizationMembers.organizationId, organizationId),
        // A staff account with an internal contact is listed once, as that contact.
        sql`NOT EXISTS (SELECT 1 FROM internal_contacts ic WHERE ic.organization_id = ${organizationId} AND ic.user_id = ${users.id})`,
        filter("user", users.id, (m) => matches(m, users.displayName, users.email, [users.phone])),
      ))
      .limit(limit) : [],
    want("internal") ? db
      .select({ id: internalContacts.id, name: internalContacts.name, email: internalContacts.email, phone: internalContacts.phone, cell: internalContacts.cellPhone, userId: internalContacts.userId, active: internalContacts.active })
      .from(internalContacts)
      .where(and(eq(internalContacts.organizationId, organizationId), filter("internal", internalContacts.id, (m) => matches(m, internalContacts.name, internalContacts.email, [internalContacts.phone, internalContacts.cellPhone]))))
      .limit(limit) : [],
    want("vendor_contact") ? db
      .select({ id: vendorContacts.id, name: vendorContacts.name, email: vendorContacts.email, phone: vendorContacts.phone, cell: vendorContacts.cellPhone, userId: vendorContacts.userId, vendorId: vendors.id, company: vendors.name, active: vendorContacts.active })
      .from(vendorContacts)
      .innerJoin(vendors, eq(vendors.id, vendorContacts.vendorId))
      .where(and(
        eq(vendors.organizationId, organizationId), isNull(vendors.mergedIntoVendorId), isNull(vendorContacts.mergedIntoPersonId),
        filter("vendor_contact", vendorContacts.id, (m) => and(eq(vendorContacts.active, true), matches(m, vendorContacts.name, vendorContacts.email, [vendorContacts.phone, vendorContacts.cellPhone])) ?? sql`0`),
      ))
      .limit(limit) : [],
    want("customer_contact") ? db
      .select({ id: customerContacts.id, name: customerContacts.name, email: customerContacts.email, phone: customerContacts.phone, cell: customerContacts.cellPhone, userId: customerContacts.userId, customerId: customers.id, company: sql<string>`COALESCE(NULLIF(trim(${customers.company}), ''), ${customers.name})`, active: customerContacts.active })
      .from(customerContacts)
      .innerJoin(customers, eq(customers.id, customerContacts.customerId))
      .where(and(
        eq(customers.organizationId, organizationId), isNull(customers.mergedIntoCustomerId), isNull(customerContacts.mergedIntoPersonId),
        filter("customer_contact", customerContacts.id, (m) => and(eq(customerContacts.active, true), matches(m, customerContacts.name, customerContacts.email, [customerContacts.phone, customerContacts.cellPhone])) ?? sql`0`),
      ))
      .limit(limit) : [],
    want("project_contact") ? withContactDirectory(db
      .select({ id: projectContacts.id, name: resolvedContactColumns.displayName, email: resolvedContactColumns.email, phone: resolvedContactColumns.phone, projectId: projectContacts.projectId, projectName: projects.name, contactType: projectContacts.contactType, sourceEntityType: projectContacts.sourceEntityType, sourceEntityId: projectContacts.sourceEntityId, active: projectContacts.active })
      .from(projectContacts)
      .innerJoin(projects, eq(projects.id, projectContacts.projectId))
      .where(and(
        eq(projects.organizationId, organizationId),
        // Only people not tied to a directory person (those are listed above).
        isNull(projectContacts.vendorContactId), isNull(projectContacts.customerContactId), isNull(projectContacts.internalContactId),
        ne(projectContacts.sourceEntityType, "user"),
        // Only this project's own contacts: an unlinked contact is never copied to another project.
        eq(projectContacts.projectId, projectId),
        filter("project_contact", projectContacts.id, (m) => and(eq(projectContacts.active, true), matches(m, resolvedContactColumns.displayName, resolvedContactColumns.email, [resolvedContactColumns.phone])) ?? sql`0`),
      ))
      .limit(limit).$dynamic(), organizationId) : [],
  ])

  const people: DirectoryPerson[] = []
  for (const row of staff) {
    if (!isInternalStaffRole(row.role)) continue
    people.push(person("user", row.id, { name: row.name, label: row.active ? "Staff" : "Archived staff", email: row.email, phone: row.phone, userId: row.id, active: row.active }))
  }
  for (const row of internal) {
    people.push(person("internal", row.id, { name: row.name, label: row.active ? "Staff" : "Archived staff", email: row.email, phone: row.phone ?? row.cell, userId: row.userId, active: row.active }))
  }
  for (const row of vendorPeople) {
    people.push(person("vendor_contact", row.id, { name: row.name, label: `Vendor: ${row.company}`, email: row.email, phone: row.phone ?? row.cell, userId: row.userId, vendorId: row.vendorId, active: row.active }))
  }
  for (const row of clientPeople) {
    people.push(person("customer_contact", row.id, { name: row.name, label: `Client: ${row.company}`, email: row.email, phone: row.phone ?? row.cell, userId: row.userId, customerId: row.customerId, active: row.active }))
  }
  // An unassigned person appears once per project they are on; list them once.
  const seenIdentity = new Set<string>()
  for (const row of projectPeople) {
    const unassigned = row.sourceEntityType === NEW_PERSON_SOURCE
    const identity = unassigned && row.sourceEntityId ? row.sourceEntityId : null
    if (identity && !only) {
      if (seenIdentity.has(identity)) continue
      seenIdentity.add(identity)
    }
    people.push(person("project_contact", row.id, {
      name: row.name, label: unassigned ? "Unassigned" : `Project contact: ${row.projectName}`, email: row.email, phone: row.phone,
      projectId: row.projectId, contactType: row.contactType, sourceEntityId: row.sourceEntityId, unassigned, active: row.active,
    }))
  }
  return people
}

/** Directory people whose name, email or phone contains the search (bounded). */
export async function searchDirectoryPeople(db: Db, organizationId: string, projectId: string, search: string): Promise<readonly DirectoryPerson[]> {
  const match = matcher(search, "contains")
  return match ? readPeople(db, organizationId, projectId, match, null) : []
}

/** People whose full name or email is exactly this text (case and spacing ignored): a suggestion only. */
export async function exactDirectoryPeople(db: Db, organizationId: string, projectId: string, text: string): Promise<readonly DirectoryPerson[]> {
  const match = matcher(text, "exact")
  return match ? readPeople(db, organizationId, projectId, match, null) : []
}

/** One person by reference, only within this organization. */
export async function findDirectoryPerson(db: Db, organizationId: string, projectId: string, ref: string): Promise<DirectoryPerson | null> {
  const parsed = parsePersonRef(ref)
  if (!parsed) return null
  const [found] = await readPeople(db, organizationId, projectId, null, parsed)
  return found ?? null
}
