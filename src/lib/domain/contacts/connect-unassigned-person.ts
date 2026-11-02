/**
 * "Connect to company…" on Contacts → Unassigned (owner decision 2026-11-02):
 * a person added from imported messages is tied to a vendor or client the
 * same way staff add a contact today.
 *
 * 1. The person on that company is reused when one already has the same
 *    name; otherwise it is added through the directory's own add path
 *    (`addVendorPerson` / `saveCustomerPerson`). A client whose own record is
 *    this person (same name) is used as is.
 * 2. Each of the person's imported project contacts is then linked to that
 *    directory person through the project contact save (`planProjectContactSave`
 *    / `commitProjectContactSave`), keeping its id, so every imported message
 *    that names it as sender still does. When the project already lists that
 *    person, the imported row is linked and archived instead of duplicated.
 *
 * Nothing is shared, invited or notified: portal visibility is left as the
 * import set it, and staff-only imported conversations stay staff-only.
 */
import { and, eq, isNull, ne, or } from "drizzle-orm"

import { customerContacts, customers, projectContacts, vendorContacts, vendors } from "@/db/schema"
import type { ActionFailure } from "@/lib/action-result"
import type { AuthUser } from "@/lib/auth"
import type { Db } from "@/lib/server/action-context"

import { addVendorPerson, saveCustomerPerson } from "./directory-people"
import { normalizeDirectoryKey } from "./rules"
import { commitProjectContactSave, planProjectContactSave } from "./save-contact"
import { updateProjectContactById } from "./store"
import type { ProjectContactMutationInput, ProjectContactType } from "./types"
import { unassignedPersonWhere } from "./unassigned-people"

export const CONNECT_COMPANY_KINDS = ["vendor", "customer"] as const
export type ConnectCompanyKind = (typeof CONNECT_COMPANY_KINDS)[number]

export type ConnectUnassignedInput = {
  readonly identity: string
  readonly kind: ConnectCompanyKind
  readonly companyId: string
}

export type ConnectUnassignedOutcome = {
  readonly companyName: string
  /** The directory person now linked; null when a client's own record is the person. */
  readonly personId: string | null
  readonly createdPerson: boolean
  readonly connected: readonly { readonly projectId: string; readonly contactId: string; readonly archivedDuplicate: boolean }[]
  readonly failed: readonly { readonly projectId: string; readonly error: string }[]
}

type Scope = { readonly db: Db; readonly user: AuthUser; readonly organizationId: string }

type ImportedContact = typeof projectContacts.$inferSelect

const fail = (error: string): ActionFailure => ({ success: false, error })

/** Every still-unassigned imported project contact for one person. */
async function loadUnassignedPersonContacts(
  db: Db,
  organizationId: string,
  identity: string
): Promise<readonly ImportedContact[]> {
  return db
    .select({ contact: projectContacts })
    .from(projectContacts)
    .where(and(
      unassignedPersonWhere(organizationId),
      // The Unassigned list keys a person by the importer's identity, or by
      // the contact id when the importer gave none.
      or(eq(projectContacts.sourceEntityId, identity), and(isNull(projectContacts.sourceEntityId), eq(projectContacts.id, identity))),
    ))
    .then((rows) => rows.map((row) => row.contact))
}

type CompanyPerson =
  | { readonly kind: "existing"; readonly personId: string | null }
  | { readonly kind: "new"; readonly isPrimary: boolean }

/**
 * The company, and who on it this person is: an active person with the same
 * name, the client record itself, or nobody yet. Names are compared as the
 * directory compares them (case, spacing and punctuation ignored). Email is
 * not used on its own: vendors often share one office address.
 */
async function resolveCompanyPerson(
  db: Db,
  input: { readonly organizationId: string; readonly kind: ConnectCompanyKind; readonly companyId: string; readonly name: string }
): Promise<{ readonly success: true; readonly companyName: string; readonly person: CompanyPerson } | ActionFailure> {
  const nameKey = normalizeDirectoryKey(input.name)
  if (input.kind === "vendor") {
    const vendor = await db
      .select({ id: vendors.id, name: vendors.name, category: vendors.category })
      .from(vendors)
      .where(and(eq(vendors.id, input.companyId), eq(vendors.organizationId, input.organizationId), eq(vendors.directoryStatus, "active")))
      .get()
    if (!vendor) return fail("Vendor company not found")
    if (vendor.category.trim().toLowerCase() === "internal") return fail("People cannot be connected to an internal directory record.")
    const people = await db
      .select({ id: vendorContacts.id, name: vendorContacts.name })
      .from(vendorContacts)
      .where(and(eq(vendorContacts.vendorId, vendor.id), eq(vendorContacts.active, true)))
    const same = people.find((person) => normalizeDirectoryKey(person.name) === nameKey)
    return {
      success: true,
      companyName: vendor.name,
      person: same ? { kind: "existing", personId: same.id } : { kind: "new", isPrimary: people.length === 0 },
    }
  }
  const customer = await db
    .select({ id: customers.id, name: customers.name, company: customers.company })
    .from(customers)
    .where(and(eq(customers.id, input.companyId), eq(customers.organizationId, input.organizationId), isNull(customers.mergedIntoCustomerId)))
    .get()
  if (!customer) return fail("Client was not found.")
  const companyName = customer.company?.trim() || customer.name
  if (normalizeDirectoryKey(customer.name) === nameKey) {
    return { success: true, companyName, person: { kind: "existing", personId: null } }
  }
  const people = await db
    .select({ id: customerContacts.id, name: customerContacts.name })
    .from(customerContacts)
    .where(and(eq(customerContacts.customerId, customer.id), eq(customerContacts.active, true)))
  const same = people.find((person) => normalizeDirectoryKey(person.name) === nameKey)
  return {
    success: true,
    companyName,
    person: same ? { kind: "existing", personId: same.id } : { kind: "new", isPrimary: people.length === 0 },
  }
}

function firstText(rows: readonly ImportedContact[], pick: (row: ImportedContact) => string | null): string {
  for (const row of rows) {
    const value = pick(row)?.trim()
    if (value) return value
  }
  return ""
}

/** The contact type a connected person gets: vendors keep subcontractor/supplier, clients are owners. */
function connectedContactType(kind: ConnectCompanyKind, current: ProjectContactType): ProjectContactType {
  if (kind === "customer") return "owner"
  return current === "supplier" ? "supplier" : "subcontractor"
}

/** The same save staff make when they pick a directory person for a project contact. */
function connectMutationInput(
  row: ImportedContact,
  link: { readonly kind: ConnectCompanyKind; readonly companyId: string; readonly personId: string | null }
): ProjectContactMutationInput {
  return {
    projectId: row.projectId,
    contactId: row.id,
    directorySourceType: link.kind,
    directorySourceId: link.companyId,
    vendorId: link.kind === "vendor" ? link.companyId : null,
    vendorContactId: link.kind === "vendor" ? link.personId : null,
    customerContactId: link.kind === "customer" ? link.personId : null,
    contactType: connectedContactType(link.kind, row.contactType),
    displayName: row.displayName,
    companyName: row.companyName ?? "",
    role: row.role ?? "",
    trade: row.trade ?? "",
    csiDivision: row.csiDivision ?? "",
    csiDivisionName: row.csiDivisionName ?? "",
    primaryCostCode: row.primaryCostCode ?? "",
    email: row.email ?? "",
    phone: row.phone ?? "",
    address: row.address ?? "",
    notes: row.notes ?? "",
    // Unchanged: connecting never shares anything with owners or vendors.
    ownerPortalVisible: row.ownerPortalVisible,
    subVendorPortalVisible: row.subVendorPortalVisible,
    internalVisible: row.internalVisible,
    primaryContact: row.primaryContact,
  }
}

/** Another active contact on the project that is already this directory person. */
async function projectAlreadyListsPerson(
  db: Db,
  row: ImportedContact,
  link: { readonly kind: ConnectCompanyKind; readonly companyId: string; readonly personId: string | null }
): Promise<boolean> {
  const samePerson =
    link.kind === "vendor"
      ? link.personId
        ? or(
            eq(projectContacts.vendorContactId, link.personId),
            and(eq(projectContacts.sourceEntityType, "vendor_contact"), eq(projectContacts.sourceEntityId, link.personId)),
          )
        : undefined
      : link.personId
        ? or(
            eq(projectContacts.customerContactId, link.personId),
            and(eq(projectContacts.sourceEntityType, "customer_contact"), eq(projectContacts.sourceEntityId, link.personId)),
          )
        : and(eq(projectContacts.sourceEntityType, "customer"), eq(projectContacts.sourceEntityId, link.companyId))
  if (!samePerson) return false
  const other = await db
    .select({ id: projectContacts.id })
    .from(projectContacts)
    .where(and(eq(projectContacts.projectId, row.projectId), ne(projectContacts.id, row.id), eq(projectContacts.active, true), samePerson))
    .limit(1)
    .get()
  return Boolean(other)
}

export async function connectUnassignedPerson(
  scope: Scope,
  input: ConnectUnassignedInput
): Promise<{ readonly success: true; readonly data: ConnectUnassignedOutcome } | ActionFailure> {
  const { db, organizationId } = scope
  const rows = await loadUnassignedPersonContacts(db, organizationId, input.identity)
  const first = rows[0]
  if (!first) return fail("This person is already connected to a company.")
  const name = first.displayName
  const resolved = await resolveCompanyPerson(db, { organizationId, kind: input.kind, companyId: input.companyId, name })
  if (!resolved.success) return resolved

  const now = new Date().toISOString()
  let personId: string | null
  let createdPerson = false
  if (resolved.person.kind === "existing") {
    personId = resolved.person.personId
  } else {
    const person = {
      name,
      title: "",
      email: firstText(rows, (row) => row.email),
      phone: firstText(rows, (row) => row.phone),
      isPrimary: resolved.person.isPrimary,
    }
    const added =
      input.kind === "vendor"
        ? await addVendorPerson(db, { organizationId, vendorId: input.companyId, person, now })
        : await saveCustomerPerson(db, { organizationId, customerId: input.companyId, personId: null, person, now })
    if (!added.success) return added
    personId = "contact" in added ? added.contact.id : added.id
    createdPerson = true
  }

  const link = { kind: input.kind, companyId: input.companyId, personId }
  const connected: ConnectUnassignedOutcome["connected"][number][] = []
  const failed: ConnectUnassignedOutcome["failed"][number][] = []
  for (const row of rows) {
    if (await projectAlreadyListsPerson(db, row, link)) {
      // Keep the row (imported messages name it as sender), linked to the
      // same person, but archived so the project does not list them twice.
      await updateProjectContactById(db, {
        contactId: row.id,
        values: {
          vendorId: input.kind === "vendor" ? input.companyId : null,
          vendorContactId: input.kind === "vendor" ? personId : null,
          customerId: input.kind === "customer" ? input.companyId : null,
          customerContactId: input.kind === "customer" ? personId : null,
          companyName: resolved.companyName,
          active: false,
          primaryContact: false,
          updatedAt: now,
        },
      })
      connected.push({ projectId: row.projectId, contactId: row.id, archivedDuplicate: true })
      continue
    }
    const planned = await planProjectContactSave(scope, connectMutationInput(row, link))
    if (!planned.success) {
      failed.push({ projectId: row.projectId, error: planned.error })
      continue
    }
    // Imported people were never invited; a pending invitation would need
    // the project contact editor, which revokes it with WorkOS.
    if (planned.plan.pendingInvitations.length > 0) {
      failed.push({ projectId: row.projectId, error: "This contact has a pending invitation. Connect it from the project's contacts." })
      continue
    }
    await commitProjectContactSave(db, { organizationId, plan: planned.plan })
    connected.push({ projectId: row.projectId, contactId: row.id, archivedDuplicate: false })
  }
  return { success: true, data: { companyName: resolved.companyName, personId, createdPerson, connected, failed } }
}
