"use server"

import { eq, and, asc, desc } from "drizzle-orm"
import {
  internalContacts,
  organizationMembers,
  users,
  vendorContacts,
  vendors,
} from "@/db/schema"
import { requirePermission } from "@/lib/permissions"
import { removeArchivedPeopleFromJobs } from "@/lib/domain/contacts/person-archive"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { revalidatePath } from "next/cache"
import {
  clearVendorPrimaryPeople,
  deactivateVendorPeople,
  deleteVendor as deleteVendorRecord,
  insertVendor,
  insertVendorPeople,
  insertVendorPersonStatement,
  syncVendorCompanyCopies,
  syncVendorPersonCopiesStatement,
  updateVendor as updateVendorRecord,
  updateVendorPersonStatement,
} from "@/lib/domain/contacts/store"
import { requireOrg } from "@/lib/org-scope"
import { isDemoUser } from "@/lib/demo"
import { recordActivityEvent } from "@/lib/activity-log"
import type { AuthUser } from "@/lib/auth"
import {
  internalPersonAccountState,
  stalePendingInvitationCount,
  stalePendingInvitationWarning,
} from "@/lib/domain/contacts/pending-invitations"
import type { Db } from "@/lib/server/action-context"
import {
  contactEmailChanged,
  directoryIdentityManagedByActiveUser,
  SIGN_IN_EMAIL_LOCK,
} from "@/lib/contact-identity-ownership"
import {
  changesSageLinkedVendorIdentity,
  sageLinkedVendorPeopleChangeError,
} from "@/lib/sage/contact-edit-gate"
import { userRoleLabel } from "@/lib/user-roles"
import { sageVendorTypeCategoryError, vendorCategoryFromSage } from "@/lib/sage/vendor-category-lock"
import { requireUserContext } from "@/lib/server/action-context"
import type { VendorContactItem, VendorDirectoryCompany } from "@/lib/domain/contacts/directory-page"
import { addVendorPerson } from "@/lib/domain/contacts/directory-people"

export type InternalDirectoryContact = {
  readonly id: string
  readonly name: string
  readonly company: string | null
  readonly role: string | null
  readonly jobTitle: string | null
  readonly email: string | null
  readonly phone: string | null
  readonly cellPhone: string | null
  readonly sourceLabel: string
  readonly accessStatus: "active" | "invited" | "no_access"
  /** Accepted a Compass invitation: they own their contact information. */
  readonly accountHolder: boolean
  readonly linkedToUser: boolean
  readonly active: boolean
  readonly sageEmployeeId: string | null
  readonly sageEmployeeNumber: string | null
}

export type VendorContactMutationInput = {
  readonly id: string | null
  readonly name: string
  readonly title: string
  readonly email: string
  readonly phone: string
  readonly isPrimary: boolean
}

export type VendorCompanyMutationInput = {
  readonly name: string
  readonly category: string
  readonly email: string
  readonly phone: string
  readonly address: string
  readonly contacts?: readonly VendorContactMutationInput[]
}

export type VendorCompanyUpdateInput = {
  readonly name?: string
  readonly category?: string
  readonly email?: string | null
  readonly phone?: string | null
  readonly address?: string | null
  readonly contacts?: readonly VendorContactMutationInput[]
}

export type VendorMutationResult =
  | { readonly success: true; readonly id: string }
  | { readonly success: false; readonly error: string }

export type VendorUpdateResult =
  | { readonly success: true; readonly warning?: string }
  | { readonly success: false; readonly error: string }

export type VendorContactMutationResult =
  | { readonly success: true; readonly contact: VendorContactItem }
  | { readonly success: false; readonly error: string }

function nullableText(value: string): string | null {
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function nullableOptionalText(value: string | null | undefined): string | null {
  return value ? nullableText(value) : null
}

function normalizedContactInputs(
  contacts: readonly VendorContactMutationInput[],
  options: { readonly assignPrimary: boolean } = { assignPrimary: true }
): readonly VendorContactMutationInput[] {
  const normalized = contacts
    .map((contact) => ({
      ...contact,
      name: contact.name.trim(),
      title: contact.title.trim(),
      email: contact.email.trim().toLowerCase(),
      phone: contact.phone.trim(),
    }))
    .filter((contact) => contact.name.length > 0)
  const primaryIndex = normalized.findIndex((contact) => contact.isPrimary)
  if (!options.assignPrimary) {
    return normalized.map((contact, index) => ({ ...contact, isPrimary: index === primaryIndex }))
  }

  return normalized.map((contact, index) => ({
    ...contact,
    isPrimary: primaryIndex >= 0 ? index === primaryIndex : index === 0,
  }))
}

export async function getVendors(): Promise<VendorDirectoryCompany[]> {
  const { user, db } = await requireUserContext()
  await requireFeaturePermission(user, "vendors", "read")
  const orgId = requireOrg(user)

  const [vendorRows, contactRows] = await Promise.all([
    db
      .select()
      .from(vendors)
      .where(
        and(
          eq(vendors.organizationId, orgId),
          eq(vendors.directoryStatus, "active")
        )
      )
      .orderBy(asc(vendors.name)),
    db
      .select({
        id: vendorContacts.id,
        vendorId: vendorContacts.vendorId,
        name: vendorContacts.name,
        title: vendorContacts.title,
        email: vendorContacts.email,
        phone: vendorContacts.phone,
        isPrimary: vendorContacts.isPrimary,
        active: vendorContacts.active,
        sourceSystem: vendorContacts.sourceSystem,
        userId: vendorContacts.userId,
        sageContactId: vendorContacts.sageContactId,
        sageLineNumber: vendorContacts.sageLineNumber,
      })
      .from(vendorContacts)
      .innerJoin(vendors, eq(vendors.id, vendorContacts.vendorId))
      .where(
        and(
          eq(vendors.organizationId, orgId),
          eq(vendors.directoryStatus, "active"),
          eq(vendorContacts.active, true)
        )
      )
      .orderBy(
        asc(vendorContacts.vendorId),
        desc(vendorContacts.isPrimary),
        asc(vendorContacts.name)
      ),
  ])
  const contactsByVendor = new Map<string, VendorContactItem[]>()
  for (const contact of contactRows) {
    const current = contactsByVendor.get(contact.vendorId) ?? []
    current.push(contact)
    contactsByVendor.set(contact.vendorId, current)
  }

  return vendorRows.map((vendor) => ({
    ...vendor,
    contacts: contactsByVendor.get(vendor.id) ?? [],
  }))
}

/** Active internal people, or with `archived` the archived ones (such as people imported from Buildertrend). */
export async function getInternalDirectoryContacts(
  options: { readonly archived?: boolean } = {}
): Promise<readonly InternalDirectoryContact[]> {
  const { user, db } = await requireUserContext()
  await requireFeaturePermission(user, "internal-directory", "read")
  const orgId = requireOrg(user)

  const directoryRows = await db
    .select({
      id: internalContacts.id,
      name: internalContacts.name,
      jobTitle: internalContacts.jobTitle,
      email: internalContacts.email,
      phone: internalContacts.phone,
      cellPhone: internalContacts.cellPhone,
      sourceSystem: internalContacts.sourceSystem,
      sageEmployeeId: internalContacts.sageEmployeeId,
      sageEmployeeNumber: internalContacts.sageEmployeeNumber,
      userActive: users.isActive,
      userId: users.id,
      lastLoginAt: users.lastLoginAt,
      membershipRole: organizationMembers.role,
    })
    .from(internalContacts)
    .leftJoin(users, eq(users.id, internalContacts.userId))
    .leftJoin(
      organizationMembers,
      and(
        eq(organizationMembers.userId, internalContacts.userId),
        eq(organizationMembers.organizationId, orgId)
      )
    )
    .where(
      and(
        eq(internalContacts.organizationId, orgId),
        eq(internalContacts.active, options.archived !== true)
      )
    )

  const contacts: InternalDirectoryContact[] = directoryRows.map((contact) => ({
      id: contact.id,
      name: contact.name,
      company: null,
      jobTitle: contact.jobTitle,
      active: options.archived !== true,
      linkedToUser: contact.userId !== null,
      accountHolder: internalPersonAccountState(
        contact.userId === null ? null : { id: contact.userId, isActive: contact.userActive === true }
      ) === "account",
      role:
        contact.jobTitle ??
        (contact.membershipRole ? userRoleLabel(contact.membershipRole) : null),
      email: contact.email,
      phone: contact.phone,
      cellPhone: contact.cellPhone,
      sourceLabel: contact.sourceSystem,
      sageEmployeeId: contact.sageEmployeeId,
      sageEmployeeNumber: contact.sageEmployeeNumber,
      accessStatus: contact.userId === null || contact.membershipRole === null
        ? "no_access"
        : contact.userActive
          ? "active"
          : contact.lastLoginAt === null && !contact.userId.startsWith("user_")
            ? "invited"
            : "no_access",
    }))

  return contacts.sort((left, right) => left.name.localeCompare(right.name))
}

export async function createVendor(
  data: VendorCompanyMutationInput
): Promise<VendorMutationResult> {
  try {
    const { user, db } = await requireUserContext()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    await requireFeaturePermission(user, "vendors", "create")
    const orgId = requireOrg(user)

    const name = data.name.trim()
    const category = data.category.trim()
    if (!name) return { success: false, error: "Vendor company name is required" }
    if (!category) return { success: false, error: "Vendor category is required" }

    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    const contactInputs = normalizedContactInputs(data.contacts ?? [])

    await insertVendor(db, {
      id,
      organizationId: orgId,
      name,
      category,
      email: nullableText(data.email),
      phone: nullableText(data.phone),
      address: nullableText(data.address),
      createdAt: now,
      updatedAt: now,
    })
    await insertVendorPeople(
      db,
      contactInputs.map((contact) => ({
        id: crypto.randomUUID(),
        vendorId: id,
        name: contact.name,
        title: nullableText(contact.title),
        email: nullableText(contact.email),
        phone: nullableText(contact.phone),
        isPrimary: contact.isPrimary,
        active: true,
        sourceSystem: "manual",
        sourceRecordId: null,
        createdAt: now,
        updatedAt: now,
      }))
    )

    revalidatePath("/dashboard/vendors")
    revalidatePath("/dashboard/contacts")
    revalidatePath("/dashboard/projects", "layout")
    return { success: true, id }
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "Failed to create vendor",
    }
  }
}

/** Vendor edits are logged to Activity like client contact edits. */
async function recordVendorUpdateActivity(
  db: Db,
  input: { readonly user: AuthUser; readonly organizationId: string; readonly vendorId: string; readonly name: string; readonly peopleChanged: readonly string[] }
): Promise<void> {
  await recordActivityEvent({
    db, organizationId: input.organizationId, actor: input.user,
    category: "account",
    action: "vendor.updated",
    entityType: "vendor",
    entityId: input.vendorId,
    summary: input.peopleChanged.length > 0
      ? `Updated vendor ${input.name} and its people: ${input.peopleChanged.join(", ")}.`.slice(0, 480)
      : `Updated vendor ${input.name}.`,
    metadata: { peopleChanged: [...input.peopleChanged] },
  })
}

export async function updateVendor(
  id: string,
  data: VendorCompanyUpdateInput
): Promise<VendorUpdateResult> {
  try {
    const { user, db } = await requireUserContext()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    await requireFeaturePermission(user, "vendors", "update")
    const orgId = requireOrg(user)

    const existing = await db
      .select()
      .from(vendors)
      .where(and(eq(vendors.id, id), eq(vendors.organizationId, orgId)))
      .limit(1)
      .get()
    if (!existing) return { success: false, error: "Vendor not found" }
    if (existing.directoryStatus !== "active" || existing.mergedIntoVendorId) {
      return { success: false, error: "This vendor was archived or merged. Edit the surviving directory record instead." }
    }

    const sageLinked = Boolean(existing.sageVendorId || existing.sageVendorNumber)
    // On a Sage-linked vendor primary belongs to Sage's people, so it is
    // never moved to the first person here.
    const contactInputs = normalizedContactInputs(data.contacts ?? [], { assignPrimary: !sageLinked })
    const existingContacts = data.contacts === undefined
      ? []
      : await db.select().from(vendorContacts)
          .where(eq(vendorContacts.vendorId, id))

    if (sageLinked) {
      if (changesSageLinkedVendorIdentity(existing, data)) {
        return {
          success: false,
          error: "This vendor is linked to Sage. Contact changes need Sage review before Compass can update the directory.",
        }
      }
      const peopleError = data.contacts === undefined ? null : sageLinkedVendorPeopleChangeError(contactInputs, existingContacts)
      if (peopleError) return { success: false, error: peopleError }
      if (data.category !== undefined && data.category.trim() !== existing.category) {
        const sageType = await vendorCategoryFromSage(db, orgId, existing)
        if (sageType) return { success: false, error: sageVendorTypeCategoryError(sageType) }
      }
    }

    const name = data.name?.trim() ?? existing.name
    const category = data.category?.trim() ?? existing.category
    if (!name) return { success: false, error: "Vendor company name is required" }
    if (!category) return { success: false, error: "Vendor category is required" }
    const nextIdentity = {
      email:
        data.email === undefined
          ? existing.email
          : nullableOptionalText(data.email),
      phone:
        data.phone === undefined
          ? existing.phone
          : nullableOptionalText(data.phone),
      address:
        data.address === undefined
          ? existing.address
          : nullableOptionalText(data.address),
    }
    // An accepted Compass user's other details are staff-editable; only the
    // email they sign in with stays theirs.
    if (
      contactEmailChanged(existing.email, nextIdentity.email) &&
      (await directoryIdentityManagedByActiveUser({
        db,
        organizationId: orgId,
        entityType: "vendor",
        entityId: id,
      }))
    ) {
      return { success: false, error: SIGN_IN_EMAIL_LOCK }
    }

    const existingById = new Map(
      existingContacts.map((contact) => [contact.id, contact])
    )
    const managedByActiveUser = (personId: string): Promise<boolean> =>
      directoryIdentityManagedByActiveUser({
        db,
        organizationId: orgId,
        entityType: "vendor_contact",
        entityId: personId,
      })
    // Check every edited person at once, then report the first problem in
    // submitted order, as before.
    const editedChecks = await Promise.all(
      contactInputs.map(async (contact) => {
        const existingContact = contact.id ? existingById.get(contact.id) : undefined
        const emailChanged =
          existingContact !== undefined &&
          contactEmailChanged(existingContact.email, nullableText(contact.email))
        return {
          contact,
          existingContact,
          managed: existingContact && emailChanged ? await managedByActiveUser(existingContact.id) : false,
        }
      })
    )
    for (const { contact, existingContact, managed } of editedChecks) {
      if (contact.id && !existingContact) {
        return { success: false, error: "Vendor contact not found" }
      }
      if (existingContact && managed) {
        return {
          success: false,
          error: `${existingContact.name}: ${SIGN_IN_EMAIL_LOCK}`,
        }
      }
    }
    const submittedExistingIds = new Set(
      contactInputs.flatMap((contact) => (contact.id ? [contact.id] : []))
    )
    const removedContacts = existingContacts.filter(
      (contact) => contact.active && !submittedExistingIds.has(contact.id)
    )
    const removedChecks = await Promise.all(
      removedContacts.map(async (removedContact) => ({
        removedContact,
        managed: await managedByActiveUser(removedContact.id),
      }))
    )
    const managedRemoval = removedChecks.find((check) => check.managed)
    if (managedRemoval) {
      return {
        success: false,
        error: `${managedRemoval.removedContact.name} is an active Compass user and cannot be removed from this vendor company.`,
      }
    }

    const updatedAt = new Date().toISOString()
    await updateVendorRecord(db, {
      vendorId: id,
      organizationId: orgId,
      values: { name, category, ...nextIdentity, updatedAt },
    })
    // Project contacts read a linked vendor from the directory; the copies
    // are refreshed for readers that still use them.
    await syncVendorCompanyCopies(db, {
      vendorId: id,
      companyName: name,
      identity: { ...nextIdentity, updatedAt },
    })

    if (data.contacts === undefined) {
      await recordVendorUpdateActivity(db, { user, organizationId: orgId, vendorId: id, name, peopleChanged: [] })
      revalidatePath("/dashboard/vendors")
      revalidatePath("/dashboard/contacts")
      revalidatePath("/dashboard/projects", "layout")
      return { success: true }
    }

    const retainedIds = new Set<string>()
    await clearVendorPrimaryPeople(db, { vendorId: id, now: updatedAt })

    // One batch for every person and their project-contact copies.
    const personWrites = contactInputs.flatMap((contact) => {
      const existingContact = contact.id ? existingById.get(contact.id) : undefined
      const email = nullableText(contact.email)
      const phone = nullableText(contact.phone)
      const contactId = existingContact?.id ?? crypto.randomUUID()
      retainedIds.add(contactId)
      const personWrite = existingContact
        ? updateVendorPersonStatement(db, {
            vendorId: id,
            personId: contactId,
            values: {
              name: contact.name,
              title: nullableText(contact.title),
              email,
              phone,
              isPrimary: contact.isPrimary,
              active: true,
              updatedAt,
            },
          })
        : insertVendorPersonStatement(db, {
            id: contactId,
            vendorId: id,
            name: contact.name,
            title: nullableText(contact.title),
            email,
            phone,
            isPrimary: contact.isPrimary,
            active: true,
            sourceSystem: "manual",
            sourceRecordId: null,
            createdAt: updatedAt,
            updatedAt,
          })
      return [
        personWrite,
        syncVendorPersonCopiesStatement(db, {
          vendorContactId: contactId,
          values: { displayName: contact.name, companyName: name, email, phone, updatedAt },
          includeSourceEntityMatch: true,
        }),
      ]
    })
    const [firstWrite, ...otherWrites] = personWrites
    if (firstWrite) await db.batch([firstWrite, ...otherWrites])

    const removedIds = existingContacts
      .map((contact) => contact.id)
      .filter((contactId) => !retainedIds.has(contactId))
    await deactivateVendorPeople(db, { personIds: removedIds, now: updatedAt })
    // People removed here leave every job (kept as history), and their
    // accounts lose those project memberships.
    await removeArchivedPeopleFromJobs(db, { organizationId: orgId, kind: "vendor_contact", personIds: removedIds, now: updatedAt })

    // An edited email leaves any pending (unaccepted) project invitation at
    // the old address. Nothing is revoked or resent here; staff are warned.
    const emailChangedIds = contactInputs.flatMap((contact) => {
      const existingContact = contact.id ? existingById.get(contact.id) : undefined
      return existingContact && (existingContact.email?.trim().toLowerCase() ?? "") !== contact.email ? [existingContact.id] : []
    })
    let staleInvitations = 0
    for (const personId of emailChangedIds) {
      const nextEmail = contactInputs.find((contact) => contact.id === personId)?.email ?? null
      staleInvitations += await stalePendingInvitationCount(db, {
        organizationId: orgId, person: { kind: "vendor_contact", id: personId }, nextEmail, now: updatedAt,
      })
    }
    const peopleChanged = contactInputs.flatMap((contact) => {
      const existingContact = contact.id ? existingById.get(contact.id) : undefined
      if (!existingContact) return [contact.name]
      const unchanged = existingContact.name === contact.name &&
        (existingContact.title ?? "") === contact.title &&
        (existingContact.email?.trim().toLowerCase() ?? "") === contact.email &&
        (existingContact.phone ?? "") === contact.phone &&
        existingContact.isPrimary === contact.isPrimary
      return unchanged ? [] : [contact.name]
    })
    await recordVendorUpdateActivity(db, {
      user, organizationId: orgId, vendorId: id, name,
      peopleChanged: [...peopleChanged, ...existingContacts.filter((contact) => contact.active && removedIds.includes(contact.id)).map((contact) => `${contact.name} (removed)`)],
    })

    revalidatePath("/dashboard/vendors")
    revalidatePath("/dashboard/contacts")
    revalidatePath("/dashboard/projects", "layout")
    const warning = stalePendingInvitationWarning(staleInvitations)
    return warning ? { success: true, warning } : { success: true }
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "Failed to update vendor",
    }
  }
}

export async function createVendorContact(
  vendorId: string,
  input: VendorContactMutationInput
): Promise<VendorContactMutationResult> {
  try {
    const { user, db } = await requireUserContext()
    if (isDemoUser(user.id)) return { success: false, error: "DEMO_READ_ONLY" }
    await requireFeaturePermission(user, "vendors", "update")
    const orgId = requireOrg(user)
    const result = await addVendorPerson(db, {
      organizationId: orgId,
      vendorId,
      person: input,
      now: new Date().toISOString(),
      onSageLinkedVendor: "refuse",
    })
    if (!result.success) return result
    const { contact } = result
    revalidatePath("/dashboard/contacts")
    revalidatePath("/dashboard/projects", "layout")
    return { success: true, contact }
  } catch (error) {
    console.error("Failed to create vendor contact", error)
    return { success: false, error: "Failed to create vendor contact" }
  }
}

export async function deleteVendor(id: string) {
  try {
    const { user, db } = await requireUserContext()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    await requireFeaturePermission(user, "vendors", "delete")
    requirePermission(user, "vendor", "delete")
    const orgId = requireOrg(user)

    const existing = await db.select({ mergedIntoVendorId: vendors.mergedIntoVendorId })
      .from(vendors).where(and(eq(vendors.id, id), eq(vendors.organizationId, orgId))).get()
    if (!existing) return { success: false, error: "Vendor not found." }
    if (existing.mergedIntoVendorId) return { success: false, error: "Merged vendor records are retained for audit and cannot be deleted." }
    await deleteVendorRecord(db, { vendorId: id, organizationId: orgId })

    revalidatePath("/dashboard/vendors")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "Failed to delete vendor",
    }
  }
}
