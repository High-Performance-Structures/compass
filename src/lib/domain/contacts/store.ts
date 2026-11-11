/**
 * The only code that writes the contacts tables: project contacts, the
 * client, vendor and internal directories, directory people, and the
 * project-contact source links (architecture standard, section 1).
 *
 * No auth logic lives here; callers resolve access first. `...Statement`
 * functions return an unexecuted statement for a caller's atomic `db.batch`.
 *
 * The read model `resolvedProjectContacts` lives in
 * resolved-project-contacts.ts. New project contacts must link:
 * insertableProjectContacts.
 */
import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"

import { customerContacts, customers, internalContacts, projectContacts, projectContactSourceLinks, vendorContacts, vendors } from "@/db/schema"
import { chunkD1InsertRows } from "@/lib/d1-query"
import type { Db } from "@/lib/server/action-context"
import { checkedListFields } from "@/lib/shared/statuses"
import { companyMoveGuard, type CompanyReferenceMove } from "./company-merge-references"
import { MERGE_TABLE, mergeCarryOverColumns, personMergeGuard, type CarryOverWrite } from "./merge-carry-over"
import { insertableProjectContacts } from "./rules"
import { PROJECT_CONTACT_LISTS, type ProjectContactType } from "./statuses"
import { directoryPersonProjectContactsWhere, type DirectoryPersonKind } from "./person-status"
import { SAGE_DIRECTORY, type SageDirectoryKind } from "./sage-directory"

type Statement = BatchItem<"sqlite">

type ProjectContactInsert = typeof projectContacts.$inferInsert
type ProjectContactPatch = Partial<Omit<ProjectContactInsert, "id" | "projectId" | "createdAt">>
type CustomerInsert = typeof customers.$inferInsert
type CustomerPatch = Partial<Omit<CustomerInsert, "id" | "organizationId" | "createdAt">>
type VendorInsert = typeof vendors.$inferInsert
export type VendorPatch = Partial<Omit<VendorInsert, "id" | "organizationId" | "createdAt">>
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
// Project contacts
// ---------------------------------------------------------------------------

export function insertProjectContactStatement(db: Db, values: ProjectContactInsert): Statement {
  return db.insert(projectContacts).values(insertableProjectContacts(values))
}

export async function insertProjectContact(db: Db, values: ProjectContactInsert): Promise<void> {
  await db.insert(projectContacts).values(insertableProjectContacts(values))
}

/** One project contact, left alone when a row with its id already exists. */
export function insertProjectContactIfMissingStatement(db: Db, values: ProjectContactInsert): Statement {
  return db.insert(projectContacts).values(insertableProjectContacts(values)).onConflictDoNothing()
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
  const [first, ...rest] = chunkD1InsertRows(projectContacts, values).map((rows) =>
    db.insert(projectContacts).values(insertableProjectContacts(rows)).onConflictDoNothing().returning({ id: projectContacts.id })
  )
  if (!first) return []
  const results = await db.batch([first, ...rest])
  return results.flat()
}

/** Only one primary contact per type on a project. */
export async function clearProjectPrimaryContact(db: Db, input: { readonly projectId: string; readonly contactType: ProjectContactType; readonly now: string }): Promise<void> {
  await db
    .update(projectContacts)
    .set({ primaryContact: false, updatedAt: input.now })
    .where(and(eq(projectContacts.projectId, input.projectId), eq(projectContacts.contactType, input.contactType)))
}

export async function updateProjectContact(db: Db, input: { readonly projectId: string; readonly contactId: string; readonly values: ProjectContactPatch }): Promise<void> {
  await db
    .update(projectContacts)
    .set(checkedListFields("project_contacts", input.values, PROJECT_CONTACT_LISTS))
    .where(and(eq(projectContacts.id, input.contactId), eq(projectContacts.projectId, input.projectId)))
}

/** Removal keeps the row for history but hides it everywhere. */
export async function deactivateProjectContact(db: Db, input: { readonly projectId: string; readonly contactId: string; readonly now: string }): Promise<void> {
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
  await db.update(projectContacts).set(checkedListFields("project_contacts", input.values, PROJECT_CONTACT_LISTS)).where(eq(projectContacts.id, input.contactId)).run()
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

/**
 * "Use Sage name": renames a Sage-linked client or vendor company to the name
 * Sage holds. Fenced on the name and Sage link the caller read, so a
 * concurrent edit or relink is not overwritten; false when the fence failed.
 * Ids, Sage ids and numbers, and source columns are untouched.
 */
export async function adoptSageCompanyName(
  db: Db,
  input: {
    readonly kind: "client_company" | "vendor_company"
    readonly id: string
    readonly organizationId: string
    readonly sageRecordId: string
    readonly previousName: string
    readonly name: string
    readonly now: string
  }
): Promise<boolean> {
  if (input.kind === "client_company") {
    const rows = await db.update(customers).set({ name: input.name, updatedAt: input.now }).where(and(
      eq(customers.id, input.id), eq(customers.organizationId, input.organizationId),
      isNull(customers.mergedIntoCustomerId), eq(customers.sageClientId, input.sageRecordId),
      eq(customers.name, input.previousName)
    )).returning({ id: customers.id })
    return rows.length === 1
  }
  const rows = await db.update(vendors).set({ name: input.name, updatedAt: input.now }).where(and(
    eq(vendors.id, input.id), eq(vendors.organizationId, input.organizationId),
    eq(vendors.directoryStatus, "active"), eq(vendors.sageVendorId, input.sageRecordId),
    eq(vendors.name, input.previousName)
  )).returning({ id: vendors.id })
  if (rows.length !== 1) return false
  // Project contacts read a linked vendor's name from the directory; the
  // copied company name is refreshed for readers that still use it.
  await db.update(projectContacts).set({ companyName: input.name, updatedAt: input.now })
    .where(eq(projectContacts.vendorId, input.id))
  return true
}

/** A Sage list update, fenced on the vendor still being active and linked to that Sage record. */
export function sageVendorUpdateStatement(db: Db, input: { readonly vendorId: string; readonly organizationId: string; readonly sageRecordId: string; readonly patch: VendorPatch; readonly now: string }) {
  return db.update(vendors).set({ ...input.patch, updatedAt: input.now }).where(and(
    eq(vendors.id, input.vendorId), eq(vendors.organizationId, input.organizationId), eq(vendors.directoryStatus, "active"),
    isNull(vendors.mergedIntoVendorId), eq(vendors.sageVendorId, input.sageRecordId)
  )).returning({ id: vendors.id })
}

/** Project contacts keep a copy of their vendor's name for readers that still use it. */
export function vendorProjectContactNameStatement(db: Db, input: { readonly vendorId: string; readonly name: string; readonly now: string }) {
  return db.update(projectContacts).set({ companyName: input.name, updatedAt: input.now }).where(eq(projectContacts.vendorId, input.vendorId))
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

export function insertVendorPersonStatement(db: Db, values: VendorContactInsert, ifMissing = false): Statement {
  return ifMissing ? db.insert(vendorContacts).values(values).onConflictDoNothing() : db.insert(vendorContacts).values(values)
}

/** Vendor people removed in the vendor editor, and their job rows (kept as history). */
export async function deactivateVendorPeople(db: Db, input: { readonly personIds: readonly string[]; readonly now: string }): Promise<void> {
  if (input.personIds.length === 0) return
  await db.batch([
    db
      .update(vendorContacts)
      .set({ active: false, isPrimary: false, updatedAt: input.now })
      .where(inArray(vendorContacts.id, [...input.personIds])),
    ...archivedPersonProjectContactsStatements(db, { kind: "vendor_contact", personIds: input.personIds, now: input.now }),
  ])
}

/**
 * A person removed from Contacts leaves every job: their project-contact rows
 * become inactive. Rows are never deleted (messages, logs, photos and Activity
 * point at them) and notes and links are kept, so they read as history.
 */
export function archivedPersonProjectContactsStatements(
  db: Db,
  input: { readonly kind: DirectoryPersonKind; readonly personIds: readonly string[]; readonly now: string }
): Statement[] {
  // Each id is bound twice (link column and provenance), so 40 ids per
  // statement stay under D1's 100-parameter limit.
  const chunks: string[][] = []
  for (let index = 0; index < input.personIds.length; index += 40) chunks.push(input.personIds.slice(index, index + 40))
  return chunks.map((ids) =>
    db
      .update(projectContacts)
      .set({ active: false, primaryContact: false, updatedAt: input.now })
      .where(and(eq(projectContacts.active, true), directoryPersonProjectContactsWhere(input.kind, ids)))
  )
}

// ---------------------------------------------------------------------------
// Internal (staff) directory
// ---------------------------------------------------------------------------

export function insertInternalContactStatement(db: Db, values: InternalContactInsert): Statement {
  return db.insert(internalContacts).values(values)
}

/** Staff edit of an internal person and the copies on project contacts that name them (an archived person is read only from those copies). */
export async function updateInternalPerson(db: Db, input: { readonly organizationId: string; readonly personId: string; readonly values: Partial<Pick<InternalContactInsert, "name" | "jobTitle" | "email" | "phone" | "cellPhone" | "active">>; readonly now: string }): Promise<void> {
  const { name, email, phone, cellPhone } = input.values
  const copies = { ...(name !== undefined ? { displayName: name } : {}), ...(email !== undefined ? { email } : {}), ...(phone !== undefined || cellPhone !== undefined ? { phone: phone ?? cellPhone ?? null } : {}) }
  const person = db.update(internalContacts).set({ ...input.values, updatedAt: input.now }).where(and(eq(internalContacts.id, input.personId), eq(internalContacts.organizationId, input.organizationId)))
  await (Object.keys(copies).length === 0 ? person.run() : db.batch([person, db.update(projectContacts).set({ ...copies, updatedAt: input.now }).where(eq(projectContacts.internalContactId, input.personId))]))
}
/** One unassigned (imported) person's rows on the organization's projects. */
export async function updateUnassignedPersonRows(db: Db, input: { readonly contactIds: readonly string[]; readonly values: Pick<ProjectContactPatch, "displayName" | "companyName" | "email" | "phone" | "updatedAt"> }): Promise<void> {
  if (input.contactIds.length > 0) await db.update(projectContacts).set(input.values).where(inArray(projectContacts.id, [...input.contactIds])).run()
}

/** Provisioning is idempotent: an existing person for the user is kept. */
export async function insertInternalContactIfMissing(db: Db, values: InternalContactInsert): Promise<void> {
  await db.insert(internalContacts).values(values).onConflictDoNothing().run()
}

/** Links a still-unlinked staff contact to a Sage employee, unless another contact already holds that employee. Returns the id when it linked. */
export function linkInternalContactToSageEmployeeStatement(db: Db, input: { readonly organizationId: string; readonly internalContactId: string; readonly sageEmployeeId: string; readonly sageEmployeeNumber: string; readonly now: string }) {
  const unlinked = sql`trim(coalesce(${internalContacts.sageEmployeeId}, '')) = '' AND trim(coalesce(${internalContacts.sageEmployeeNumber}, '')) = ''`
  const free = sql`NOT EXISTS (SELECT 1 FROM internal_contacts other WHERE other.organization_id = ${input.organizationId}
    AND (lower(other.sage_employee_id) = lower(${input.sageEmployeeId}) OR other.sage_employee_number = ${input.sageEmployeeNumber}))`
  return db.update(internalContacts).set({ sageEmployeeId: input.sageEmployeeId, sageEmployeeNumber: input.sageEmployeeNumber, updatedAt: input.now })
    .where(and(eq(internalContacts.id, input.internalContactId), eq(internalContacts.organizationId, input.organizationId), eq(internalContacts.active, true), unlinked, free))
    .returning({ id: internalContacts.id })
}
/** Creates a staff login's internal contact already linked to its Sage employee; does nothing if the user or employee is taken meanwhile. */
export function insertLinkedInternalContactStatement(db: Db, values: InternalContactInsert) {
  return db.insert(internalContacts).values(values).onConflictDoNothing().returning({ id: internalContacts.id })
}
/** Sage's employee status decides a linked contact's active flag (a Sage read, so allowed although manual archive is refused). */
export function setInternalContactActiveFromSageStatement(db: Db, input: { readonly organizationId: string; readonly internalContactId: string; readonly active: boolean; readonly now: string }) {
  return db.update(internalContacts).set({ active: input.active, updatedAt: input.now })
    .where(and(eq(internalContacts.id, input.internalContactId), eq(internalContacts.organizationId, input.organizationId), ne(internalContacts.active, input.active)))
    .returning({ id: internalContacts.id })
}

// --- Raw D1 writes (Sage bridge, merges, account links): bound statements for the caller's fenced batch.

/** The Sage client the Windows writer returned for a customer; skipped while another client holds it (a duplicate to merge), since the unique index would fail the whole result batch. */
export function sageClientWriteResultCustomerStatement(database: D1Database, input: {
  readonly customerId: string; readonly sageClientId: string; readonly sageClientNumber: string; readonly sageClientStatusId: number; readonly now: string
}): D1PreparedStatement {
  return database.prepare(`UPDATE customers SET sage_client_id = ?, sage_client_number = ?, sage_client_status_id = ?, updated_at = ?
    WHERE id = ? AND NOT EXISTS (SELECT 1 FROM customers other WHERE other.id <> customers.id AND other.organization_id IS customers.organization_id
      AND (upper(other.sage_client_id) = upper(?) OR other.sage_client_number = ?))`)
    .bind(input.sageClientId, input.sageClientNumber, input.sageClientStatusId, input.now, input.customerId, input.sageClientId, input.sageClientNumber)
}

/** Fills a still number-only client's Sage id from Sage's client directory unless another client holds that id or number. */
export function sageClientIdFromDirectoryStatement(database: D1Database, input: { readonly customerId: string; readonly organizationId: string; readonly sageClientId: string; readonly sageClientNumber: string; readonly now: string }): D1PreparedStatement {
  return database.prepare(`UPDATE customers SET sage_client_id = ?, updated_at = ? WHERE id = ? AND organization_id = ? AND merged_into_customer_id IS NULL
    AND (sage_client_id IS NULL OR trim(sage_client_id) = '') AND trim(sage_client_number) = ? AND NOT EXISTS (SELECT 1 FROM customers other
      WHERE other.id <> customers.id AND other.organization_id = customers.organization_id AND (upper(other.sage_client_id) = upper(?) OR trim(other.sage_client_number) = ?))`)
    .bind(input.sageClientId, input.now, input.customerId, input.organizationId, input.sageClientNumber, input.sageClientId, input.sageClientNumber)
}

/** Applies a verified Sage snapshot's `assignments` to the still-linked directory row; `binds` follow the SQL. */
export function sageSnapshotDirectoryUpdateStatement(
  database: D1Database, kind: SageDirectoryKind, assignments: string, binds: readonly unknown[]
): D1PreparedStatement {
  const target = SAGE_DIRECTORY[kind]
  const synced = target.synced ? ", sync_status = 'synced', last_synced_at = ?" : ""
  const scope = target.parent ? `${target.sageId} = ? AND ${target.parent}` : `organization_id = ? AND ${target.sageId} = ?`
  return database.prepare(`UPDATE ${target.table} SET ${assignments}${synced} WHERE id = ? AND ${scope}`).bind(...binds)
}

/** Links a reviewed Sage identity to a still-unlinked directory row while `guard` holds. */
export function sageIdentityLinkStatement(
  database: D1Database, kind: SageDirectoryKind, guard: string, binds: readonly unknown[]
): D1PreparedStatement {
  const { table, sageId, number, parent } = SAGE_DIRECTORY[kind]
  return database.prepare(`UPDATE ${table} SET ${sageId} = ?, ${number} = ? WHERE id = ?${parent ? "" : " AND organization_id = ?"}
    AND ${sageId} IS NULL AND (${number} IS NULL OR ${number} = ?)${parent ? ` AND ${parent}` : ""} AND ${guard}`).bind(...binds)
}

/** Upserts the Sage-sourced private address columns of one staff contact. */
export function upsertInternalContactPrivateAddressStatement(database: D1Database, input: {
  readonly internalContactId: string; readonly columns: readonly string[]
  readonly values: readonly (string | null)[]; readonly now: string
}): D1PreparedStatement {
  const columns = input.columns.map((column) => `\`${column}\``).join(", ")
  const placeholders = input.columns.map(() => "?").join(", ")
  const updates = input.columns.map((column) => `\`${column}\` = excluded.\`${column}\``).join(", ")
  return database.prepare(`INSERT INTO internal_contact_private_addresses
    (internal_contact_id, ${columns}, updated_at) VALUES (?, ${placeholders}, ?)
    ON CONFLICT(internal_contact_id) DO UPDATE SET ${updates}, updated_at = excluded.updated_at`)
    .bind(input.internalContactId, ...input.values, input.now)
}

/** Inserts the person Sage just added, only while the parent link and Add claim hold. */
export function insertSageCreatedPersonStatement(
  database: D1Database, kind: "client_person" | "vendor_person", binds: readonly unknown[]
): D1PreparedStatement {
  // Only client people carry sync columns; only vendors must still be active.
  const [people, parent, syncColumns, syncValues, parentFilter] = kind === "client_person"
    ? ["customer_contacts", "customer", " sync_status, last_synced_at,", " 'synced', ?,", "customers WHERE id = ? AND organization_id = ? AND sage_client_id = ?"]
    : ["vendor_contacts", "vendor", "", "", "vendors WHERE id = ? AND organization_id = ? AND sage_vendor_id = ? AND directory_status = 'active'"]
  return database.prepare(`INSERT INTO ${people} (id, ${parent}_id, name, title, email, phone, phone_extension, cell_phone,
      sage_contact_id, sage_line_number, is_primary, active, source_system,${syncColumns} created_at, updated_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN EXISTS (SELECT 1 FROM ${people} WHERE ${parent}_id = ? AND active = 1) THEN 0 ELSE 1 END,
      1, 'sage',${syncValues} ?, ? WHERE EXISTS (SELECT 1 FROM ${parentFilter})
      AND EXISTS (SELECT 1 FROM sage_contact_create_proposals WHERE id = ? AND status = 'running' AND claim_token = ?)`).bind(...binds)
}

/**
 * The INSERT of the offline Sage client-directory import script (number-only,
 * unverified candidates). `organization` is an already-quoted SQL literal.
 */
export function sageClientDirectoryCandidateInsertSql(organization: string): string {
  return `INSERT OR IGNORE INTO customers (
  id, name, company, email, phone, address, notes, netsuite_id,
  sage_client_id, sage_client_number, sage_client_status_id,
  buildertrend_contact_id, relationship_type,
  organization_id, created_at, updated_at
)
SELECT
  'sage-customer-' || ${organization} || '-' || sc.client_number, sc.name, NULL, NULL, NULL, NULL,
  'Unverified Sage-number candidate. Reconcile the exact Sage ID and Compass customer before use; this import grants no portal access.',
  NULL, NULL, sc.client_number, NULL, NULL, 'client', ${organization},
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM sage_clients sc
WHERE NOT EXISTS (
  SELECT 1 FROM customers c WHERE c.organization_id = ${organization} AND c.sage_client_number = sc.client_number
);
`
}

/** What a duplicate merge records and moves; `kind` names the directory side and level. */
export type ContactMergeWrite = {
  readonly kind: "customer_company" | "vendor_company" | "customer_person" | "vendor_person"; readonly organizationId: string
  readonly sourceId: string; readonly destinationId: string; readonly sourceSnapshot: string; readonly destinationSnapshot: string
  readonly peopleCount: number; readonly projectContactCount: number; readonly userId: string; readonly now: string
}

type MergeIds = { readonly sourceId: string; readonly destinationId: string; readonly now: string }
type MergeGuard = { readonly sql: string; readonly binds: readonly unknown[] }

/** Moves project contacts (and their directory provenance) between directory records; `guard` narrows company moves. */
function projectContactMoveStatement(database: D1Database, column: string, type: string, ids: MergeIds, guard?: MergeGuard): D1PreparedStatement {
  const where = `${column} = ? OR (source_entity_type = '${type}' AND source_entity_id = ?)`
  return database.prepare(`UPDATE project_contacts SET ${column} = ?, source_entity_id = CASE WHEN source_entity_type = '${type}' AND source_entity_id = ? THEN ? ELSE source_entity_id END, source_record_id = CASE WHEN source_entity_type = '${type}' AND source_record_id = ? THEN ? ELSE source_record_id END, updated_at = ? WHERE ${guard ? `(${where}) AND ${guard.sql}` : where}`)
    .bind(ids.destinationId, ids.sourceId, ids.destinationId, ids.sourceId, ids.destinationId, ids.now, ids.sourceId, ids.sourceId, ...(guard?.binds ?? []))
}

/** The merge audit row; a company merge's source snapshot also records what moved and what was kept. */
export function contactMergeEventStatement(database: D1Database, input: ContactMergeWrite): D1PreparedStatement {
  return database.prepare(`INSERT INTO contact_merge_events (id, organization_id, kind, source_id, destination_id, source_snapshot_json,
    destination_snapshot_json, moved_people_count, moved_project_contacts_count, merged_by_user_id, merged_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), input.organizationId, input.kind, input.sourceId, input.destinationId,
      input.sourceSnapshot, input.destinationSnapshot, input.peopleCount, input.projectContactCount, input.userId, input.now)
}

/** The kept record takes the archived one's contact fields (only columns merge-carry-over.ts allows) while `guard` sees the source live. */
export function mergeCarryOverStatements(database: D1Database, input: CarryOverWrite): D1PreparedStatement[] {
  const entries = Object.entries(input.values).filter(([column]) => mergeCarryOverColumns(input.kind).includes(column))
  return entries.length === 0 ? [] : [database.prepare(`UPDATE ${MERGE_TABLE[input.kind]} SET ${entries.map(([column]) => `${column} = ?`).join(", ")}, updated_at = ? WHERE id = ? AND ${input.guard.sql}`)
    .bind(...entries.map(([, value]) => value), input.now, input.destinationId, ...input.guard.binds)]
}

/** A people merge as one atomic batch: the audit event, the moves (the project-contact scope trigger checks the child's current parent), earlier duplicates re-pointed to the kept person (pointers stay one hop), then the archive. */
export function contactMergeStatements(
  database: D1Database, input: ContactMergeWrite & { readonly kind: "customer_person" | "vendor_person" }
): D1PreparedStatement[] {
  const [people, parent] = input.kind === "customer_person" ? ["customer_contacts", "customer"] : ["vendor_contacts", "vendor"]
  return [contactMergeEventStatement(database, input), projectContactMoveStatement(database, `${parent}_contact_id`, `${parent}_contact`, input),
    database.prepare(`UPDATE ${people} SET is_primary = 1, updated_at = ? WHERE id = ? AND EXISTS (SELECT 1 FROM ${people} WHERE id = ? AND is_primary = 1)`)
      .bind(input.now, input.destinationId, input.sourceId),
    database.prepare(`UPDATE ${people} SET merged_into_person_id = ?, updated_at = ? WHERE merged_into_person_id = ? AND ${personMergeGuard(input.kind, input.sourceId).sql}`).bind(input.destinationId, input.now, input.sourceId, input.sourceId),
    database.prepare(`UPDATE ${people} SET active = 0, merged_into_person_id = ?, is_primary = 0, updated_at = ? WHERE id = ? AND active = 1 AND merged_into_person_id IS NULL`)
      .bind(input.destinationId, input.now, input.sourceId)]
}

/**
 * A company merge's directory moves, children before parents: people,
 * project contacts, the trade-doc folder and bill choice when the kept vendor
 * has none, and earlier duplicates that were merged into the archived company.
 */
export function companyContactMoveStatements(database: D1Database, move: CompanyReferenceMove): D1PreparedStatement[] {
  const guard = companyMoveGuard(move)
  const { destinationId: keep, sourceId: archive, now } = move
  // A project that lists both companies keeps the kept company's row; the archived company's row there is retired
  // (inactive, not deleted, so whatever points at it still resolves) and then moves with the rest.
  const retireDuplicates = (column: string, type: string): D1PreparedStatement => database.prepare(`UPDATE project_contacts
    SET active = 0, primary_contact = 0, updated_at = ? WHERE (${column} = ? OR (source_entity_type = '${type}' AND source_entity_id = ?)) AND active = 1
      AND EXISTS (SELECT 1 FROM project_contacts k WHERE k.project_id = project_contacts.project_id AND k.id <> project_contacts.id
        AND (k.${column} = ? OR (k.source_entity_type = '${type}' AND k.source_entity_id = ?))) AND ${guard.sql}`)
    .bind(now, archive, archive, keep, keep, ...guard.binds)
  if (move.side === "customer") return [
    database.prepare(`UPDATE customer_contacts SET customer_id = ?, updated_at = ? WHERE customer_id = ? AND ${guard.sql}`).bind(keep, now, archive, ...guard.binds),
    retireDuplicates("customer_id", "customer"),
    projectContactMoveStatement(database, "customer_id", "customer", move, guard),
    database.prepare(`UPDATE customers SET merged_into_customer_id = ?, updated_at = ? WHERE merged_into_customer_id = ? AND organization_id = ? AND ${guard.sql}`)
      .bind(keep, now, archive, move.organizationId, ...guard.binds)]
  return [
    database.prepare(`UPDATE vendor_contacts SET vendor_id = ?, updated_at = ? WHERE vendor_id = ? AND ${guard.sql}`).bind(keep, now, archive, ...guard.binds),
    retireDuplicates("vendor_id", "vendor"),
    projectContactMoveStatement(database, "vendor_id", "vendor", move, guard),
    database.prepare(`UPDATE vendors SET trade_docs_folder_id = coalesce(trade_docs_folder_id, (SELECT a.trade_docs_folder_id FROM vendors a WHERE a.id = ?)),
      trade_docs_bill_mode = coalesce(trade_docs_bill_mode, (SELECT a.trade_docs_bill_mode FROM vendors a WHERE a.id = ?)), updated_at = ? WHERE id = ? AND ${guard.sql}`)
      .bind(archive, archive, now, keep, ...guard.binds),
    database.prepare(`UPDATE vendors SET merged_into_vendor_id = ?, updated_at = ? WHERE merged_into_vendor_id = ? AND organization_id = ? AND ${guard.sql}`)
      .bind(keep, now, archive, move.organizationId, ...guard.binds)]
}

/** Archives the merged company. It runs last, so every guarded move before it still saw the source live. */
export function companyMarkMergedStatement(database: D1Database, move: CompanyReferenceMove): D1PreparedStatement {
  return database.prepare(move.side === "customer"
    ? "UPDATE customers SET merged_into_customer_id = ?, updated_at = ? WHERE id = ? AND organization_id = ? AND merged_into_customer_id IS NULL"
    : "UPDATE vendors SET merged_into_vendor_id = ?, directory_status = 'merged', updated_at = ? WHERE id = ? AND organization_id = ? AND merged_into_vendor_id IS NULL")
    .bind(move.destinationId, move.now, move.sourceId, move.organizationId)
}

/**
 * Compare-and-set of a person's portal account, then its audit row only when that update changed one row.
 * `guard` (a company move's guard) makes it part of a larger guarded batch, such as joining a client company.
 */
export function contactAccountLinkStatements(database: D1Database, input: {
  readonly kind: "client_person" | "vendor_person"; readonly organizationId: string; readonly personId: string
  readonly previousUserId: string | null; readonly nextUserId: string | null; readonly changedByUserId: string; readonly now: string
  readonly guard?: MergeGuard
}): D1PreparedStatement[] {
  const [people, parent] = input.kind === "client_person" ? ["customer_contacts", "customer"] : ["vendor_contacts", "vendor"]
  return [database.prepare(`UPDATE ${people} SET user_id = ?, updated_at = ?
      WHERE id = ? AND user_id IS ? AND ${parent}_id IN (SELECT id FROM ${parent}s WHERE organization_id = ?)${input.guard ? ` AND ${input.guard.sql}` : ""}`)
      .bind(input.nextUserId, input.now, input.personId, input.previousUserId, input.organizationId, ...(input.guard?.binds ?? [])),
    database.prepare(`INSERT INTO contact_account_link_events (id, organization_id, person_kind, person_id, previous_user_id,
      next_user_id, changed_by_user_id, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1`)
      .bind(crypto.randomUUID(), input.organizationId, input.kind, input.personId,
        input.previousUserId, input.nextUserId, input.changedByUserId, input.now)]
}

/** A client company's new person, added when a standalone client record joins it (join-client-company.ts); guarded like the join. */
export function clientCompanyJoinPersonStatement(database: D1Database, input: {
  readonly move: CompanyReferenceMove; readonly personId: string
  readonly person: { readonly name: string; readonly email: string | null; readonly phone: string | null; readonly isPrimary: boolean }
}): D1PreparedStatement {
  const guard = companyMoveGuard(input.move)
  const { person, move } = input
  return database.prepare(`INSERT INTO customer_contacts (id, customer_id, name, email, phone, is_primary, active, created_at, updated_at)
    SELECT ?, ?, ?, ?, ?, ?, 1, ?, ? WHERE ${guard.sql}`)
    .bind(input.personId, move.destinationId, person.name, person.email, person.phone, person.isPrimary ? 1 : 0, move.now, move.now, ...guard.binds)
}

/**
 * Joining a client company, before the company merge runs: the record's own
 * people move to the company, and every project contact of the record is
 * repointed to the company and its person `personId` by UPDATE (same ids, so
 * imported messages and invitations that point at them still do). Rows that
 * name another of the record's people keep that person; rows naming one of
 * `samePersonIds` (the record's own copies of this person) name `personId`.
 * Every statement is guarded: nothing happens unless the record is still
 * standalone and the company still live.
 */
export function clientCompanyJoinStatements(database: D1Database, input: {
  readonly move: CompanyReferenceMove; readonly personId: string; readonly samePersonIds: readonly string[]
  /** The company already has a primary person, so the record's own people join as non-primary. */
  readonly demotePrimary: boolean
}): D1PreparedStatement[] {
  const { move, personId, samePersonIds } = input
  const guard = companyMoveGuard(move)
  const { sourceId: record, destinationId: company, now } = move
  const same = samePersonIds.length > 0 ? ` OR customer_contact_id IN (${samePersonIds.map(() => "?").join(", ")})` : ""
  return [
    ...(input.demotePrimary ? [database.prepare(`UPDATE customer_contacts SET is_primary = 0, updated_at = ? WHERE customer_id = ? AND is_primary = 1 AND ${guard.sql}`)
      .bind(now, record, ...guard.binds)] : []),
    database.prepare(`UPDATE customer_contacts SET customer_id = ?, updated_at = ? WHERE customer_id = ? AND ${guard.sql}`).bind(company, now, record, ...guard.binds),
    // The record's own people are on the company now, so the scope trigger accepts every row here.
    database.prepare(`UPDATE project_contacts SET customer_id = ?,
        customer_contact_id = CASE WHEN customer_contact_id IS NULL${same} THEN ? ELSE customer_contact_id END,
        source_entity_id = CASE WHEN source_entity_type = 'customer' AND source_entity_id = ? THEN ? ELSE source_entity_id END,
        source_record_id = CASE WHEN source_entity_type = 'customer' AND source_record_id = ? THEN ? ELSE source_record_id END, updated_at = ?
      WHERE (customer_id = ? OR (customer_id IS NULL AND source_entity_type = 'customer' AND source_entity_id = ?)) AND ${guard.sql}`)
      .bind(company, ...samePersonIds, personId, record, company, record, company, now, record, record, ...guard.binds),
  ]
}
