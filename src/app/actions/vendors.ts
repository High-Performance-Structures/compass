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
import {
  contactIdentityChanged,
  directoryIdentityManagedByActiveUser,
} from "@/lib/contact-identity-ownership"
import {
  changesSageLinkedVendorIdentity,
  sameSageLinkedVendorContacts,
} from "@/lib/sage/contact-edit-gate"
import { userRoleLabel } from "@/lib/user-roles"
import { requireUserContext } from "@/lib/server/action-context"
import type { VendorContactItem, VendorDirectoryCompany } from "@/lib/domain/contacts/directory-page"

export type InternalDirectoryContact = {
  readonly id: string
  readonly name: string
  readonly company: string | null
  readonly role: string | null
  readonly email: string | null
  readonly phone: string | null
  readonly cellPhone: string | null
  readonly sourceLabel: string
  readonly accessStatus: "active" | "invited" | "no_access"
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
  | { readonly success: true }
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
  contacts: readonly VendorContactMutationInput[]
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

export async function getInternalDirectoryContacts(): Promise<
  readonly InternalDirectoryContact[]
> {
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
        eq(internalContacts.active, true)
      )
    )

  const contacts: InternalDirectoryContact[] = directoryRows.map((contact) => ({
      id: contact.id,
      name: contact.name,
      company: null,
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

    const contactInputs = normalizedContactInputs(data.contacts ?? [])
    const existingContacts = data.contacts === undefined
      ? []
      : await db.select().from(vendorContacts)
          .where(eq(vendorContacts.vendorId, id))

    if (
      (existing.sageVendorId || existing.sageVendorNumber) &&
      (changesSageLinkedVendorIdentity(existing, data) ||
        (data.contacts !== undefined && !sameSageLinkedVendorContacts(contactInputs, existingContacts)))
    ) {
      return {
        success: false,
        error: "This vendor is linked to Sage. Contact changes need Sage review before Compass can update the directory.",
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
    const identityChanged = contactIdentityChanged(existing, nextIdentity)
    if (
      identityChanged &&
      (await directoryIdentityManagedByActiveUser({
        db,
        organizationId: orgId,
        entityType: "vendor",
        entityId: id,
      }))
    ) {
      return {
        success: false,
        error:
          "This active Compass user manages their own phone, email, and address.",
      }
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
        const identityChanged =
          existingContact !== undefined &&
          contactIdentityChanged(
            { email: existingContact.email, phone: existingContact.phone, address: null },
            { email: nullableText(contact.email), phone: nullableText(contact.phone), address: null }
          )
        return {
          contact,
          existingContact,
          managed: existingContact && identityChanged ? await managedByActiveUser(existingContact.id) : false,
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
          error: `${existingContact.name} manages their own email and phone in Compass.`,
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

    revalidatePath("/dashboard/vendors")
    revalidatePath("/dashboard/contacts")
    revalidatePath("/dashboard/projects", "layout")
    return { success: true }
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
    const name = input.name.trim()
    if (!name) return { success: false, error: "Contact name is required" }

    const vendor = await db
      .select({ id: vendors.id, sageVendorId: vendors.sageVendorId, sageVendorNumber: vendors.sageVendorNumber })
      .from(vendors)
      .where(
        and(
          eq(vendors.id, vendorId),
          eq(vendors.organizationId, orgId),
          eq(vendors.directoryStatus, "active")
        )
      )
      .get()
    if (!vendor) return { success: false, error: "Vendor company not found" }
    if (vendor.sageVendorId || vendor.sageVendorNumber) {
      return {
        success: false,
        error: "This vendor is linked to Sage. Add its contact through the reviewed Sage workflow.",
      }
    }

    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    if (input.isPrimary) {
      await clearVendorPrimaryPeople(db, { vendorId, now })
    }
    const contact: VendorContactItem = {
      id,
      vendorId,
      name,
      title: nullableText(input.title),
      email: nullableText(input.email),
      phone: nullableText(input.phone),
      isPrimary: input.isPrimary,
      active: true,
      sourceSystem: "manual",
      userId: null,
      sageContactId: null,
      sageLineNumber: null,
    }
    await insertVendorPeople(db, [{
      ...contact,
      sourceRecordId: null,
      createdAt: now,
      updatedAt: now,
    }])
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
