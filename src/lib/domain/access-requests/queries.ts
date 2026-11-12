/**
 * Reads for access requests: the companies a person can ask to join, the
 * person's own requests, a company's requests for its admins, and the
 * directory people an admin can link a request to. Every read is scoped in
 * SQL to one person or one company.
 */
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/sqlite-core"

import { organizationAccessRequests } from "@/db/schema-access-requests"
import {
  customerContacts,
  customers,
  organizationFeatureSettings,
  organizationMembers,
  organizations,
  users,
  vendorContacts,
  vendors,
} from "@/db/schema"
import { isDemoOrg } from "@/lib/demo"
import { ADMIN_USER_ROLES } from "@/lib/domain/identity/statuses"
import type { Db } from "@/lib/server/action-context"

import { CLIENT_RECORD_OPTION_PREFIX, isRequestableOrganization, VENDOR_COMPANY_OPTION_PREFIX } from "./rules"
import type { AccessRequestKind, AccessRequestStatus } from "./statuses"

/** The feature settings key for Settings > People > Access requests. */
const ACCESS_REQUEST_SETTINGS_KEY = "access-requests"

export type RequestableOrganization = {
  readonly id: string
  readonly name: string
  /** Other names the company is known by (Settings > People > Access requests). */
  readonly alsoKnownAs: readonly string[]
}

/** The stored also-known-as list, read as JSON text; anything malformed reads as none. */
function storedNames(raw: string | null): readonly string[] {
  if (!raw) return []
  try {
    const value: unknown = JSON.parse(raw)
    return Array.isArray(value) ? value.filter((name): name is string => typeof name === "string" && name.trim() !== "") : []
  } catch {
    return []
  }
}

/**
 * Companies that allow access requests, read in SQL from their stored
 * setting. Only the few companies with the setting saved are read.
 */
async function organizationsAllowingRequests(db: Db, organizationIds?: readonly string[]): Promise<readonly RequestableOrganization[]> {
  const rows = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      type: organizations.type,
      isActive: organizations.isActive,
      allowRequests: sql<number | null>`json_extract(${organizationFeatureSettings.value}, '$.allowRequests')`,
      alsoKnownAs: sql<string | null>`json_extract(${organizationFeatureSettings.value}, '$.alsoKnownAs')`,
    })
    .from(organizationFeatureSettings)
    .innerJoin(organizations, eq(organizations.id, organizationFeatureSettings.organizationId))
    .where(and(
      eq(organizationFeatureSettings.featureKey, ACCESS_REQUEST_SETTINGS_KEY),
      organizationIds ? inArray(organizations.id, [...organizationIds]) : undefined,
    ))
  return rows
    .filter((row) => !isDemoOrg(row.id) && isRequestableOrganization({ type: row.type, isActive: row.isActive, allowRequests: row.allowRequests === 1 }))
    .map((row) => ({ id: row.id, name: row.name, alsoKnownAs: storedNames(row.alsoKnownAs) }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Companies this person can ask to join: they allow requests and the person isn't a member yet. */
export async function requestableOrganizationsFor(db: Db, userId: string): Promise<readonly RequestableOrganization[]> {
  const [open, memberships] = await Promise.all([
    organizationsAllowingRequests(db),
    db.select({ organizationId: organizationMembers.organizationId }).from(organizationMembers).where(eq(organizationMembers.userId, userId)),
  ])
  const member = new Set(memberships.map((row) => row.organizationId))
  return open.filter((org) => !member.has(org.id))
}

/** One company, when it currently allows requests. */
export async function requestableOrganization(db: Db, organizationId: string): Promise<RequestableOrganization | null> {
  const [org] = await organizationsAllowingRequests(db, [organizationId])
  return org ?? null
}

export async function isOrganizationMember(db: Db, organizationId: string, userId: string): Promise<boolean> {
  const row = await db
    .select({ id: organizationMembers.id })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, userId)))
    .get()
  return row !== undefined
}

/** True when the person belongs to a company (not only their own personal workspace). */
export async function hasCompanyMembership(db: Db, userId: string): Promise<boolean> {
  const row = await db
    .select({ id: organizationMembers.id })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(and(eq(organizationMembers.userId, userId), sql`${organizations.type} <> 'personal'`))
    .get()
  return row !== undefined
}

export type MyAccessRequest = {
  readonly id: string
  readonly organizationId: string
  readonly organizationName: string
  readonly kind: AccessRequestKind
  readonly status: AccessRequestStatus
  readonly createdAt: string
  readonly decidedAt: string | null
  /** Approved and still a member: they can open the company. */
  readonly canOpen: boolean
}

/** The person's own requests, newest first. */
export async function myAccessRequests(db: Db, userId: string): Promise<readonly MyAccessRequest[]> {
  const rows = await db
    .select({
      id: organizationAccessRequests.id,
      organizationId: organizationAccessRequests.organizationId,
      organizationName: organizations.name,
      kind: organizationAccessRequests.kind,
      status: organizationAccessRequests.status,
      createdAt: organizationAccessRequests.createdAt,
      decidedAt: organizationAccessRequests.decidedAt,
      memberId: organizationMembers.id,
    })
    .from(organizationAccessRequests)
    .innerJoin(organizations, eq(organizations.id, organizationAccessRequests.organizationId))
    .leftJoin(organizationMembers, and(
      eq(organizationMembers.organizationId, organizationAccessRequests.organizationId),
      eq(organizationMembers.userId, organizationAccessRequests.userId),
    ))
    .where(eq(organizationAccessRequests.userId, userId))
    .orderBy(desc(organizationAccessRequests.createdAt))
    .limit(50)
  return rows.map(({ memberId, ...row }) => ({ ...row, canOpen: row.status === "approved" && memberId !== null }))
}

export type CompanyAccessRequest = {
  readonly id: string
  readonly kind: AccessRequestKind
  readonly status: AccessRequestStatus
  readonly requesterUserId: string
  readonly requesterName: string
  readonly requesterEmail: string
  readonly companyName: string | null
  readonly phone: string | null
  readonly jobReference: string | null
  readonly note: string | null
  readonly createdAt: string
  readonly decidedAt: string | null
  readonly decidedByName: string | null
  readonly grantedRole: string | null
  readonly grantedProjectCount: number | null
  /** The directory person an approval linked, as "Name (Company)". */
  readonly linkedPerson: string | null
}

const decider = alias(users, "access_request_decider")

/** One company's requests for its admins: pending first, then the latest decisions. */
export async function companyAccessRequests(db: Db, organizationId: string): Promise<readonly CompanyAccessRequest[]> {
  const rows = await db
    .select({
      id: organizationAccessRequests.id,
      kind: organizationAccessRequests.kind,
      status: organizationAccessRequests.status,
      requesterUserId: organizationAccessRequests.userId,
      displayName: users.displayName,
      firstName: users.firstName,
      lastName: users.lastName,
      requesterEmail: users.email,
      companyName: organizationAccessRequests.companyName,
      phone: organizationAccessRequests.phone,
      jobReference: organizationAccessRequests.jobReference,
      note: organizationAccessRequests.note,
      createdAt: organizationAccessRequests.createdAt,
      decidedAt: organizationAccessRequests.decidedAt,
      decidedByName: sql<string | null>`COALESCE(${decider.displayName}, ${decider.email})`,
      grantedRole: organizationAccessRequests.grantedRole,
      grantedProjectCount: organizationAccessRequests.grantedProjectCount,
      clientPerson: sql<string | null>`CASE WHEN ${customerContacts.id} IS NULL THEN NULL ELSE ${customerContacts.name} || ' (' || COALESCE(NULLIF(trim(${customers.company}), ''), ${customers.name}) || ')' END`,
      vendorPerson: sql<string | null>`CASE WHEN ${vendorContacts.id} IS NULL THEN NULL ELSE ${vendorContacts.name} || ' (' || ${vendors.name} || ')' END`,
    })
    .from(organizationAccessRequests)
    .innerJoin(users, eq(users.id, organizationAccessRequests.userId))
    .leftJoin(decider, eq(decider.id, organizationAccessRequests.decidedBy))
    .leftJoin(customerContacts, eq(customerContacts.id, organizationAccessRequests.customerContactId))
    .leftJoin(customers, eq(customers.id, customerContacts.customerId))
    .leftJoin(vendorContacts, eq(vendorContacts.id, organizationAccessRequests.vendorContactId))
    .leftJoin(vendors, eq(vendors.id, vendorContacts.vendorId))
    .where(eq(organizationAccessRequests.organizationId, organizationId))
    .orderBy(sql`CASE WHEN ${organizationAccessRequests.status} = 'pending' THEN 0 ELSE 1 END`, desc(organizationAccessRequests.createdAt))
    .limit(200)
  return rows.map(({ displayName, firstName, lastName, clientPerson, vendorPerson, ...row }) => ({
    ...row,
    requesterName: displayName?.trim() || [firstName, lastName].filter(Boolean).join(" ").trim() || row.requesterEmail,
    linkedPerson: clientPerson ?? vendorPerson,
  }))
}

/** One request, only within this company. */
export async function companyAccessRequest(db: Db, organizationId: string, requestId: string) {
  return db
    .select({
      request: organizationAccessRequests,
      requesterEmail: users.email,
      requesterName: sql<string>`COALESCE(NULLIF(trim(${users.displayName}), ''), trim(COALESCE(${users.firstName}, '') || ' ' || COALESCE(${users.lastName}, '')), ${users.email})`,
      requesterFirstName: users.firstName,
      requesterActive: users.isActive,
      organizationName: organizations.name,
    })
    .from(organizationAccessRequests)
    .innerJoin(users, eq(users.id, organizationAccessRequests.userId))
    .innerJoin(organizations, eq(organizations.id, organizationAccessRequests.organizationId))
    .where(and(eq(organizationAccessRequests.id, requestId), eq(organizationAccessRequests.organizationId, organizationId)))
    .get()
}

export type AccessRequestDirectoryOption = {
  readonly id: string
  readonly name: string
  /** "Client: Smith" or "Vendor: Acme". */
  readonly label: string
  readonly email: string | null
  /** Already linked to a different Compass login; it can't be linked to this request. */
  readonly linkedElsewhere: boolean
}


/**
 * Client people (for a client request) or vendor people (for a vendor
 * request) whose name, email or phone contains the search, through the
 * shared bounded directory search. No project is given, so a job's own
 * unlinked contacts are never offered.
 */
const DIRECTORY_LIST_LIMIT = 400

/**
 * Everyone this request could be, for the review dropdown: for a client
 * request every client person and client record, for a vendor request every
 * vendor person and vendor company, optionally narrowed by a search on name,
 * company or email. People whose email is exactly the requester's come
 * first as suggestions; nothing is linked until the admin picks one.
 * Picking a client record or vendor company adds that person to it on
 * approval (see the service). A job's own unlinked contacts are never offered.
 */
export async function listAccessRequestDirectory(
  db: Db,
  input: {
    readonly organizationId: string
    readonly kind: AccessRequestKind
    readonly requesterUserId: string
    readonly requesterEmail: string
    readonly search: string
  },
): Promise<readonly AccessRequestDirectoryOption[]> {
  if (input.kind === "employee") return []
  const text = input.search.trim().toLowerCase()
  const like = `%${text}%`
  const email = input.requesterEmail.trim().toLowerCase()
  const linkedElsewhere = (userId: string | null): boolean => userId !== null && userId !== input.requesterUserId
  const options: AccessRequestDirectoryOption[] = []
  if (input.kind === "client") {
    const people = await db
      .select({ id: customerContacts.id, name: customerContacts.name, email: customerContacts.email, userId: customerContacts.userId, company: sql<string>`COALESCE(NULLIF(trim(${customers.company}), ''), ${customers.name})` })
      .from(customerContacts)
      .innerJoin(customers, eq(customers.id, customerContacts.customerId))
      .where(and(
        eq(customers.organizationId, input.organizationId),
        isNull(customers.mergedIntoCustomerId),
        isNull(customerContacts.mergedIntoPersonId),
        eq(customerContacts.active, true),
        text ? sql`(lower(${customerContacts.name}) LIKE ${like} OR lower(COALESCE(${customerContacts.email}, '')) LIKE ${like} OR lower(${customers.name}) LIKE ${like} OR lower(COALESCE(${customers.company}, '')) LIKE ${like})` : undefined,
      ))
      .orderBy(customerContacts.name)
      .limit(DIRECTORY_LIST_LIMIT)
    for (const row of people) options.push({ id: row.id, name: row.name, label: `Person at ${row.company}`, email: row.email, linkedElsewhere: linkedElsewhere(row.userId) })
    const records = await db
      .select({
        id: customers.id, name: customers.name, company: customers.company, email: customers.email,
        userId: sql<string | null>`(SELECT cc.user_id FROM customer_contacts cc WHERE cc.customer_id = ${customers.id} AND cc.active = 1 AND cc.user_id IS NOT NULL LIMIT 1)`,
      })
      .from(customers)
      .where(and(
        eq(customers.organizationId, input.organizationId),
        isNull(customers.mergedIntoCustomerId),
        text ? sql`(lower(${customers.name}) LIKE ${like} OR lower(COALESCE(${customers.company}, '')) LIKE ${like} OR lower(COALESCE(${customers.email}, '')) LIKE ${like})` : undefined,
      ))
      .orderBy(customers.name)
      .limit(DIRECTORY_LIST_LIMIT)
    for (const row of records) {
      options.push({
        id: `${CLIENT_RECORD_OPTION_PREFIX}${row.id}`, name: row.name,
        label: row.company?.trim() ? `Client · ${row.company.trim()}` : "Client",
        email: row.email, linkedElsewhere: linkedElsewhere(row.userId),
      })
    }
  } else {
    const people = await db
      .select({ id: vendorContacts.id, name: vendorContacts.name, email: vendorContacts.email, userId: vendorContacts.userId, company: vendors.name })
      .from(vendorContacts)
      .innerJoin(vendors, eq(vendors.id, vendorContacts.vendorId))
      .where(and(
        eq(vendors.organizationId, input.organizationId),
        eq(vendors.directoryStatus, "active"),
        isNull(vendors.mergedIntoVendorId),
        isNull(vendorContacts.mergedIntoPersonId),
        eq(vendorContacts.active, true),
        text ? sql`(lower(${vendorContacts.name}) LIKE ${like} OR lower(COALESCE(${vendorContacts.email}, '')) LIKE ${like} OR lower(${vendors.name}) LIKE ${like})` : undefined,
      ))
      .orderBy(vendors.name, vendorContacts.name)
      .limit(DIRECTORY_LIST_LIMIT)
    for (const row of people) options.push({ id: row.id, name: row.name, label: `Person at ${row.company}`, email: row.email, linkedElsewhere: linkedElsewhere(row.userId) })
    const companies = await db
      .select({ id: vendors.id, name: vendors.name, email: vendors.email, category: vendors.category })
      .from(vendors)
      .where(and(
        eq(vendors.organizationId, input.organizationId),
        eq(vendors.directoryStatus, "active"),
        isNull(vendors.mergedIntoVendorId),
        text ? sql`(lower(${vendors.name}) LIKE ${like} OR lower(COALESCE(${vendors.email}, '')) LIKE ${like})` : undefined,
      ))
      .orderBy(vendors.name)
      .limit(DIRECTORY_LIST_LIMIT)
    for (const row of companies) {
      options.push({ id: `${VENDOR_COMPANY_OPTION_PREFIX}${row.id}`, name: row.name, label: `Vendor company · ${row.category}`, email: row.email, linkedElsewhere: false })
    }
  }
  // Exact email matches first, as suggestions.
  const matches = (option: AccessRequestDirectoryOption): boolean => email !== "" && (option.email ?? "").trim().toLowerCase() === email
  return [...options.filter(matches), ...options.filter((option) => !matches(option))]
}

/** Active admins who decide requests and are told about new ones. */
export async function accessRequestDeciders(db: Db, organizationId: string): Promise<readonly { readonly userId: string; readonly email: string }[]> {
  const rows = await db
    .select({ userId: users.id, email: users.email })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(and(
      eq(organizationMembers.organizationId, organizationId),
      inArray(organizationMembers.role, [...ADMIN_USER_ROLES]),
      eq(users.isActive, true),
    ))
  return rows
}
