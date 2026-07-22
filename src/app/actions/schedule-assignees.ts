import "server-only"

import { and, asc, eq, sql } from "drizzle-orm"

import { getDb } from "@/db"
import {
  customers,
  organizationMembers,
  projectContacts,
  projectMembers,
  users,
  vendors,
} from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { requireOrg } from "@/lib/org-scope"
import { assertProjectAccess } from "@/lib/project-access"
import { isInternalStaffRole } from "@/lib/user-roles"

export type ScheduleAssigneeSource =
  | "project_contact"
  | "customer"
  | "vendor"
  | "user"

export type ScheduleAssigneeReference = {
  readonly source: ScheduleAssigneeSource
  readonly sourceId: string
}

export type ScheduleAssigneeOption = ScheduleAssigneeReference & {
  readonly id: string
  readonly name: string
  readonly label: string
  readonly companyName: string | null
  readonly email: string | null
  readonly contactType: "owner" | "supplier" | "subcontractor" | "internal"
  readonly projectAccess: boolean
}

type Db = ReturnType<typeof getDb>

type ResolvedAssignee = {
  readonly projectContactId: string
  readonly contactType: ScheduleAssigneeOption["contactType"]
  readonly email: string | null
  readonly userId: string | null
}

function normalizedKey(value: string | null): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function sourceIdPart(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "-")
  return normalized.replace(/^-+|-+$/g, "").slice(0, 48) || "contact"
}

function vendorContactType(
  category: string
): "supplier" | "subcontractor" | "internal" {
  const value = category.toLowerCase()
  if (value.includes("internal")) return "internal"
  if (
    value.includes("supplier") ||
    value.includes("miscellaneous") ||
    value.includes("government") ||
    value.includes("building and planning")
  ) {
    return "supplier"
  }
  return "subcontractor"
}

function membershipRole(
  contactType: ScheduleAssigneeOption["contactType"],
  userRole: string | null
): string {
  if (contactType === "owner") return "owner"
  if (contactType === "supplier") return "supplier"
  if (contactType === "subcontractor") return "subcontractor"
  return userRole && (isInternalStaffRole(userRole) || userRole === "developer")
    ? userRole
    : "office"
}

function visibilityForContactType(
  contactType: ScheduleAssigneeOption["contactType"]
): {
  readonly ownerPortalVisible: boolean
  readonly subVendorPortalVisible: boolean
  readonly internalVisible: boolean
} {
  return {
    ownerPortalVisible: contactType === "owner",
    subVendorPortalVisible:
      contactType === "supplier" || contactType === "subcontractor",
    internalVisible: true,
  }
}

export async function getScheduleAssigneeOptions(
  projectId: string
): Promise<readonly ScheduleAssigneeOption[]> {
  const user = await requireAuth()
  const orgId = requireOrg(user)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  await assertProjectAccess(db, user, projectId)

  const projectRows = await db
    .select()
    .from(projectContacts)
    .where(and(eq(projectContacts.projectId, projectId), eq(projectContacts.active, true)))
    .orderBy(asc(projectContacts.displayName))

  const assignedSourceKeys = new Set(
    projectRows
      .filter(
        (contact): contact is typeof contact & { sourceEntityId: string } =>
          typeof contact.sourceEntityId === "string"
      )
      .map((contact) => `${contact.sourceEntityType}:${contact.sourceEntityId}`)
  )
  const assignedNameKeys = new Set(
    projectRows.map((contact) =>
      normalizedKey(contact.companyName ?? contact.displayName)
    )
  )

  const [customerRows, vendorRows, staffRows] = await Promise.all([
    db
      .select()
      .from(customers)
      .where(
        and(
          eq(customers.organizationId, orgId),
          eq(customers.directoryStatus, "active")
        )
      )
      .orderBy(asc(customers.name)),
    db
      .select()
      .from(vendors)
      .where(
        and(eq(vendors.organizationId, orgId), eq(vendors.directoryStatus, "active"))
      )
      .orderBy(asc(vendors.name)),
    db
      .select({
        id: users.id,
        displayName: users.displayName,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        role: users.role,
      })
      .from(users)
      .innerJoin(organizationMembers, eq(organizationMembers.userId, users.id))
      .where(
        and(
          eq(organizationMembers.organizationId, orgId),
          eq(users.isActive, true)
        )
      )
      .orderBy(asc(users.displayName), asc(users.email)),
  ])

  const projectOptions: ScheduleAssigneeOption[] = projectRows.map((contact) => ({
    id: `project_contact:${contact.id}`,
    source: "project_contact",
    sourceId: contact.id,
    name: contact.displayName,
    label:
      contact.companyName && contact.companyName !== contact.displayName
        ? `${contact.displayName} - ${contact.companyName}`
        : contact.displayName,
    companyName: contact.companyName,
    email: contact.email,
    contactType:
      contact.contactType === "owner" ||
      contact.contactType === "supplier" ||
      contact.contactType === "internal"
        ? contact.contactType
        : "subcontractor",
    projectAccess: true,
  }))

  const directoryOptions: ScheduleAssigneeOption[] = [
    ...customerRows
      .filter(
        (customer) =>
          !assignedSourceKeys.has(`customer:${customer.id}`) &&
          !assignedNameKeys.has(normalizedKey(customer.company ?? customer.name))
      )
      .map((customer) => ({
        id: `customer:${customer.id}`,
        source: "customer" as const,
        sourceId: customer.id,
        name: customer.name,
        label: `${customer.name} - Customer directory`,
        companyName: customer.company,
        email: customer.email,
        contactType: "owner" as const,
        projectAccess: false,
      })),
    ...vendorRows
      .filter(
        (vendor) =>
          !assignedSourceKeys.has(`vendor:${vendor.id}`) &&
          !assignedNameKeys.has(normalizedKey(vendor.name))
      )
      .map((vendor) => ({
        id: `vendor:${vendor.id}`,
        source: "vendor" as const,
        sourceId: vendor.id,
        name: vendor.name,
        label: `${vendor.name} - ${vendor.category}`,
        companyName: vendor.name,
        email: vendor.email,
        contactType: vendorContactType(vendor.category),
        projectAccess: false,
      })),
    ...staffRows
      .filter(
        (staff) =>
          (isInternalStaffRole(staff.role) || staff.role === "developer") &&
          !assignedSourceKeys.has(`user:${staff.id}`)
      )
      .map((staff) => {
        const displayName =
          staff.displayName ??
          ([staff.firstName, staff.lastName].filter(Boolean).join(" ") ||
            staff.email)
        return {
          id: `user:${staff.id}`,
          source: "user" as const,
          sourceId: staff.id,
          name: displayName,
          label: `${displayName} - Internal staff`,
          companyName: "High Performance Structures Inc.",
          email: staff.email,
          contactType: "internal" as const,
          projectAccess: false,
        }
      }),
  ]

  return [...projectOptions, ...directoryOptions].sort((left, right) =>
    left.name.localeCompare(right.name)
  )
}

async function findUserByEmail(
  db: Db,
  email: string | null
): Promise<{ readonly id: string; readonly role: string } | null> {
  const normalizedEmail = email?.trim().toLowerCase()
  if (!normalizedEmail) return null
  return (
    (await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(sql`lower(trim(${users.email})) = ${normalizedEmail}`)
      .get()) ?? null
  )
}

async function resolveProjectContact(
  db: Db,
  projectId: string,
  orgId: string,
  reference: ScheduleAssigneeReference,
  now: string
): Promise<ResolvedAssignee | null> {
  if (reference.source === "project_contact") {
    const contact = await db
      .select()
      .from(projectContacts)
      .where(
        and(
          eq(projectContacts.id, reference.sourceId),
          eq(projectContacts.projectId, projectId),
          eq(projectContacts.active, true)
        )
      )
      .get()
    if (!contact) return null
    const contactType =
      contact.contactType === "owner" ||
      contact.contactType === "supplier" ||
      contact.contactType === "internal"
        ? contact.contactType
        : "subcontractor"
    const directUser =
      contact.sourceEntityType === "user" && contact.sourceEntityId
        ? await db
            .select({ id: users.id, role: users.role })
            .from(users)
            .where(and(eq(users.id, contact.sourceEntityId), eq(users.isActive, true)))
            .get()
        : null
    const matchedUser = directUser ?? (await findUserByEmail(db, contact.email))
    await db
      .update(projectContacts)
      .set({ ...visibilityForContactType(contactType), updatedAt: now })
      .where(eq(projectContacts.id, contact.id))
    return {
      projectContactId: contact.id,
      contactType,
      email: contact.email,
      userId: matchedUser?.id ?? null,
    }
  }

  let displayName = ""
  let companyName: string | null = null
  let email: string | null = null
  let contactType: ScheduleAssigneeOption["contactType"] = "subcontractor"
  let userId: string | null = null
  let userRole: string | null = null

  if (reference.source === "customer") {
    const customer = await db
      .select()
      .from(customers)
      .where(
        and(eq(customers.id, reference.sourceId), eq(customers.organizationId, orgId))
      )
      .get()
    if (!customer) return null
    displayName = customer.name
    companyName = customer.company
    email = customer.email
    contactType = "owner"
  } else if (reference.source === "vendor") {
    const vendor = await db
      .select()
      .from(vendors)
      .where(and(eq(vendors.id, reference.sourceId), eq(vendors.organizationId, orgId)))
      .get()
    if (!vendor) return null
    displayName = vendor.name
    companyName = vendor.name
    email = vendor.email
    contactType = vendorContactType(vendor.category)
  } else {
    const staff = await db
      .select({
        id: users.id,
        displayName: users.displayName,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        role: users.role,
      })
      .from(users)
      .innerJoin(organizationMembers, eq(organizationMembers.userId, users.id))
      .where(
        and(
          eq(users.id, reference.sourceId),
          eq(users.isActive, true),
          eq(organizationMembers.organizationId, orgId)
        )
      )
      .get()
    if (!staff) return null
    displayName =
      staff.displayName ??
      ([staff.firstName, staff.lastName].filter(Boolean).join(" ") ||
        staff.email)
    companyName = "High Performance Structures Inc."
    email = staff.email
    contactType = "internal"
    userId = staff.id
    userRole = staff.role
  }

  const existing = await db
    .select({ id: projectContacts.id })
    .from(projectContacts)
    .where(
      and(
        eq(projectContacts.projectId, projectId),
        eq(projectContacts.sourceEntityType, reference.source),
        eq(projectContacts.sourceEntityId, reference.sourceId)
      )
    )
    .get()
  const contactId =
    existing?.id ??
    `project-contact-${sourceIdPart(projectId)}-${sourceIdPart(reference.source)}-${sourceIdPart(reference.sourceId)}`

  if (existing) {
    await db
      .update(projectContacts)
      .set({
        active: true,
        ...visibilityForContactType(contactType),
        updatedAt: now,
      })
      .where(eq(projectContacts.id, existing.id))
  } else {
    await db.insert(projectContacts).values({
      id: contactId,
      projectId,
      contactType,
      sourceSystem: reference.source === "user" ? "compass_user" : "compass_directory",
      sourceRecordId: reference.sourceId,
      sourceEntityType: reference.source,
      sourceEntityId: reference.sourceId,
      displayName,
      companyName,
      role:
        contactType === "owner"
          ? "Owner / Client"
          : contactType === "internal"
            ? userRole ?? "Internal"
            : contactType === "supplier"
              ? "Supplier"
              : "Subcontractor",
      email,
      notes: "Added automatically from a Compass schedule assignment.",
      ...visibilityForContactType(contactType),
      active: true,
      sortOrder: contactType === "internal" ? 100 : 850,
      syncStatus: "manual",
      lastSyncedAt: null,
      createdAt: now,
      updatedAt: now,
    })
  }

  const matchedUser = userId
    ? { id: userId, role: userRole ?? "office" }
    : await findUserByEmail(db, email)
  return {
    projectContactId: contactId,
    contactType,
    email,
    userId: matchedUser?.id ?? null,
  }
}

export async function grantScheduleAssigneeProjectAccess(input: {
  readonly db: Db
  readonly projectId: string
  readonly organizationId: string
  readonly reference: ScheduleAssigneeReference
}): Promise<{ readonly success: true } | { readonly success: false; readonly error: string }> {
  const now = new Date().toISOString()
  const resolved = await resolveProjectContact(
    input.db,
    input.projectId,
    input.organizationId,
    input.reference,
    now
  )
  if (!resolved) {
    return { success: false, error: "The selected assignee is no longer available" }
  }
  if (!resolved.userId) {
    return { success: true }
  }

  const existingMember = await input.db
    .select({ id: projectMembers.id })
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.projectId, input.projectId),
        eq(projectMembers.userId, resolved.userId)
      )
    )
    .get()
  if (!existingMember) {
    const account = await input.db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, resolved.userId))
      .get()
    await input.db.insert(projectMembers).values({
      id: crypto.randomUUID(),
      projectId: input.projectId,
      userId: resolved.userId,
      role: membershipRole(resolved.contactType, account?.role ?? null),
      assignedAt: now,
    })
  }

  return { success: true }
}
