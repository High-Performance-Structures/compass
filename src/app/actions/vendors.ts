"use server"

import { getCloudflareContext } from "@/lib/db"
import { eq, and, asc, desc, inArray, isNull, or } from "drizzle-orm"
import { getDb } from "@/db"
import {
  projectContacts,
  internalContacts,
  organizationMembers,
  users,
  vendorContacts,
  vendors,
  type Vendor,
} from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { requirePermission } from "@/lib/permissions"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { revalidatePath } from "next/cache"
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

export type InternalDirectoryContact = {
  readonly id: string
  readonly name: string
  readonly company: string | null
  readonly role: string | null
  readonly email: string | null
  readonly phone: string | null
  readonly sourceLabel: string
  readonly accessStatus: "active" | "invited" | "no_access"
  readonly sageEmployeeId: string | null
  readonly sageEmployeeNumber: string | null
}

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
  const user = await requireAuth()
  await requireFeaturePermission(user, "vendors", "read")
  const orgId = requireOrg(user)

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

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
  const user = await requireAuth()
  await requireFeaturePermission(user, "internal-directory", "read")
  const orgId = requireOrg(user)

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  const directoryRows = await db
    .select({
      id: internalContacts.id,
      name: internalContacts.name,
      jobTitle: internalContacts.jobTitle,
      email: internalContacts.email,
      phone: internalContacts.phone,
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

export async function getVendor(id: string) {
  const user = await requireAuth()
  await requireFeaturePermission(user, "vendors", "read")
  const orgId = requireOrg(user)

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  const rows = await db
    .select()
    .from(vendors)
    .where(and(eq(vendors.id, id), eq(vendors.organizationId, orgId)))
    .limit(1)

  return rows[0] ?? null
}

export async function createVendor(
  data: VendorCompanyMutationInput
): Promise<VendorMutationResult> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    await requireFeaturePermission(user, "vendors", "create")
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const name = data.name.trim()
    const category = data.category.trim()
    if (!name) return { success: false, error: "Vendor company name is required" }
    if (!category) return { success: false, error: "Vendor category is required" }

    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    const contactInputs = normalizedContactInputs(data.contacts ?? [])

    await db.insert(vendors).values({
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
    for (const contact of contactInputs) {
      await db.insert(vendorContacts).values({
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
      })
    }

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
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    await requireFeaturePermission(user, "vendors", "update")
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const existing = await db
      .select()
      .from(vendors)
      .where(and(eq(vendors.id, id), eq(vendors.organizationId, orgId)))
      .limit(1)
      .get()
    if (!existing) return { success: false, error: "Vendor not found" }

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
    for (const contact of contactInputs) {
      const existingContact = contact.id
        ? existingById.get(contact.id)
        : undefined
      if (contact.id && !existingContact) {
        return { success: false, error: "Vendor contact not found" }
      }
      if (
        existingContact &&
        contactIdentityChanged(
          {
            email: existingContact.email,
            phone: existingContact.phone,
            address: null,
          },
          {
            email: nullableText(contact.email),
            phone: nullableText(contact.phone),
            address: null,
          }
        ) &&
        (await directoryIdentityManagedByActiveUser({
          db,
          organizationId: orgId,
          entityType: "vendor_contact",
          entityId: existingContact.id,
        }))
      ) {
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
    for (const removedContact of removedContacts) {
      if (
        await directoryIdentityManagedByActiveUser({
          db,
          organizationId: orgId,
          entityType: "vendor_contact",
          entityId: removedContact.id,
        })
      ) {
        return {
          success: false,
          error: `${removedContact.name} is an active Compass user and cannot be removed from this vendor company.`,
        }
      }
    }

    const updatedAt = new Date().toISOString()
    await db
      .update(vendors)
      .set({ name, category, ...nextIdentity, updatedAt })
      .where(and(eq(vendors.id, id), eq(vendors.organizationId, orgId)))
    await db
      .update(projectContacts)
      .set({ companyName: name, updatedAt })
      .where(eq(projectContacts.vendorId, id))
    await db
      .update(projectContacts)
      .set({ ...nextIdentity, updatedAt })
      .where(
        and(
          eq(projectContacts.sourceEntityType, "vendor"),
          eq(projectContacts.sourceEntityId, id),
          isNull(projectContacts.vendorContactId)
        )
      )

    if (data.contacts === undefined) {
      revalidatePath("/dashboard/vendors")
      revalidatePath("/dashboard/contacts")
      revalidatePath("/dashboard/projects", "layout")
      return { success: true }
    }

    const retainedIds = new Set<string>()
    await db
      .update(vendorContacts)
      .set({ isPrimary: false, updatedAt })
      .where(eq(vendorContacts.vendorId, id))

    for (const contact of contactInputs) {
      const existingContact = contact.id ? existingById.get(contact.id) : undefined
      const identity = {
        email: nullableText(contact.email),
        phone: nullableText(contact.phone),
        address: null,
      }

      const contactId = existingContact?.id ?? crypto.randomUUID()
      retainedIds.add(contactId)
      if (existingContact) {
        await db
          .update(vendorContacts)
          .set({
            name: contact.name,
            title: nullableText(contact.title),
            email: identity.email,
            phone: identity.phone,
            isPrimary: contact.isPrimary,
            active: true,
            updatedAt,
          })
          .where(
            and(
              eq(vendorContacts.id, contactId),
              eq(vendorContacts.vendorId, id)
            )
          )
      } else {
        await db.insert(vendorContacts).values({
          id: contactId,
          vendorId: id,
          name: contact.name,
          title: nullableText(contact.title),
          email: identity.email,
          phone: identity.phone,
          isPrimary: contact.isPrimary,
          active: true,
          sourceSystem: "manual",
          sourceRecordId: null,
          createdAt: updatedAt,
          updatedAt,
        })
      }
      await db
        .update(projectContacts)
        .set({
          displayName: contact.name,
          companyName: name,
          email: identity.email,
          phone: identity.phone,
          updatedAt,
        })
        .where(
          or(
            eq(projectContacts.vendorContactId, contactId),
            and(
              eq(projectContacts.sourceEntityType, "vendor_contact"),
              eq(projectContacts.sourceEntityId, contactId)
            )
          )
        )
    }

    const removedIds = existingContacts
      .map((contact) => contact.id)
      .filter((contactId) => !retainedIds.has(contactId))
    if (removedIds.length > 0) {
      await db
        .update(vendorContacts)
        .set({ active: false, isPrimary: false, updatedAt })
        .where(inArray(vendorContacts.id, removedIds))
    }

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
    const user = await requireAuth()
    if (isDemoUser(user.id)) return { success: false, error: "DEMO_READ_ONLY" }
    await requireFeaturePermission(user, "vendors", "update")
    const orgId = requireOrg(user)
    const name = input.name.trim()
    if (!name) return { success: false, error: "Contact name is required" }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
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
      await db
        .update(vendorContacts)
        .set({ isPrimary: false, updatedAt: now })
        .where(eq(vendorContacts.vendorId, vendorId))
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
    await db.insert(vendorContacts).values({
      ...contact,
      sourceRecordId: null,
      createdAt: now,
      updatedAt: now,
    })
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
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    await requireFeaturePermission(user, "vendors", "delete")
    requirePermission(user, "vendor", "delete")
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    await db
      .delete(vendors)
      .where(and(eq(vendors.id, id), eq(vendors.organizationId, orgId)))

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
