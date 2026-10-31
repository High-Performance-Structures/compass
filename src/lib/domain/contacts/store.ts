/**
 * The only code that writes the contacts tables: project contacts, the
 * client, vendor and internal directories, directory people, and the
 * project-contact source links (architecture standard, section 1).
 *
 * No auth logic lives here; callers resolve access first. Functions named
 * `...Statement` return an unexecuted statement for a caller's `db.batch`
 * so a multi-table write stays atomic.
 *
 * It also owns the read model `resolvedProjectContacts`: a project contact
 * linked to a directory record reads its name, company, email, phone and
 * address from that record. The copied columns are only a fallback.
 */
import { and, asc, eq, getTableColumns, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"

import {
  customerContacts,
  customers,
  internalContacts,
  organizationMembers,
  projectContacts,
  projectContactSourceLinks,
  users,
  vendorContacts,
  vendors,
} from "@/db/schema"
import { chunkD1Rows } from "@/lib/d1-query"
import type { Db } from "@/lib/server/action-context"

type Statement = BatchItem<"sqlite">

type ProjectContactRow = typeof projectContacts.$inferSelect
type ProjectContactInsert = typeof projectContacts.$inferInsert
type ProjectContactPatch = Partial<Omit<ProjectContactInsert, "id" | "projectId" | "createdAt">>
type CustomerInsert = typeof customers.$inferInsert
type CustomerPatch = Partial<Omit<CustomerInsert, "id" | "organizationId" | "createdAt">>
type VendorInsert = typeof vendors.$inferInsert
type VendorPatch = Partial<Omit<VendorInsert, "id" | "organizationId" | "createdAt">>
type VendorContactInsert = typeof vendorContacts.$inferInsert
type VendorContactPatch = Partial<Omit<VendorContactInsert, "id" | "vendorId" | "createdAt">>
type CustomerContactInsert = typeof customerContacts.$inferInsert
type CustomerContactPatch = Partial<Omit<CustomerContactInsert, "id" | "customerId" | "createdAt">>
type InternalContactInsert = typeof internalContacts.$inferInsert

type IdentityPatch = {
  readonly email: string | null
  readonly phone: string | null
  readonly address: string | null
  readonly updatedAt: string
}

// ---------------------------------------------------------------------------
// Read model
// ---------------------------------------------------------------------------

type DirectoryValue = {
  readonly customerContact: SQL | null
  readonly vendorContact: SQL | null
  readonly customer: SQL | null
  readonly vendor: SQL | null
  readonly internal: SQL | null
  readonly user: SQL | null
}

/**
 * The linked record, in the order the project contact names it. When that
 * record is reachable its value wins, blank included (a linked record owns
 * its blanks). Only an unlinked contact, or one whose record is no longer
 * reachable (inactive, merged, another organization), falls back to the
 * copied column.
 */
function linkedValue(value: DirectoryValue, copy: SQL): SQL {
  const pick = (present: SQL, field: SQL | null): SQL =>
    sql`case when ${present} then ${field ?? sql`null`} else ${copy} end`
  return sql`case
    when ${projectContacts.customerContactId} is not null
      then ${pick(sql`${customerContacts.id} is not null`, value.customerContact)}
    when ${projectContacts.vendorContactId} is not null
      then ${pick(sql`${vendorContacts.id} is not null`, value.vendorContact)}
    when ${projectContacts.customerId} is not null or ${projectContacts.sourceEntityType} = 'customer'
      then ${pick(sql`${customers.id} is not null`, value.customer)}
    when ${projectContacts.vendorId} is not null or ${projectContacts.sourceEntityType} = 'vendor'
      then ${pick(sql`${vendors.id} is not null`, value.vendor)}
    when ${projectContacts.internalContactId} is not null
      then ${pick(sql`${internalContacts.id} is not null`, value.internal)}
    when ${projectContacts.sourceEntityType} = 'user'
      then ${pick(sql`${users.id} is not null`, value.user)}
    else ${copy}
  end`
}

function trimmed(column: SQL): SQL {
  return sql`nullif(trim(${column}), '')`
}

const resolvedEmail = linkedValue(
  {
    customerContact: trimmed(sql`${customerContacts.email}`),
    vendorContact: trimmed(sql`${vendorContacts.email}`),
    customer: trimmed(sql`${customers.email}`),
    vendor: trimmed(sql`${vendors.email}`),
    internal: trimmed(sql`${internalContacts.email}`),
    user: trimmed(sql`${users.email}`),
  },
  trimmed(sql`${projectContacts.email}`)
)

const resolvedPhone = linkedValue(
  {
    customerContact: trimmed(sql`${customerContacts.phone}`),
    vendorContact: trimmed(sql`${vendorContacts.phone}`),
    customer: trimmed(sql`${customers.phone}`),
    vendor: trimmed(sql`${vendors.phone}`),
    internal: trimmed(sql`${internalContacts.phone}`),
    user: trimmed(sql`${users.phone}`),
  },
  trimmed(sql`${projectContacts.phone}`)
)

// People records carry no address: a client person uses the client's, and
// vendor people, staff and Compass users have none on a project.
const resolvedAddress = sql`case when ${projectContacts.contactType} = 'internal' then null else ${linkedValue(
  {
    customerContact: trimmed(sql`${customers.address}`),
    vendorContact: null,
    customer: trimmed(sql`${customers.address}`),
    vendor: trimmed(sql`${vendors.address}`),
    internal: null,
    user: null,
  },
  trimmed(sql`${projectContacts.address}`)
)} end`

const resolvedDisplayName = sql`case
  when ${projectContacts.contactType} = 'internal' and ${internalContacts.id} is not null then ${internalContacts.name}
  when ${projectContacts.customerContactId} is not null then coalesce(${customerContacts.name}, ${projectContacts.displayName})
  when ${projectContacts.vendorContactId} is not null then coalesce(${vendorContacts.name}, ${projectContacts.displayName})
  when ${vendors.id} is not null then ${vendors.name}
  when ${customers.id} is not null then ${customers.name}
  when ${internalContacts.id} is not null then ${internalContacts.name}
  else ${projectContacts.displayName}
end`

const resolvedCompanyName = sql`coalesce(${vendors.name}, ${customers.company}, ${projectContacts.companyName})`

type ResolvedOrder = "summary" | "type_then_name" | "name"

function orderBy(order: ResolvedOrder): readonly SQL[] {
  switch (order) {
    case "summary":
      return [asc(projectContacts.sortOrder), asc(projectContacts.contactType), asc(projectContacts.displayName)]
    case "type_then_name":
      return [asc(projectContacts.contactType), asc(projectContacts.displayName)]
    case "name":
      return [asc(projectContacts.displayName)]
  }
}

/**
 * Project contacts with directory-owned fields read from the linked record,
 * in one query. `where` narrows the project's rows (visibility, type,
 * active); directory joins are scoped to the organization.
 */
export async function resolvedProjectContacts(
  db: Db,
  query: {
    readonly organizationId: string
    readonly projectId: string
    readonly where?: SQL
    readonly order: ResolvedOrder
  }
): Promise<readonly ProjectContactRow[]> {
  const { organizationId } = query
  return db
    .select({
      ...getTableColumns(projectContacts),
      displayName: sql<string>`${resolvedDisplayName}`,
      companyName: sql<string | null>`${resolvedCompanyName}`,
      email: sql<string | null>`${resolvedEmail}`,
      phone: sql<string | null>`${resolvedPhone}`,
      address: sql<string | null>`${resolvedAddress}`,
    })
    .from(projectContacts)
    .leftJoin(
      customers,
      and(
        or(
          eq(projectContacts.customerId, customers.id),
          and(eq(projectContacts.sourceEntityType, "customer"), eq(projectContacts.sourceEntityId, customers.id))
        ),
        eq(customers.organizationId, organizationId)
      )
    )
    .leftJoin(
      customerContacts,
      and(
        eq(projectContacts.customerContactId, customerContacts.id),
        eq(customerContacts.customerId, customers.id),
        eq(customerContacts.active, true)
      )
    )
    .leftJoin(
      vendors,
      and(
        or(
          eq(projectContacts.vendorId, vendors.id),
          and(eq(projectContacts.sourceEntityType, "vendor"), eq(projectContacts.sourceEntityId, vendors.id))
        ),
        eq(vendors.organizationId, organizationId)
      )
    )
    .leftJoin(
      vendorContacts,
      and(
        eq(projectContacts.vendorContactId, vendorContacts.id),
        eq(vendorContacts.vendorId, vendors.id),
        eq(vendorContacts.active, true)
      )
    )
    .leftJoin(
      users,
      and(
        eq(projectContacts.sourceEntityType, "user"),
        eq(projectContacts.sourceEntityId, users.id),
        sql`exists (
          select 1 from ${organizationMembers}
          where ${organizationMembers.userId} = ${users.id}
            and ${organizationMembers.organizationId} = ${organizationId}
        )`
      )
    )
    .leftJoin(
      internalContacts,
      and(
        eq(projectContacts.internalContactId, internalContacts.id),
        eq(internalContacts.organizationId, organizationId),
        eq(internalContacts.active, true)
      )
    )
    .where(and(eq(projectContacts.projectId, query.projectId), query.where))
    .orderBy(...orderBy(query.order))
}

// ---------------------------------------------------------------------------
// Project contacts
// ---------------------------------------------------------------------------

export function insertProjectContactStatement(db: Db, values: ProjectContactInsert): Statement {
  return db.insert(projectContacts).values(values)
}

export async function insertProjectContact(db: Db, values: ProjectContactInsert): Promise<void> {
  await db.insert(projectContacts).values(values)
}

/**
 * Bulk directory association: an id that already exists is left alone.
 * Rows are split to stay under D1's bound-parameter limit and written in
 * one batch, so the association is still all or nothing.
 */
export async function insertProjectContactsIfMissing(
  db: Db,
  values: readonly ProjectContactInsert[]
): Promise<readonly { readonly id: string }[]> {
  const [first, ...rest] = chunkD1Rows(values).map((rows) =>
    db.insert(projectContacts).values(rows).onConflictDoNothing().returning({ id: projectContacts.id })
  )
  if (!first) return []
  const results = await db.batch([first, ...rest])
  return results.flat()
}

/** Only one primary contact per type on a project. */
export async function clearProjectPrimaryContact(
  db: Db,
  input: { readonly projectId: string; readonly contactType: string; readonly now: string }
): Promise<void> {
  await db
    .update(projectContacts)
    .set({ primaryContact: false, updatedAt: input.now })
    .where(and(eq(projectContacts.projectId, input.projectId), eq(projectContacts.contactType, input.contactType)))
}

export async function updateProjectContact(
  db: Db,
  input: { readonly projectId: string; readonly contactId: string; readonly values: ProjectContactPatch }
): Promise<void> {
  await db
    .update(projectContacts)
    .set(input.values)
    .where(and(eq(projectContacts.id, input.contactId), eq(projectContacts.projectId, input.projectId)))
}

/** Removal keeps the row for history but hides it everywhere. */
export async function deactivateProjectContact(
  db: Db,
  input: { readonly projectId: string; readonly contactId: string; readonly now: string }
): Promise<void> {
  await updateProjectContact(db, {
    projectId: input.projectId,
    contactId: input.contactId,
    values: {
      active: false,
      ownerPortalVisible: false,
      subVendorPortalVisible: false,
      internalVisible: false,
      primaryContact: false,
      updatedAt: input.now,
    },
  })
}

/** A write by contact id alone, for callers that already scoped the row to a project. */
export async function updateProjectContactById(
  db: Db,
  input: { readonly contactId: string; readonly values: ProjectContactPatch }
): Promise<void> {
  await db.update(projectContacts).set(input.values).where(eq(projectContacts.id, input.contactId)).run()
}

/**
 * Refresh the copied identity on every project contact that names this
 * client as its source, so readers that still use the copy stay current.
 */
export function syncCustomerCopiesStatement(db: Db, input: { readonly customerId: string; readonly identity: IdentityPatch }): Statement {
  return db
    .update(projectContacts)
    .set(input.identity)
    .where(and(eq(projectContacts.sourceEntityType, "customer"), eq(projectContacts.sourceEntityId, input.customerId)))
}

/** Same as above for a vendor company's own copied identity (not its people). */
export async function syncVendorCompanyCopies(
  db: Db,
  input: { readonly vendorId: string; readonly companyName: string; readonly identity: IdentityPatch }
): Promise<void> {
  await db
    .update(projectContacts)
    .set({ companyName: input.companyName, updatedAt: input.identity.updatedAt })
    .where(eq(projectContacts.vendorId, input.vendorId))
  await db
    .update(projectContacts)
    .set(input.identity)
    .where(
      and(
        eq(projectContacts.sourceEntityType, "vendor"),
        eq(projectContacts.sourceEntityId, input.vendorId),
        isNull(projectContacts.vendorContactId)
      )
    )
}

/** Copies for one vendor person, after a directory edit of that person. */
export function syncVendorPersonCopiesStatement(
  db: Db,
  input: {
    readonly vendorContactId: string
    readonly values: Pick<ProjectContactPatch, "displayName" | "companyName" | "email" | "phone" | "updatedAt">
    readonly includeSourceEntityMatch: boolean
  }
): Statement {
  return db
    .update(projectContacts)
    .set(input.values)
    .where(
      input.includeSourceEntityMatch
        ? or(
            eq(projectContacts.vendorContactId, input.vendorContactId),
            and(
              eq(projectContacts.sourceEntityType, "vendor_contact"),
              eq(projectContacts.sourceEntityId, input.vendorContactId)
            )
          )
        : eq(projectContacts.vendorContactId, input.vendorContactId)
    )
}

/** Copies for a vendor company linked without a person. */
function syncVendorWithoutPersonCopiesStatement(db: Db, input: { readonly vendorId: string; readonly identity: IdentityPatch }): Statement {
  return db
    .update(projectContacts)
    .set(input.identity)
    .where(
      or(
        and(eq(projectContacts.vendorId, input.vendorId), isNull(projectContacts.vendorContactId)),
        and(
          eq(projectContacts.sourceEntityType, "vendor"),
          eq(projectContacts.sourceEntityId, input.vendorId),
          isNull(projectContacts.vendorContactId)
        )
      )
    )
}

/**
 * Identity typed on a project contact that is not yet managed by a
 * directory link is written to the record it names, then to its copies.
 * Linked contacts never reach this: their identity is edited in Contacts.
 */
export async function writeProjectIdentityToDirectory(
  db: Db,
  input: {
    readonly organizationId: string
    readonly target:
      | { readonly kind: "customer"; readonly customerId: string }
      | { readonly kind: "vendor_contact"; readonly vendorContactId: string }
      | { readonly kind: "vendor"; readonly vendorId: string }
    readonly displayName: string
    readonly identity: IdentityPatch
  }
): Promise<void> {
  const { identity, organizationId, target } = input
  if (target.kind === "customer") {
    await db.batch([
      updateCustomerStatement(db, {
        customerId: target.customerId,
        organizationId,
        values: identity,
      }),
      syncCustomerCopiesStatement(db, { customerId: target.customerId, identity }),
    ])
    return
  }
  if (target.kind === "vendor_contact") {
    await db.batch([
      db
        .update(vendorContacts)
        .set({ name: input.displayName, email: identity.email, phone: identity.phone, updatedAt: identity.updatedAt })
        .where(eq(vendorContacts.id, target.vendorContactId)),
      syncVendorPersonCopiesStatement(db, {
        vendorContactId: target.vendorContactId,
        values: { displayName: input.displayName, email: identity.email, phone: identity.phone, updatedAt: identity.updatedAt },
        includeSourceEntityMatch: false,
      }),
    ])
    return
  }
  await db.batch([
    db
      .update(vendors)
      .set(identity)
      .where(and(eq(vendors.id, target.vendorId), eq(vendors.organizationId, organizationId))),
    syncVendorWithoutPersonCopiesStatement(db, { vendorId: target.vendorId, identity }),
  ])
}

// ---------------------------------------------------------------------------
// Project-contact source links (review queue)
// ---------------------------------------------------------------------------

type SourceLinkMatch = {
  readonly projectContactId: string | null
  readonly matchStatus: string
  readonly matchConfidence: number
  readonly matchReason: string
  readonly updatedAt: string
}

/** Set the match on the selected links of one project. */
export async function setSourceLinkMatch(
  db: Db,
  input: { readonly projectId: string; readonly linkIds: readonly string[]; readonly match: SourceLinkMatch }
): Promise<void> {
  if (input.linkIds.length === 0) return
  await db
    .update(projectContactSourceLinks)
    .set(input.match)
    .where(and(inArray(projectContactSourceLinks.id, [...input.linkIds]), eq(projectContactSourceLinks.projectId, input.projectId)))
}

/** Approval keeps the assigned contact; only the status changes. */
export async function approveSourceLinks(
  db: Db,
  input: { readonly projectId: string; readonly linkIds: readonly string[]; readonly now: string }
): Promise<void> {
  await db
    .update(projectContactSourceLinks)
    .set({ matchStatus: "approved", matchConfidence: 1, matchReason: "Approved in Compass match review.", updatedAt: input.now })
    .where(and(inArray(projectContactSourceLinks.id, [...input.linkIds]), eq(projectContactSourceLinks.projectId, input.projectId)))
}

/** A removed contact's source rows go back to review. */
export async function releaseSourceLinksForContact(
  db: Db,
  input: { readonly projectId: string; readonly contactId: string; readonly now: string }
): Promise<void> {
  await db
    .update(projectContactSourceLinks)
    .set({
      projectContactId: null,
      matchStatus: "review",
      matchConfidence: 0,
      matchReason: "Project contact was removed in Compass and needs reassignment.",
      updatedAt: input.now,
    })
    .where(
      and(
        eq(projectContactSourceLinks.projectId, input.projectId),
        eq(projectContactSourceLinks.projectContactId, input.contactId)
      )
    )
}

// ---------------------------------------------------------------------------
// Clients (customers) and client people
// ---------------------------------------------------------------------------

export function insertCustomerStatement(db: Db, values: CustomerInsert): Statement {
  return db.insert(customers).values(values)
}

export async function insertCustomer(db: Db, values: CustomerInsert): Promise<void> {
  await db.insert(customers).values(values)
}

/** A live (not merged) client in the organization. */
export function updateCustomerStatement(
  db: Db,
  input: { readonly customerId: string; readonly organizationId: string; readonly values: CustomerPatch }
): Statement {
  return db
    .update(customers)
    .set(input.values)
    .where(
      and(
        eq(customers.id, input.customerId),
        eq(customers.organizationId, input.organizationId),
        isNull(customers.mergedIntoCustomerId)
      )
    )
}

/** A write by id for callers that already resolved the client in their organization. */
export function updateCustomerByIdStatement(db: Db, input: { readonly customerId: string; readonly values: CustomerPatch }): Statement {
  return db.update(customers).set(input.values).where(eq(customers.id, input.customerId))
}

export async function updateCustomerById(db: Db, input: { readonly customerId: string; readonly values: CustomerPatch }): Promise<void> {
  await db.update(customers).set(input.values).where(eq(customers.id, input.customerId))
}

export async function deleteCustomer(db: Db, input: { readonly customerId: string; readonly organizationId: string }): Promise<void> {
  await db.delete(customers).where(and(eq(customers.id, input.customerId), eq(customers.organizationId, input.organizationId)))
}

export async function insertCustomerPerson(db: Db, values: CustomerContactInsert): Promise<void> {
  await db.insert(customerContacts).values(values).run()
}

export async function updateCustomerPerson(db: Db, input: { readonly personId: string; readonly values: CustomerContactPatch }): Promise<void> {
  await db.update(customerContacts).set(input.values).where(eq(customerContacts.id, input.personId)).run()
}

/** Only one primary person per client. */
export async function clearOtherCustomerPrimaryPeople(
  db: Db,
  input: { readonly customerId: string; readonly keepPersonId: string; readonly now: string }
): Promise<void> {
  await db
    .update(customerContacts)
    .set({ isPrimary: false, updatedAt: input.now })
    .where(and(eq(customerContacts.customerId, input.customerId), ne(customerContacts.id, input.keepPersonId)))
    .run()
}

// ---------------------------------------------------------------------------
// Vendors and vendor people
// ---------------------------------------------------------------------------

export async function insertVendor(db: Db, values: VendorInsert): Promise<void> {
  await db.insert(vendors).values(values)
}

/** A write by vendor id for callers that already resolved the vendor in their organization. */
export async function updateVendorById(db: Db, input: { readonly vendorId: string; readonly values: VendorPatch }): Promise<void> {
  await db.update(vendors).set(input.values).where(eq(vendors.id, input.vendorId)).run()
}

export async function updateVendor(
  db: Db,
  input: { readonly vendorId: string; readonly organizationId: string; readonly values: VendorPatch }
): Promise<void> {
  await db
    .update(vendors)
    .set(input.values)
    .where(and(eq(vendors.id, input.vendorId), eq(vendors.organizationId, input.organizationId)))
}

export async function deleteVendor(db: Db, input: { readonly vendorId: string; readonly organizationId: string }): Promise<void> {
  await db.delete(vendors).where(and(eq(vendors.id, input.vendorId), eq(vendors.organizationId, input.organizationId)))
}

/** One batch for any number of people, instead of an insert per person. */
export async function insertVendorPeople(db: Db, values: readonly VendorContactInsert[]): Promise<void> {
  const [first, ...rest] = values.map((value) => db.insert(vendorContacts).values(value))
  if (!first) return
  await db.batch([first, ...rest])
}

export async function clearVendorPrimaryPeople(db: Db, input: { readonly vendorId: string; readonly now: string }): Promise<void> {
  await db.update(vendorContacts).set({ isPrimary: false, updatedAt: input.now }).where(eq(vendorContacts.vendorId, input.vendorId))
}

export function updateVendorPersonStatement(
  db: Db,
  input: { readonly vendorId: string; readonly personId: string; readonly values: VendorContactPatch }
): Statement {
  return db
    .update(vendorContacts)
    .set(input.values)
    .where(and(eq(vendorContacts.id, input.personId), eq(vendorContacts.vendorId, input.vendorId)))
}

export function insertVendorPersonStatement(db: Db, values: VendorContactInsert): Statement {
  return db.insert(vendorContacts).values(values)
}

export async function deactivateVendorPeople(db: Db, input: { readonly personIds: readonly string[]; readonly now: string }): Promise<void> {
  if (input.personIds.length === 0) return
  await db
    .update(vendorContacts)
    .set({ active: false, isPrimary: false, updatedAt: input.now })
    .where(inArray(vendorContacts.id, [...input.personIds]))
}

// ---------------------------------------------------------------------------
// Internal (staff) directory
// ---------------------------------------------------------------------------

export function insertInternalContactStatement(db: Db, values: InternalContactInsert): Statement {
  return db.insert(internalContacts).values(values)
}

/** Provisioning is idempotent: an existing person for the user is kept. */
export async function insertInternalContactIfMissing(db: Db, values: InternalContactInsert): Promise<void> {
  await db.insert(internalContacts).values(values).onConflictDoNothing().run()
}
