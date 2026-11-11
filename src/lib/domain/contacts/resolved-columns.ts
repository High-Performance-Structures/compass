/**
 * The read model's directory-owned columns: a project contact linked to a
 * directory record reads its email, phone, address and names from that
 * record. The copied columns on project_contacts are a history snapshot and
 * only answer for an unlinked row or one whose record is no longer reachable
 * (archived person, another organization, a user who left the company).
 *
 * Two ways to use it, both with the same rules:
 * - joins: `withContactDirectory(query)` adds the directory left joins to a
 *   dynamic select that reads project_contacts, then select, filter and order
 *   on `resolvedContactColumns` (displayName, companyName, email, phone,
 *   address).
 * - correlated: `resolvedContactValueOf(field)` is a scalar subquery for SQL
 *   that cannot add joins (shared WHERE fragments, correlated EXISTS).
 *
 * The directory tables are joined under their own aliases (`dir_*`), so a
 * query may also join `customers`, `vendors` or `users` for its own reasons.
 *
 * Merges: a project contact whose client, vendor or person was merged into
 * another reads the surviving record. The record the row names is joined as
 * `*_linked_*`, and the directory record is that one or, when it carries a
 * merge pointer, the record it was merged into (one hop: merges re-point
 * earlier duplicates to the survivor and refuse a merged survivor). A
 * merged survivor, or a vendor that is not active (excluded without a
 * survivor), is not reachable, so the row falls back to its copy.
 */
import { getTableName, sql, type SQL } from "drizzle-orm"
import { alias, type AnySQLiteColumn, type SQLiteSelect, type SQLiteTable } from "drizzle-orm/sqlite-core"

import { customerContacts, customers, internalContacts, organizationMembers, projectContacts, projects, users, vendorContacts, vendors } from "@/db/schema"

/** A column of the table or of one of its aliases. */
type Ref = AnySQLiteColumn
type Refs<K extends string> = { readonly [P in K]: Ref }

type ContactRefs = Refs<
  | "id"
  | "projectId"
  | "contactType"
  | "customerId"
  | "customerContactId"
  | "vendorId"
  | "vendorContactId"
  | "internalContactId"
  | "sourceEntityType"
  | "sourceEntityId"
  | "displayName"
  | "companyName"
  | "email"
  | "phone"
  | "address"
>

type DirectoryRefs = {
  readonly linkedCustomers: Refs<"id" | "organizationId" | "mergedIntoCustomerId">
  readonly customers: Refs<"id" | "organizationId" | "mergedIntoCustomerId" | "name" | "company" | "email" | "phone" | "address">
  readonly linkedCustomerContacts: Refs<"id" | "mergedIntoPersonId">
  readonly customerContacts: Refs<"id" | "customerId" | "active" | "name" | "email" | "phone">
  readonly linkedVendors: Refs<"id" | "organizationId" | "mergedIntoVendorId">
  readonly vendors: Refs<"id" | "organizationId" | "mergedIntoVendorId" | "directoryStatus" | "name" | "email" | "phone" | "address">
  readonly linkedVendorContacts: Refs<"id" | "mergedIntoPersonId">
  readonly vendorContacts: Refs<"id" | "vendorId" | "active" | "name" | "email" | "phone">
  readonly internalContacts: Refs<"id" | "organizationId" | "active" | "name" | "email" | "phone">
  readonly users: Refs<"id" | "email" | "phone">
}

/** The record a row names (`linked*`) and the directory record it reads (itself, or its merge survivor). */
const DIRECTORY_SOURCES = {
  linkedCustomers: customers,
  customers,
  linkedCustomerContacts: customerContacts,
  customerContacts,
  linkedVendors: vendors,
  vendors,
  linkedVendorContacts: vendorContacts,
  vendorContacts,
  internalContacts,
  users,
} as const

type DirectoryKey = keyof typeof DIRECTORY_SOURCES

/** Join order: a survivor joins after the record it follows, and a person after its company (its ON reads them). */
const JOIN_ORDER: readonly DirectoryKey[] = [
  "linkedCustomers", "customers", "linkedCustomerContacts", "customerContacts",
  "linkedVendors", "vendors", "linkedVendorContacts", "vendorContacts", "users", "internalContacts",
]

function aliasName(prefix: string, key: DirectoryKey): string {
  const table = getTableName(DIRECTORY_SOURCES[key])
  return key.startsWith("linked") ? `${prefix}_linked_${table}` : `${prefix}_${table}`
}

function trimmed(column: Ref): SQL {
  return sql`nullif(trim(${column}), '')`
}

type ResolvedColumns = {
  readonly displayName: SQL<string>
  readonly companyName: SQL<string | null>
  readonly email: SQL<string | null>
  readonly phone: SQL<string | null>
  readonly address: SQL<string | null>
}

type DirectoryValue = { readonly [K in "customerContact" | "vendorContact" | "customer" | "vendor" | "internal" | "user"]: SQL | null }

/** The resolved column expressions over one project-contact row and its directory joins. */
function buildResolvedColumns(pc: ContactRefs, dir: DirectoryRefs): ResolvedColumns {
  /**
   * The linked record, in the order the project contact names it. When that
   * record is reachable its value wins, blank included (a linked record owns
   * its blanks). Only an unlinked contact, or one whose record is no longer
   * reachable, falls back to the copied column.
   */
  const linkedValue = (value: DirectoryValue, copy: SQL): SQL => {
    const pick = (present: Ref, field: SQL | null): SQL => sql`case when ${present} is not null then ${field ?? sql`null`} else ${copy} end`
    return sql`case
    when ${pc.customerContactId} is not null then ${pick(dir.customerContacts.id, value.customerContact)}
    when ${pc.vendorContactId} is not null then ${pick(dir.vendorContacts.id, value.vendorContact)}
    when ${pc.customerId} is not null or ${pc.sourceEntityType} = 'customer' then ${pick(dir.customers.id, value.customer)}
    when ${pc.vendorId} is not null or ${pc.sourceEntityType} = 'vendor' then ${pick(dir.vendors.id, value.vendor)}
    when ${pc.internalContactId} is not null then ${pick(dir.internalContacts.id, value.internal)}
    when ${pc.sourceEntityType} = 'user' then ${pick(dir.users.id, value.user)}
    else ${copy}
  end`
  }

  const email = linkedValue(
    {
      customerContact: trimmed(dir.customerContacts.email),
      vendorContact: trimmed(dir.vendorContacts.email),
      customer: trimmed(dir.customers.email),
      vendor: trimmed(dir.vendors.email),
      internal: trimmed(dir.internalContacts.email),
      user: trimmed(dir.users.email),
    },
    trimmed(pc.email)
  )

  const phone = linkedValue(
    {
      customerContact: trimmed(dir.customerContacts.phone),
      vendorContact: trimmed(dir.vendorContacts.phone),
      customer: trimmed(dir.customers.phone),
      vendor: trimmed(dir.vendors.phone),
      internal: trimmed(dir.internalContacts.phone),
      user: trimmed(dir.users.phone),
    },
    trimmed(pc.phone)
  )

  // People records carry no address: a client person uses the client's, and
  // vendor people, staff and Compass users have none on a project.
  const address = sql`case when ${pc.contactType} = 'internal' then null else ${linkedValue(
    {
      customerContact: trimmed(dir.customers.address),
      vendorContact: null,
      customer: trimmed(dir.customers.address),
      vendor: trimmed(dir.vendors.address),
      internal: null,
      user: null,
    },
    trimmed(pc.address)
  )} end`

  const displayName = sql`case
  when ${pc.contactType} = 'internal' and ${dir.internalContacts.id} is not null then ${dir.internalContacts.name}
  when ${pc.customerContactId} is not null then coalesce(${dir.customerContacts.name}, ${pc.displayName})
  when ${pc.vendorContactId} is not null then coalesce(${dir.vendorContacts.name}, ${pc.displayName})
  when ${dir.vendors.id} is not null then ${dir.vendors.name}
  when ${dir.customers.id} is not null then ${dir.customers.name}
  when ${dir.internalContacts.id} is not null then ${dir.internalContacts.name}
  else ${pc.displayName}
end`

  const companyName = sql`coalesce(${dir.vendors.name}, ${dir.customers.company}, ${pc.companyName})`

  return {
    displayName: sql<string>`${displayName}`,
    companyName: sql<string | null>`${companyName}`,
    email: sql<string | null>`${email}`,
    phone: sql<string | null>`${phone}`,
    address: sql<string | null>`${address}`,
  }
}

/** The project's own organization (correlated with the project-contact row). */
function projectOrganization(pc: ContactRefs): SQL {
  return sql`(select ${projects.organizationId} from ${projects} where ${projects.id} = ${pc.projectId})`
}

/**
 * The directory join conditions. Records outside the organization, archived
 * people (inactive customer/vendor/internal contacts), merged or inactive
 * companies and users who are not members do not match, so the row falls
 * back to its copy. A merged record is followed one hop to its survivor.
 */
function joinConditions(pc: ContactRefs, dir: DirectoryRefs, organization: SQL): Readonly<Record<DirectoryKey, SQL>> {
  return {
    linkedCustomers: sql`(${pc.customerId} = ${dir.linkedCustomers.id} or (${pc.sourceEntityType} = 'customer' and ${pc.sourceEntityId} = ${dir.linkedCustomers.id}))
      and ${dir.linkedCustomers.organizationId} = ${organization}`,
    customers: sql`${dir.customers.id} = coalesce(${dir.linkedCustomers.mergedIntoCustomerId}, ${dir.linkedCustomers.id})
      and ${dir.customers.organizationId} = ${organization} and ${dir.customers.mergedIntoCustomerId} is null`,
    linkedCustomerContacts: sql`${pc.customerContactId} = ${dir.linkedCustomerContacts.id}`,
    customerContacts: sql`${dir.customerContacts.id} = coalesce(${dir.linkedCustomerContacts.mergedIntoPersonId}, ${dir.linkedCustomerContacts.id})
      and ${dir.customerContacts.customerId} = ${dir.customers.id} and ${dir.customerContacts.active} = 1`,
    linkedVendors: sql`(${pc.vendorId} = ${dir.linkedVendors.id} or (${pc.sourceEntityType} = 'vendor' and ${pc.sourceEntityId} = ${dir.linkedVendors.id}))
      and ${dir.linkedVendors.organizationId} = ${organization}`,
    vendors: sql`${dir.vendors.id} = coalesce(${dir.linkedVendors.mergedIntoVendorId}, ${dir.linkedVendors.id})
      and ${dir.vendors.organizationId} = ${organization} and ${dir.vendors.mergedIntoVendorId} is null and ${dir.vendors.directoryStatus} = 'active'`,
    linkedVendorContacts: sql`${pc.vendorContactId} = ${dir.linkedVendorContacts.id}`,
    vendorContacts: sql`${dir.vendorContacts.id} = coalesce(${dir.linkedVendorContacts.mergedIntoPersonId}, ${dir.linkedVendorContacts.id})
      and ${dir.vendorContacts.vendorId} = ${dir.vendors.id} and ${dir.vendorContacts.active} = 1`,
    users: sql`${pc.sourceEntityType} = 'user' and ${pc.sourceEntityId} = ${dir.users.id}
      and exists (select 1 from ${organizationMembers} where ${organizationMembers.userId} = ${dir.users.id} and ${organizationMembers.organizationId} = ${organization})`,
    internalContacts: sql`${pc.internalContactId} = ${dir.internalContacts.id}
      and ${dir.internalContacts.organizationId} = ${organization} and ${dir.internalContacts.active} = 1`,
  }
}

// ---- join form ------------------------------------------------------------

const JOINED_TABLES = {
  linkedCustomers: alias(customers, aliasName("dir", "linkedCustomers")),
  customers: alias(customers, aliasName("dir", "customers")),
  linkedCustomerContacts: alias(customerContacts, aliasName("dir", "linkedCustomerContacts")),
  customerContacts: alias(customerContacts, aliasName("dir", "customerContacts")),
  linkedVendors: alias(vendors, aliasName("dir", "linkedVendors")),
  vendors: alias(vendors, aliasName("dir", "vendors")),
  linkedVendorContacts: alias(vendorContacts, aliasName("dir", "linkedVendorContacts")),
  vendorContacts: alias(vendorContacts, aliasName("dir", "vendorContacts")),
  internalContacts: alias(internalContacts, aliasName("dir", "internalContacts")),
  users: alias(users, aliasName("dir", "users")),
} as const satisfies Record<DirectoryKey, SQLiteTable>

/**
 * Resolved columns for a query that joined the directory with
 * `withContactDirectory`. Select them, filter on them and order by them in
 * place of the copied project_contacts columns.
 */
export const resolvedContactColumns: ResolvedColumns = buildResolvedColumns(projectContacts, JOINED_TABLES)

/**
 * Add the directory left joins to a dynamic select that reads
 * project_contacts (as its FROM table or a join). Pass the organization when
 * the caller knows it; otherwise the joins are scoped to the project's own
 * organization. Ten left joins on primary keys (the named record, then its survivor), each matching at most one
 * row: no unions, no fan-out.
 */
export function withContactDirectory<T extends SQLiteSelect>(query: T, organizationId?: string): T {
  const organization = organizationId === undefined ? projectOrganization(projectContacts) : sql`${organizationId}`
  const on = joinConditions(projectContacts, JOINED_TABLES, organization)
  // A dynamic select adds each join to itself (drizzle mutates the builder
  // and returns it), so the caller's builder and its result type carry on
  // unchanged. Use a partial select (explicit fields): then joins never add
  // directory columns to the result.
  for (const key of JOIN_ORDER) query.leftJoin(JOINED_TABLES[key], on[key])
  return query
}

// ---- correlated form ------------------------------------------------------

const CORRELATED_PREFIX = "rdir"
const CORRELATED_CONTACT = alias(projectContacts, `${CORRELATED_PREFIX}_project_contact`)
const CORRELATED_TABLES = {
  linkedCustomers: alias(customers, aliasName(CORRELATED_PREFIX, "linkedCustomers")),
  customers: alias(customers, aliasName(CORRELATED_PREFIX, "customers")),
  linkedCustomerContacts: alias(customerContacts, aliasName(CORRELATED_PREFIX, "linkedCustomerContacts")),
  customerContacts: alias(customerContacts, aliasName(CORRELATED_PREFIX, "customerContacts")),
  linkedVendors: alias(vendors, aliasName(CORRELATED_PREFIX, "linkedVendors")),
  vendors: alias(vendors, aliasName(CORRELATED_PREFIX, "vendors")),
  linkedVendorContacts: alias(vendorContacts, aliasName(CORRELATED_PREFIX, "linkedVendorContacts")),
  vendorContacts: alias(vendorContacts, aliasName(CORRELATED_PREFIX, "vendorContacts")),
  internalContacts: alias(internalContacts, aliasName(CORRELATED_PREFIX, "internalContacts")),
  users: alias(users, aliasName(CORRELATED_PREFIX, "users")),
} as const satisfies Record<DirectoryKey, SQLiteTable>

/** `"table" "alias"`: in raw SQL an aliased table renders as its alias only. */
function aliasedTable(source: SQLiteTable, aliased: SQLiteTable): SQL {
  return sql`${sql.identifier(getTableName(source))} ${aliased}`
}

/**
 * One resolved value of a project contact as a correlated scalar subquery,
 * for SQL fragments that cannot add joins. Same rules as the join form,
 * scoped to the project's organization. By default it reads the outer
 * query's project_contacts row (read under its own name, not an alias); pass
 * `contactId` to read another row, e.g. the id column of a raw SQL alias.
 */
export function resolvedContactValueOf(field: keyof ResolvedColumns, contactId: SQL | AnySQLiteColumn = projectContacts.id): SQL<string | null> {
  const pc = CORRELATED_CONTACT
  const on = joinConditions(pc, CORRELATED_TABLES, projectOrganization(pc))
  const joins = sql.join(
    JOIN_ORDER.map((key) => sql`left join ${aliasedTable(DIRECTORY_SOURCES[key], CORRELATED_TABLES[key])} on ${on[key]}`),
    sql` `
  )
  const subquery = sql`(select ${buildResolvedColumns(pc, CORRELATED_TABLES)[field]}
    from ${aliasedTable(projectContacts, pc)} ${joins}
    where ${pc.id} = ${contactId})`
  // Nested once: drizzle strips table names from top-level column chunks of a
  // single-table select's fields, which would make this subquery ambiguous.
  return sql<string | null>`${subquery}`
}

/**
 * True when the outer query's project_contacts row names a directory record
 * that is reachable under the same rules as the joins; then its copied
 * columns are history only. False for an unlinked row, or one whose record is
 * archived or in another organization. A CASE of primary-key EXISTS checks:
 * cheap enough for per-row WHERE clauses (where the full value subquery
 * would be evaluated once per scanned row).
 */
export function contactDirectoryRecordReachable(): SQL {
  const pc = projectContacts
  const dir = CORRELATED_TABLES
  const on = joinConditions(pc, dir, projectOrganization(pc))
  const reachable = (...keys: readonly DirectoryKey[]): SQL => {
    const tables = sql.join(keys.map((key) => aliasedTable(DIRECTORY_SOURCES[key], dir[key])), sql`, `)
    const conditions = sql.join(keys.map((key) => sql`(${on[key]})`), sql` and `)
    return sql`exists (select 1 from ${tables} where ${conditions})`
  }
  const condition = sql`(case
    when ${pc.customerContactId} is not null then ${reachable("linkedCustomers", "customers", "linkedCustomerContacts", "customerContacts")}
    when ${pc.vendorContactId} is not null then ${reachable("linkedVendors", "vendors", "linkedVendorContacts", "vendorContacts")}
    when ${pc.customerId} is not null or ${pc.sourceEntityType} = 'customer' then ${reachable("linkedCustomers", "customers")}
    when ${pc.vendorId} is not null or ${pc.sourceEntityType} = 'vendor' then ${reachable("linkedVendors", "vendors")}
    when ${pc.internalContactId} is not null then ${reachable("internalContacts")}
    when ${pc.sourceEntityType} = 'user' then ${reachable("users")}
    else 0
  end) = 1`
  return sql`${condition}`
}
