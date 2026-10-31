/**
 * Saving a project contact: an assignment of a directory person or company
 * to a project, plus project-only fields (role, trade, CSI division, notes,
 * portal visibility).
 *
 * Identity (name, company, email, phone, address) belongs to the directory
 * record the contact links to. The project form shows it read-only for a
 * linked contact, and the server ignores any identity it echoes back, so
 * there is no per-project identity override. Directory edits happen in
 * Contacts (and, for Sage-linked records, through Sage review). The copied
 * columns are still refreshed here for readers outside the contacts area.
 */
import { and, eq, inArray, isNull, or } from "drizzle-orm"

import {
  customerContacts,
  customers,
  internalContacts,
  organizationMembers,
  projectAccessInvitations,
  projectContacts,
  projectMembers,
  users,
  vendorContacts,
  vendors,
} from "@/db/schema"
import type { ActionFailure } from "@/lib/action-result"
import type { AuthUser } from "@/lib/auth"
import { directoryIdentityManagedByActiveUser, type ContactIdentityFields } from "@/lib/contact-identity-ownership"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import {
  isCanonicalDirectoryAssignment,
  isSameProjectContactDirectoryIdentity,
  isUnchangedProjectContactDirectorySelection,
  resolveProjectContactIdentity,
  resolveProjectContactMutationIdentity,
} from "@/lib/project-contact-directory-identity"
import { projectContactAddress } from "@/lib/project-contact-privacy"
import type { Db } from "@/lib/server/action-context"
import { cleanText } from "@/lib/shared/guards"

import { normalizeEmailKey } from "./rules"
import {
  clearProjectPrimaryContact,
  insertProjectContact,
  updateProjectContact,
  writeProjectIdentityToDirectory,
} from "./store"
import type { ProjectContactMutationInput, ProjectContactType } from "./types"

type LinkState = {
  readonly sourceSystem: string
  readonly sourceRecordId: string | null
  readonly sourceEntityType: string
  readonly sourceEntityId: string | null
  readonly vendorId: string | null
  readonly vendorContactId: string | null
  readonly customerId: string | null
  readonly customerContactId: string | null
  readonly internalContactId: string | null
  readonly syncStatus: string
}

type Selection = {
  readonly link: LinkState
  readonly linkedInternalUserId: string | null
  readonly directoryIdentity: ContactIdentityFields | null
  readonly directoryIdentityManaged: boolean
  readonly canonicalDisplayName: string | null
  readonly canonicalCompanyName: string | null
}

type ContactValues = {
  readonly contactType: ProjectContactType
  readonly displayName: string
  readonly companyName: string | null
  readonly role: string | null
  readonly trade: string | null
  readonly csiDivision: string | null
  readonly csiDivisionName: string | null
  readonly primaryCostCode: string | null
  readonly email: string | null
  readonly phone: string | null
  readonly address: string | null
  readonly notes: string | null
  readonly ownerPortalVisible: boolean
  readonly subVendorPortalVisible: boolean
  readonly internalVisible: boolean
  readonly primaryContact: boolean
  readonly active: boolean
  readonly updatedAt: string
}

export type PendingInvitation = { readonly id: string; readonly workosInvitationId: string | null }

/** Everything the save will write, decided before anything is written. */
export type ProjectContactSavePlan = {
  readonly projectId: string
  /** null inserts a new contact. */
  readonly contactId: string | null
  readonly link: LinkState
  readonly values: ContactValues
  readonly directoryIdentityManaged: boolean
  readonly primaryContact: boolean
  /** Sent invitations to revoke because the contact's email changed. */
  readonly pendingInvitations: readonly PendingInvitation[]
  readonly now: string
}

type Scope = { readonly db: Db; readonly user: AuthUser; readonly organizationId: string }

const fail = (error: string): ActionFailure => ({ success: false, error })

const MANAGED_IDENTITY_ERROR =
  "Phone, email, and address are managed by this active Compass user. You can still update their project role and visibility."

/** Validation that needs no database. */
export function projectContactInputError(input: ProjectContactMutationInput): string | null {
  const requiresVendorCompany = input.contactType === "subcontractor" || input.contactType === "supplier"
  if (requiresVendorCompany && (input.directorySourceType !== "vendor" || !input.directorySourceId)) {
    return "Choose a vendor company for this project contact."
  }
  if (input.contactType === "owner" && input.directorySourceType !== null && input.directorySourceType !== "customer") {
    return "Choose a client or lead contact."
  }
  if (input.contactType === "internal" && input.directorySourceType !== null && input.directorySourceType !== "team") {
    return "Choose an internal directory contact."
  }
  return null
}

function unselectedLink(input: ProjectContactMutationInput): Selection {
  return {
    link: {
      sourceSystem: "compass",
      sourceRecordId: null,
      sourceEntityType: "manual",
      sourceEntityId: null,
      vendorId: input.vendorId,
      vendorContactId: input.vendorContactId,
      customerId: null,
      customerContactId: null,
      internalContactId: null,
      syncStatus: "manual",
    },
    linkedInternalUserId: null,
    directoryIdentity: null,
    directoryIdentityManaged: false,
    canonicalDisplayName: null,
    canonicalCompanyName: null,
  }
}

async function selectCustomer(
  { db, organizationId }: Scope,
  input: ProjectContactMutationInput,
  sourceId: string
): Promise<Selection | ActionFailure> {
  const [directoryRecord] = await db
    .select({
      id: customers.id,
      name: customers.name,
      company: customers.company,
      email: customers.email,
      phone: customers.phone,
      address: customers.address,
    })
    .from(customers)
    .where(and(eq(customers.id, sourceId), eq(customers.organizationId, organizationId), isNull(customers.mergedIntoCustomerId)))
    .limit(1)
  if (!directoryRecord) return fail("Customer directory record not found")
  const link: LinkState = {
    sourceSystem: "customer_directory",
    sourceRecordId: sourceId,
    sourceEntityType: "customer",
    sourceEntityId: sourceId,
    vendorId: null,
    vendorContactId: null,
    customerId: directoryRecord.id,
    customerContactId: input.customerContactId,
    internalContactId: null,
    syncStatus: "manual",
  }
  if (!input.customerContactId) {
    return {
      link,
      linkedInternalUserId: null,
      directoryIdentity: directoryRecord,
      directoryIdentityManaged: true,
      canonicalDisplayName: directoryRecord.name,
      canonicalCompanyName: directoryRecord.company,
    }
  }
  const person = await db
    .select({
      id: customerContacts.id,
      name: customerContacts.name,
      email: customerContacts.email,
      phone: customerContacts.phone,
    })
    .from(customerContacts)
    .where(
      and(
        eq(customerContacts.id, input.customerContactId),
        eq(customerContacts.customerId, directoryRecord.id),
        eq(customerContacts.active, true)
      )
    )
    .get()
  if (!person) return fail("Client contact not found")
  return {
    link: { ...link, sourceRecordId: person.id, sourceEntityType: "customer_contact", sourceEntityId: person.id },
    linkedInternalUserId: null,
    directoryIdentity: { ...person, address: directoryRecord.address },
    directoryIdentityManaged: true,
    canonicalDisplayName: person.name,
    canonicalCompanyName: directoryRecord.company,
  }
}

async function selectVendor(
  { db, organizationId }: Scope,
  input: ProjectContactMutationInput,
  sourceId: string
): Promise<Selection | ActionFailure> {
  const [directoryRecord] = await db
    .select({
      id: vendors.id,
      name: vendors.name,
      syncStatus: vendors.syncStatus,
      email: vendors.email,
      phone: vendors.phone,
      address: vendors.address,
    })
    .from(vendors)
    .where(and(eq(vendors.id, sourceId), eq(vendors.organizationId, organizationId), eq(vendors.directoryStatus, "active")))
    .limit(1)
  if (!directoryRecord) return fail("Vendor directory record not found")
  const link: LinkState = {
    sourceSystem: "global_directory",
    sourceRecordId: directoryRecord.id,
    sourceEntityType: "vendor",
    sourceEntityId: directoryRecord.id,
    vendorId: directoryRecord.id,
    vendorContactId: input.vendorContactId,
    customerId: null,
    customerContactId: null,
    internalContactId: null,
    syncStatus: directoryRecord.syncStatus,
  }
  if (!input.vendorContactId) {
    return {
      link,
      linkedInternalUserId: null,
      directoryIdentity: directoryRecord,
      directoryIdentityManaged: true,
      canonicalDisplayName: directoryRecord.name,
      canonicalCompanyName: directoryRecord.name,
    }
  }
  const contactRecord = await db
    .select({
      id: vendorContacts.id,
      name: vendorContacts.name,
      email: vendorContacts.email,
      phone: vendorContacts.phone,
    })
    .from(vendorContacts)
    .where(
      and(
        eq(vendorContacts.id, input.vendorContactId),
        eq(vendorContacts.vendorId, directoryRecord.id),
        eq(vendorContacts.active, true)
      )
    )
    .get()
  if (!contactRecord) return fail("Vendor contact not found")
  return {
    link: {
      ...link,
      sourceRecordId: contactRecord.id,
      sourceEntityType: "vendor_contact",
      sourceEntityId: contactRecord.id,
    },
    linkedInternalUserId: null,
    directoryIdentity: { ...contactRecord, address: null },
    directoryIdentityManaged: true,
    canonicalDisplayName: contactRecord.name,
    canonicalCompanyName: directoryRecord.name,
  }
}

async function selectInternal({ db, organizationId }: Scope, sourceId: string): Promise<Selection | ActionFailure> {
  const [directoryRecord] = await db
    .select({
      id: internalContacts.id,
      userId: internalContacts.userId,
      name: internalContacts.name,
      email: internalContacts.email,
      phone: internalContacts.phone,
    })
    .from(internalContacts)
    .where(
      and(
        eq(internalContacts.organizationId, organizationId),
        or(eq(internalContacts.id, sourceId), eq(internalContacts.userId, sourceId)),
        eq(internalContacts.active, true)
      )
    )
    .limit(1)
  if (!directoryRecord) return fail("Internal directory contact not found")
  return {
    link: {
      sourceSystem: "internal_directory",
      sourceRecordId: directoryRecord.id,
      sourceEntityType: "internal_contact",
      sourceEntityId: directoryRecord.id,
      vendorId: null,
      vendorContactId: null,
      customerId: null,
      customerContactId: null,
      internalContactId: directoryRecord.id,
      syncStatus: "manual",
    },
    linkedInternalUserId: directoryRecord.userId,
    directoryIdentity: { ...directoryRecord, address: null },
    directoryIdentityManaged: true,
    canonicalDisplayName: directoryRecord.name,
    canonicalCompanyName: null,
  }
}

/**
 * The chosen directory record, checked against the caller's directory
 * grant (only when the selection changes), plus the existing project
 * contact it is already assigned as, if any.
 */
async function resolveDirectorySelection(
  scope: Scope,
  input: ProjectContactMutationInput
): Promise<{ readonly selection: Selection; readonly contactId: string | null } | ActionFailure> {
  const { db, user } = scope
  if (!input.directorySourceType || !input.directorySourceId) {
    return { selection: unselectedLink(input), contactId: input.contactId }
  }
  const directoryFeature =
    input.directorySourceType === "customer"
      ? "customers"
      : input.directorySourceType === "vendor"
        ? "vendors"
        : "internal-directory"
  const existingSelection = input.contactId
    ? await db
        .select({
          sourceEntityType: projectContacts.sourceEntityType,
          sourceEntityId: projectContacts.sourceEntityId,
          customerId: projectContacts.customerId,
          customerContactId: projectContacts.customerContactId,
          vendorId: projectContacts.vendorId,
          vendorContactId: projectContacts.vendorContactId,
          internalContactId: projectContacts.internalContactId,
        })
        .from(projectContacts)
        .where(and(eq(projectContacts.id, input.contactId), eq(projectContacts.projectId, input.projectId)))
        .get()
    : null
  const unchangedDirectorySelection = isUnchangedProjectContactDirectorySelection(existingSelection ?? null, {
    sourceType: input.directorySourceType,
    sourceId: input.directorySourceId,
    customerContactId: input.customerContactId,
    vendorContactId: input.vendorContactId,
  })
  // Existing project assignments are editable without org-wide directory
  // browsing. Selecting or changing a directory identity still needs it.
  if (!unchangedDirectorySelection) {
    await requireFeaturePermission(user, directoryFeature, "read")
  }

  const selected =
    input.directorySourceType === "customer"
      ? await selectCustomer(scope, input, input.directorySourceId)
      : input.directorySourceType === "vendor"
        ? await selectVendor(scope, input, input.directorySourceId)
        : await selectInternal(scope, input.directorySourceId)
  if ("success" in selected) return selected
  const { link, linkedInternalUserId } = selected
  if (!link.sourceEntityId) return fail("Directory contact not found")

  const [existingContact] = await db
    .select({ id: projectContacts.id, active: projectContacts.active })
    .from(projectContacts)
    .where(
      and(
        eq(projectContacts.projectId, input.projectId),
        or(
          and(eq(projectContacts.sourceEntityType, link.sourceEntityType), eq(projectContacts.sourceEntityId, link.sourceEntityId)),
          ...(link.internalContactId
            ? [
                eq(projectContacts.internalContactId, link.internalContactId),
                ...(linkedInternalUserId
                  ? [and(eq(projectContacts.sourceEntityType, "user"), eq(projectContacts.sourceEntityId, linkedInternalUserId))]
                  : []),
              ]
            : []),
          ...(link.customerContactId ? [eq(projectContacts.customerContactId, link.customerContactId)] : [])
        )
      )
    )
    .limit(1)
  if (existingContact?.active && existingContact.id !== input.contactId) {
    return fail("This contact is already on the project")
  }
  // An inactive assignment of the same person is reactivated, not duplicated.
  return { selection: selected, contactId: input.contactId || existingContact?.id || null }
}

function contactValuesFor(input: ProjectContactMutationInput, selection: Selection, now: string): ContactValues {
  const values: ContactValues = {
    contactType: input.contactType,
    displayName: selection.canonicalDisplayName ?? input.displayName.trim(),
    companyName: selection.canonicalCompanyName ?? cleanText(input.companyName),
    role: cleanText(input.role),
    trade: cleanText(input.trade),
    csiDivision: cleanText(input.csiDivision),
    csiDivisionName: cleanText(input.csiDivisionName),
    primaryCostCode: cleanText(input.primaryCostCode),
    email: cleanText(input.email),
    phone: cleanText(input.phone),
    address: projectContactAddress(input.contactType, cleanText(input.address)),
    notes: cleanText(input.notes),
    ownerPortalVisible: input.ownerPortalVisible,
    subVendorPortalVisible: input.subVendorPortalVisible,
    internalVisible: input.internalVisible,
    primaryContact: input.primaryContact,
    active: true,
    updatedAt: now,
  }
  // Project contacts are assignments. A selected directory identity is
  // canonical, including intentionally blank fields; never use the form's
  // echoed values to edit the shared person or company record.
  if (selection.directoryIdentityManaged && selection.directoryIdentity) {
    return { ...values, ...resolveProjectContactIdentity(values, selection.directoryIdentity, true) }
  }
  return values
}

type ExistingContact = {
  readonly id: string
  readonly email: string | null
  readonly phone: string | null
  readonly address: string | null
  readonly sourceEntityType: string
  readonly sourceEntityId: string | null
  readonly customerContactId: string | null
  readonly vendorContactId: string | null
}

/**
 * Who owns this contact's email, phone and address. A contact whose
 * identity belongs to an active Compass user (accepted invitation, project
 * membership, or a directory record that user manages) cannot have it
 * changed from a project. Returns the invitations to revoke when the email
 * changes.
 */
async function identityChangeGate(
  scope: Scope,
  input: {
    readonly projectId: string
    readonly contactId: string
    readonly existing: ExistingContact
    readonly values: ContactValues
    readonly managedExistingIdentity: boolean
  }
): Promise<{ readonly pendingInvitations: readonly PendingInvitation[] } | ActionFailure> {
  const { db, organizationId: orgId } = scope
  const { existing, values, managedExistingIdentity, projectId, contactId } = input
  const existingEmail = normalizeEmailKey(existing.email)
  const updatedEmail = values.email?.toLowerCase() ?? ""
  const identityChanged =
    existingEmail !== updatedEmail ||
    (existing.phone?.trim() ?? "") !== (values.phone ?? "") ||
    (existing.address?.trim() ?? "") !== (values.address ?? "")
  if (!identityChanged) return { pendingInvitations: [] }

  const existingDirectoryEntityType = existing.customerContactId
    ? "customer_contact"
    : existing.vendorContactId
      ? "vendor_contact"
      : existing.sourceEntityType === "customer" || existing.sourceEntityType === "vendor"
        ? existing.sourceEntityType
        : null
  const existingDirectoryEntityId = existing.customerContactId ?? existing.vendorContactId ?? existing.sourceEntityId
  if (
    !managedExistingIdentity &&
    existingDirectoryEntityType &&
    existingDirectoryEntityId &&
    (await directoryIdentityManagedByActiveUser({
      db,
      organizationId: orgId,
      entityType: existingDirectoryEntityType,
      entityId: existingDirectoryEntityId,
    }))
  ) {
    return fail(MANAGED_IDENTITY_ERROR)
  }
  const [activeInvitationRows, organizationUserRows] = await Promise.all([
    db
      .select({ userId: users.id })
      .from(projectAccessInvitations)
      .innerJoin(users, eq(users.id, projectAccessInvitations.acceptedBy))
      .where(
        and(
          eq(projectAccessInvitations.projectId, projectId),
          eq(projectAccessInvitations.projectContactId, contactId),
          eq(projectAccessInvitations.status, "accepted"),
          eq(users.isActive, true)
        )
      ),
    db
      .select({ id: users.id, email: users.email })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(and(eq(organizationMembers.organizationId, orgId), eq(users.isActive, true))),
  ])
  const linkedUserIds = new Set<string>()
  if (existing.sourceEntityType === "user" && existing.sourceEntityId) linkedUserIds.add(existing.sourceEntityId)
  if (existingEmail) {
    for (const organizationUser of organizationUserRows) {
      if (normalizeEmailKey(organizationUser.email) === existingEmail) linkedUserIds.add(organizationUser.id)
    }
  }
  const linkedUserIdList = Array.from(linkedUserIds)
  const linkedMembership =
    linkedUserIdList.length > 0
      ? await db
          .select({ id: projectMembers.id })
          .from(projectMembers)
          .where(and(eq(projectMembers.projectId, projectId), inArray(projectMembers.userId, linkedUserIdList)))
          .limit(1)
      : []
  if (!managedExistingIdentity && (activeInvitationRows.length > 0 || linkedMembership.length > 0)) {
    return fail(MANAGED_IDENTITY_ERROR)
  }
  if (existingEmail === updatedEmail) return { pendingInvitations: [] }

  const pendingInvitations = await db
    .select({ id: projectAccessInvitations.id, workosInvitationId: projectAccessInvitations.workosInvitationId })
    .from(projectAccessInvitations)
    .where(
      and(
        eq(projectAccessInvitations.projectId, projectId),
        eq(projectAccessInvitations.projectContactId, contactId),
        eq(projectAccessInvitations.status, "sent")
      )
    )
  return { pendingInvitations }
}

/** Editing an existing contact: keep its link unless a new one was chosen. */
async function planExistingContactUpdate(
  scope: Scope,
  input: ProjectContactMutationInput,
  contactId: string,
  selection: Selection,
  baseValues: ContactValues
): Promise<{ readonly link: LinkState; readonly values: ContactValues; readonly managed: boolean; readonly pendingInvitations: readonly PendingInvitation[] } | ActionFailure> {
  const { db, organizationId: orgId } = scope
  const [existing] = await db
    .select({
      id: projectContacts.id,
      email: projectContacts.email,
      phone: projectContacts.phone,
      address: projectContacts.address,
      sourceEntityType: projectContacts.sourceEntityType,
      sourceEntityId: projectContacts.sourceEntityId,
      sourceSystem: projectContacts.sourceSystem,
      sourceRecordId: projectContacts.sourceRecordId,
      syncStatus: projectContacts.syncStatus,
      vendorId: projectContacts.vendorId,
      vendorContactId: projectContacts.vendorContactId,
      customerId: projectContacts.customerId,
      customerContactId: projectContacts.customerContactId,
      internalContactId: projectContacts.internalContactId,
    })
    .from(projectContacts)
    .where(and(eq(projectContacts.id, contactId), eq(projectContacts.projectId, input.projectId)))
    .limit(1)
  if (!existing) return fail("Project contact not found")

  const keepExistingLink = !input.directorySourceType
  const link: LinkState = keepExistingLink
    ? {
        sourceSystem: existing.sourceSystem,
        sourceRecordId: existing.sourceRecordId,
        sourceEntityType: existing.sourceEntityType,
        sourceEntityId: existing.sourceEntityId,
        vendorId: existing.vendorId,
        vendorContactId: existing.vendorContactId,
        customerId: existing.customerId,
        customerContactId: existing.customerContactId,
        internalContactId: existing.internalContactId,
        syncStatus: existing.syncStatus,
      }
    : selection.link
  const managed = keepExistingLink ? isCanonicalDirectoryAssignment(existing) : selection.directoryIdentityManaged
  const sameDirectoryIdentity = isSameProjectContactDirectoryIdentity(existing, link)
  let values: ContactValues = {
    ...baseValues,
    ...resolveProjectContactMutationIdentity({
      submittedIdentity: baseValues,
      existingIdentity: sameDirectoryIdentity ? existing : null,
      directoryIdentity: selection.directoryIdentity,
      managedByDirectory: managed,
    }),
  }
  if (link.customerContactId) {
    const person = await db
      .select({ email: customerContacts.email, phone: customerContacts.phone, address: customers.address })
      .from(customerContacts)
      .innerJoin(customers, eq(customers.id, customerContacts.customerId))
      .where(
        and(
          eq(customerContacts.id, link.customerContactId),
          eq(customers.id, link.customerId ?? ""),
          eq(customers.organizationId, orgId),
          eq(customerContacts.active, true)
        )
      )
      .get()
    if (!person) return fail("Client directory contact not found")
    values = { ...values, ...resolveProjectContactIdentity(values, person, true) }
  }
  const gate = await identityChangeGate(scope, {
    projectId: input.projectId,
    contactId,
    existing,
    values,
    managedExistingIdentity: managed && sameDirectoryIdentity,
  })
  if ("success" in gate) return gate
  return { link, values, managed, pendingInvitations: gate.pendingInvitations }
}

/** Decide every write for a save, or the first reason it cannot happen. */
export async function planProjectContactSave(
  scope: Scope,
  input: ProjectContactMutationInput
): Promise<{ readonly success: true; readonly plan: ProjectContactSavePlan } | ActionFailure> {
  const now = new Date().toISOString()
  const resolved = await resolveDirectorySelection(scope, input)
  if ("success" in resolved) return resolved
  const { selection, contactId } = resolved
  const values = contactValuesFor(input, selection, now)
  const base = { projectId: input.projectId, primaryContact: input.primaryContact, now }

  if (!contactId) {
    return {
      success: true,
      plan: {
        ...base,
        contactId: null,
        link: selection.link,
        values,
        directoryIdentityManaged: selection.directoryIdentityManaged,
        pendingInvitations: [],
      },
    }
  }
  const update = await planExistingContactUpdate(scope, input, contactId, selection, values)
  if ("success" in update) return update
  return {
    success: true,
    plan: {
      ...base,
      contactId,
      link: update.link,
      values: update.values,
      directoryIdentityManaged: update.managed,
      pendingInvitations: update.pendingInvitations,
    },
  }
}

/** Write a planned save. Returns the saved contact's id. */
export async function commitProjectContactSave(
  db: Db,
  input: { readonly organizationId: string; readonly plan: ProjectContactSavePlan }
): Promise<string> {
  const { plan } = input
  const { link, values } = plan
  if (plan.primaryContact) {
    await clearProjectPrimaryContact(db, { projectId: plan.projectId, contactType: values.contactType, now: plan.now })
  }
  let contactId = plan.contactId
  if (contactId) {
    await updateProjectContact(db, { projectId: plan.projectId, contactId, values: { ...values, ...link } })
  } else {
    contactId = crypto.randomUUID()
    await insertProjectContact(db, {
      id: contactId,
      projectId: plan.projectId,
      ...link,
      sortOrder: 800,
      lastSyncedAt: null,
      createdAt: plan.now,
      ...values,
    })
  }

  // Identity typed on a contact that no directory link manages is written to
  // the record it names. Linked contacts are edited in Contacts instead.
  if (!plan.directoryIdentityManaged) {
    const identity = { email: values.email, phone: values.phone, address: values.address, updatedAt: plan.now }
    const target =
      link.sourceEntityType === "customer" && link.sourceEntityId
        ? { kind: "customer" as const, customerId: link.sourceEntityId }
        : link.vendorContactId
          ? { kind: "vendor_contact" as const, vendorContactId: link.vendorContactId }
          : link.vendorId
            ? { kind: "vendor" as const, vendorId: link.vendorId }
            : null
    if (target) {
      await writeProjectIdentityToDirectory(db, {
        organizationId: input.organizationId,
        target,
        displayName: values.displayName,
        identity,
      })
    }
  }
  return contactId
}
