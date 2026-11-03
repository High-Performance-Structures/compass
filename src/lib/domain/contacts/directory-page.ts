import { and, asc, count, desc, eq, isNull, ne, sql, type AnyColumn, type SQL } from "drizzle-orm"

import { customers, internalContacts, vendors, type Customer, type Vendor } from "@/db/schema"
import { containsPattern, phoneDigitsPattern, type RecordPage, type RecordPageQuery } from "@/lib/record-page"
import type { Db } from "@/lib/server/action-context"

/**
 * Server-side search, sort and paging for the Contacts directory. Each page
 * is one D1 query (the matching total rides along as a window count), and the
 * search reaches the company and its active people, so a vendor turns up by
 * its estimator's name, email or phone.
 */

export const VENDOR_SORT_IDS = ["name", "category", "email", "phone", "people"] as const
export const CUSTOMER_SORT_IDS = ["name", "email", "phone", "people", "relationshipType", "createdAt"] as const
export const INTERNAL_MERGE_BLOCKER = "Internal directory records cannot be merged here."
const MERGE_CANDIDATE_LIMIT = 20

export type VendorContactItem = {
  readonly id: string
  readonly vendorId: string
  readonly name: string
  readonly title: string | null
  readonly email: string | null
  readonly phone: string | null
  readonly isPrimary: boolean
  readonly active: boolean
  readonly sourceSystem: string
  readonly userId: string | null
  readonly sageContactId: string | null
  readonly sageLineNumber: number | null
}

export type VendorDirectoryCompany = Vendor & {
  readonly contacts: readonly VendorContactItem[]
}

export type VendorDirectoryRow = {
  readonly id: string
  readonly name: string
  readonly category: string
  readonly email: string | null
  readonly primaryEmail: string | null
  readonly phone: string | null
  readonly sourceSystem: string
  readonly syncStatus: string
  readonly peopleCount: number
  readonly primaryPersonName: string | null
}

export type CustomerDirectoryRow = Customer & {
  readonly peopleCount: number
}

export type CompanyMergeCandidate = {
  readonly id: string
  readonly name: string
  readonly email: string | null
  readonly detail: string | null
  /** Why this record cannot be merged here; null when it can. */
  readonly blockedReason: string | null
}

export type CompanyDirectoryKind = "vendor" | "customer"

// Correlated subqueries name the outer row explicitly: drizzle prints a bare
// "id" for single-table selects, which inside the subquery would mean p.id.
const vendorIdRef = sql.raw(`"vendors"."id"`)
const customerIdRef = sql.raw(`"customers"."id"`)

/** Strips spacing and punctuation from a stored phone so digits-only searches match. */
function digitsOf(column: AnyColumn | SQL): SQL {
  return sql`replace(replace(replace(replace(replace(replace(${column}, ' ', ''), '-', ''), '(', ''), ')', ''), '.', ''), '+', '')`
}

function like(column: AnyColumn | SQL, pattern: string): SQL {
  return sql`${column} like ${pattern} escape '\\'`
}

/** Matches the search against company fields and the company's active people. */
function vendorSearch(search: string): SQL | undefined {
  if (!search) return undefined
  const text = containsPattern(search)
  const digits = phoneDigitsPattern(search)
  const phone = digits
    ? sql` or ${like(digitsOf(vendors.phone), digits)} or ${like(digitsOf(sql`p.phone`), digits)} or ${like(digitsOf(sql`p.cell_phone`), digits)}`
    : sql``
  return sql`(${like(vendors.name, text)} or ${like(vendors.email, text)} or ${like(vendors.primaryEmail, text)} or ${like(vendors.phone, text)}
    or exists (select 1 from vendor_contacts p where p.vendor_id = ${vendorIdRef} and p.active = 1
      and (${like(sql`p.name`, text)} or ${like(sql`p.email`, text)} or ${like(sql`p.phone`, text)}${phone})))`
}

function customerSearch(search: string): SQL | undefined {
  if (!search) return undefined
  const text = containsPattern(search)
  const digits = phoneDigitsPattern(search)
  const phone = digits
    ? sql` or ${like(digitsOf(customers.phone), digits)} or ${like(digitsOf(sql`p.phone`), digits)} or ${like(digitsOf(sql`p.cell_phone`), digits)}`
    : sql``
  return sql`(${like(customers.name, text)} or ${like(customers.company, text)} or ${like(customers.email, text)}
    or ${like(customers.primaryEmail, text)} or ${like(customers.phone, text)}
    or exists (select 1 from customer_contacts p where p.customer_id = ${customerIdRef} and p.active = 1
      and (${like(sql`p.name`, text)} or ${like(sql`p.email`, text)} or ${like(sql`p.phone`, text)}${phone})))`
}

const notInternal = sql`lower(trim(${vendors.category})) <> 'internal'`

function vendorScope(organizationId: string, category: string | null, search: string): SQL | undefined {
  return and(
    eq(vendors.organizationId, organizationId),
    eq(vendors.directoryStatus, "active"),
    notInternal,
    category ? eq(vendors.category, category) : undefined,
    vendorSearch(search),
  )
}

function customerScope(organizationId: string, search: string): SQL | undefined {
  return and(eq(customers.organizationId, organizationId), isNull(customers.mergedIntoCustomerId), customerSearch(search))
}

/** Blank values sort last in both directions, then name breaks ties. */
function orderBy(expression: SQL | AnyColumn, descending: boolean, name: AnyColumn, id: AnyColumn): readonly SQL[] {
  return [
    sql`(${expression} is null or ${expression} = '')`,
    descending ? desc(expression) : asc(expression),
    sql`${name} collate nocase`,
    asc(id),
  ]
}

const vendorPeopleCount = sql<number>`(select count(*) from vendor_contacts p where p.vendor_id = ${vendorIdRef} and p.active = 1)`
const vendorPrimaryPerson = sql<string | null>`(select p.name from vendor_contacts p where p.vendor_id = ${vendorIdRef} and p.active = 1 order by p.is_primary desc, p.name collate nocase limit 1)`
const vendorEmail = sql<string | null>`coalesce(nullif(${vendors.primaryEmail}, ''), ${vendors.email})`

function vendorSortExpression(sortId: string | null): SQL | AnyColumn {
  if (sortId === "category") return vendors.category
  if (sortId === "email") return vendorEmail
  if (sortId === "phone") return vendors.phone
  if (sortId === "people") return vendorPeopleCount
  return sql`${vendors.name} collate nocase`
}

const customerPeopleCount = sql<number>`(select count(*) from customer_contacts p where p.customer_id = ${customerIdRef} and p.active = 1)`

function customerSortExpression(sortId: string | null): SQL | AnyColumn {
  if (sortId === "email") return sql`coalesce(nullif(${customers.primaryEmail}, ''), ${customers.email})`
  if (sortId === "phone") return customers.phone
  if (sortId === "people") return customerPeopleCount
  if (sortId === "relationshipType") return customers.relationshipType
  if (sortId === "createdAt") return customers.createdAt
  return sql`${customers.name} collate nocase`
}

const windowTotal = sql<number>`count(*) over ()`

export async function listVendorDirectoryPage(
  db: Db,
  organizationId: string,
  query: RecordPageQuery,
  category: string | null,
): Promise<RecordPage<VendorDirectoryRow>> {
  const where = vendorScope(organizationId, category, query.search)
  const rows = await db
    .select({
      id: vendors.id,
      name: vendors.name,
      category: vendors.category,
      email: vendors.email,
      primaryEmail: vendors.primaryEmail,
      phone: vendors.phone,
      sourceSystem: vendors.sourceSystem,
      syncStatus: vendors.syncStatus,
      peopleCount: vendorPeopleCount,
      primaryPersonName: vendorPrimaryPerson,
      total: windowTotal,
    })
    .from(vendors)
    .where(where)
    .orderBy(...orderBy(vendorSortExpression(query.sortId), query.sortDesc, vendors.name, vendors.id))
    .limit(query.pageSize)
    .offset(query.pageIndex * query.pageSize)
  const total = rows[0]?.total ?? (query.pageIndex > 0 ? await countVendors(db, where) : 0)
  return {
    rows: rows.map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category,
      email: row.email,
      primaryEmail: row.primaryEmail,
      phone: row.phone,
      sourceSystem: row.sourceSystem,
      syncStatus: row.syncStatus,
      peopleCount: Number(row.peopleCount),
      primaryPersonName: row.primaryPersonName,
    })),
    total: Number(total),
  }
}

export async function listCustomerDirectoryPage(
  db: Db,
  organizationId: string,
  query: RecordPageQuery,
): Promise<RecordPage<CustomerDirectoryRow>> {
  const where = customerScope(organizationId, query.search)
  const rows = await db
    .select({
      customer: customers,
      peopleCount: customerPeopleCount,
      total: windowTotal,
    })
    .from(customers)
    .where(where)
    .orderBy(...orderBy(customerSortExpression(query.sortId), query.sortDesc, customers.name, customers.id))
    .limit(query.pageSize)
    .offset(query.pageIndex * query.pageSize)
  const total = rows[0]?.total ?? (query.pageIndex > 0 ? await countCustomers(db, where) : 0)
  return { rows: rows.map((row) => ({ ...row.customer, peopleCount: Number(row.peopleCount) })), total: Number(total) }
}

async function countVendors(db: Db, where: SQL | undefined): Promise<number> {
  const row = await db.select({ value: count() }).from(vendors).where(where).get()
  return row?.value ?? 0
}

async function countCustomers(db: Db, where: SQL | undefined): Promise<number> {
  const row = await db.select({ value: count() }).from(customers).where(where).get()
  return row?.value ?? 0
}

export type DirectorySummary = {
  readonly customerCount: number
  readonly vendorCount: number
  readonly internalCount: number
  readonly vendorCategories: readonly string[]
}

/** Tab counts and the vendor categories in use, read in one D1 round trip. */
export async function loadDirectorySummary(
  db: Db,
  organizationId: string,
  grants: { readonly customers: boolean; readonly vendors: boolean; readonly internal: boolean },
): Promise<DirectorySummary> {
  const [customerRows, vendorRows, internalRows, categoryRows] = await db.batch([
    db.select({ value: count() }).from(customers)
      .where(and(eq(customers.organizationId, organizationId), isNull(customers.mergedIntoCustomerId))),
    db.select({ value: count() }).from(vendors)
      .where(and(eq(vendors.organizationId, organizationId), eq(vendors.directoryStatus, "active"), notInternal)),
    db.select({ value: count() }).from(internalContacts)
      .where(and(eq(internalContacts.organizationId, organizationId), eq(internalContacts.active, true))),
    db.selectDistinct({ category: vendors.category }).from(vendors)
      .where(and(eq(vendors.organizationId, organizationId), eq(vendors.directoryStatus, "active"), notInternal)),
  ])
  return {
    customerCount: grants.customers ? customerRows[0]?.value ?? 0 : 0,
    vendorCount: grants.vendors ? vendorRows[0]?.value ?? 0 : 0,
    internalCount: grants.internal ? internalRows[0]?.value ?? 0 : 0,
    vendorCategories: grants.vendors
      ? categoryRows.map((row) => row.category.trim()).filter((category) => category.length > 0)
      : [],
  }
}

/**
 * Companies to merge with `excludeId`, found by the same search as the list.
 * Internal vendors are returned with the reason they cannot be merged, so a
 * search never hides them silently.
 */
export async function searchCompanyMergeCandidates(
  db: Db,
  organizationId: string,
  input: { readonly kind: CompanyDirectoryKind; readonly search: string; readonly excludeId: string },
): Promise<readonly CompanyMergeCandidate[]> {
  if (!input.search) return []
  if (input.kind === "vendor") {
    const rows = await db
      .select({ id: vendors.id, name: vendors.name, email: vendorEmail, category: vendors.category })
      .from(vendors)
      .where(and(
        eq(vendors.organizationId, organizationId),
        eq(vendors.directoryStatus, "active"),
        ne(vendors.id, input.excludeId),
        vendorSearch(input.search),
      ))
      .orderBy(sql`${vendors.name} collate nocase`, asc(vendors.id))
      .limit(MERGE_CANDIDATE_LIMIT)
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      detail: row.category,
      blockedReason: row.category.trim().toLowerCase() === "internal" ? INTERNAL_MERGE_BLOCKER : null,
    }))
  }
  const rows = await db
    .select({ id: customers.id, name: customers.name, email: customers.email, company: customers.company, relationshipType: customers.relationshipType })
    .from(customers)
    .where(and(
      eq(customers.organizationId, organizationId),
      isNull(customers.mergedIntoCustomerId),
      ne(customers.id, input.excludeId),
      customerSearch(input.search),
    ))
    .orderBy(sql`${customers.name} collate nocase`, asc(customers.id))
    .limit(MERGE_CANDIDATE_LIMIT)
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    detail: [row.relationshipType === "lead" ? "Lead" : "Client", row.company].filter(Boolean).join(" · "),
    blockedReason: null,
  }))
}
