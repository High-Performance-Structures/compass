"use server"

import { getCloudflareContext } from "@/lib/db"
import { eq, and } from "drizzle-orm"
import { getDb } from "@/db"
import {
  projectContacts,
  projects,
  vendors,
  type NewVendor,
} from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { requirePermission } from "@/lib/permissions"
import { revalidatePath } from "next/cache"
import { requireOrg } from "@/lib/org-scope"
import { isDemoUser } from "@/lib/demo"
import {
  contactIdentityChanged,
  directoryIdentityManagedByActiveUser,
} from "@/lib/contact-identity-ownership"

export type InternalDirectoryContact = {
  readonly id: string
  readonly name: string
  readonly company: string | null
  readonly role: string | null
  readonly email: string | null
  readonly phone: string | null
  readonly sourceLabel: string
}

const DEFAULT_INTERNAL_DIRECTORY_CONTACTS: readonly InternalDirectoryContact[] = [
  {
    id: "internal-department-hps",
    name: "High Performance Structures Inc.",
    company: "High Performance Structures Inc.",
    role: "Internal department",
    email: null,
    phone: null,
    sourceLabel: "Compass seed",
  },
  {
    id: "internal-department-orc",
    name: "Open Range Construction",
    company: "Open Range Construction",
    role: "Internal department",
    email: null,
    phone: null,
    sourceLabel: "Compass seed",
  },
  {
    id: "internal-department-nutech",
    name: "Nu-Tech Systems",
    company: "Nu-Tech Systems",
    role: "ICF sales and bracing rental",
    email: null,
    phone: null,
    sourceLabel: "Compass seed",
  },
  {
    id: "internal-employee-martine-vogel",
    name: "Martine Vogel",
    company: "High Performance Structures",
    role: "Admin-owner",
    email: null,
    phone: null,
    sourceLabel: "Sage roster",
  },
  {
    id: "internal-employee-daniel-vogel",
    name: "Daniel Vogel",
    company: "High Performance Structures",
    role: "Project Manager / Field production",
    email: null,
    phone: null,
    sourceLabel: "Sage roster",
  },
  {
    id: "internal-employee-sarah-cowman",
    name: "Sarah Cowman",
    company: "High Performance Structures",
    role: "Senior Field Crew",
    email: null,
    phone: null,
    sourceLabel: "Sage roster",
  },
  {
    id: "internal-employee-stanley-platt",
    name: "Stanley Platt",
    company: "High Performance Structures",
    role: "Field Superintendent",
    email: null,
    phone: null,
    sourceLabel: "Sage roster",
  },
  {
    id: "internal-employee-sylvi-vogel",
    name: "Sylvi Vogel",
    company: "High Performance Structures",
    role: "Architectural Designer / Design & Print",
    email: null,
    phone: null,
    sourceLabel: "Sage roster",
  },
  {
    id: "internal-employee-cassandra-rodriguez-v",
    name: "Cassandra Rodriguez-V",
    company: "High Performance Structures",
    role: "Project Administrator / Accounting Coordinator",
    email: null,
    phone: null,
    sourceLabel: "Sage roster",
  },
  {
    id: "internal-employee-wesley-jones",
    name: "Wesley Jones",
    company: "High Performance Structures",
    role: "Assistant Project Manager",
    email: null,
    phone: null,
    sourceLabel: "Sage roster",
  },
  {
    id: "internal-employee-rebekah-jones",
    name: "Rebekah Jones",
    company: "High Performance Structures",
    role: "Office Manager / Business Development",
    email: null,
    phone: null,
    sourceLabel: "Sage roster",
  },
  {
    id: "internal-employee-isabel-araguz",
    name: "Isabel Araguz",
    company: "High Performance Structures",
    role: "Field Crew",
    email: null,
    phone: null,
    sourceLabel: "Sage roster",
  },
]

function normalizeInternalContactKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function internalSourceLabel(sourceSystem: string): string {
  if (sourceSystem.includes("sage")) return "Sage"
  if (sourceSystem === "buildertrend") return "Buildertrend"
  return "Compass"
}

function isSeededInternalDepartmentName(value: string): boolean {
  const normalized = normalizeInternalContactKey(value)
  return (
    normalized === "hps subcontractor" ||
    normalized.includes("high performance structures") ||
    normalized.includes("open range construction") ||
    normalized.includes("nu tech")
  )
}

export async function getVendors() {
  const user = await requireAuth()
  requirePermission(user, "vendor", "read")
  const orgId = requireOrg(user)

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  return db
    .select()
    .from(vendors)
    .where(
      and(eq(vendors.organizationId, orgId), eq(vendors.directoryStatus, "active"))
    )
}

export async function getInternalDirectoryContacts(): Promise<
  readonly InternalDirectoryContact[]
> {
  const user = await requireAuth()
  requirePermission(user, "vendor", "read")
  const orgId = requireOrg(user)

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  const internalVendors = await db
    .select({
      id: vendors.id,
      name: vendors.name,
      category: vendors.category,
      email: vendors.email,
      phone: vendors.phone,
      sourceSystem: vendors.sourceSystem,
    })
    .from(vendors)
    .where(
      and(
        eq(vendors.organizationId, orgId),
        eq(vendors.directoryStatus, "active"),
        eq(vendors.category, "Internal")
      )
    )

  const internalProjectContacts = await db
    .select({
      id: projectContacts.id,
      name: projectContacts.displayName,
      company: projectContacts.companyName,
      role: projectContacts.role,
      email: projectContacts.email,
      phone: projectContacts.phone,
      sourceSystem: projectContacts.sourceSystem,
    })
    .from(projectContacts)
    .innerJoin(projects, eq(projects.id, projectContacts.projectId))
    .where(
      and(
        eq(projects.organizationId, orgId),
        eq(projectContacts.contactType, "internal"),
        eq(projectContacts.active, true)
      )
    )

  const contacts = new Map<string, InternalDirectoryContact>()

  for (const contact of DEFAULT_INTERNAL_DIRECTORY_CONTACTS) {
    const key = normalizeInternalContactKey(
      [contact.name, contact.company ?? "", contact.email ?? ""].join("|")
    )
    contacts.set(key, contact)
  }

  for (const vendor of internalVendors) {
    if (isSeededInternalDepartmentName(vendor.name)) continue

    const key = normalizeInternalContactKey(
      [vendor.name, vendor.email ?? ""].join("|")
    )
    contacts.set(key, {
      id: `vendor-${vendor.id}`,
      name: vendor.name,
      company: vendor.name,
      role: vendor.category,
      email: vendor.email,
      phone: vendor.phone,
      sourceLabel: internalSourceLabel(vendor.sourceSystem),
    })
  }

  for (const contact of internalProjectContacts) {
    if (isSeededInternalDepartmentName(contact.name)) continue

    const key = normalizeInternalContactKey(
      [contact.name, contact.company ?? "", contact.email ?? ""].join("|")
    )
    if (contacts.has(key)) continue

    contacts.set(key, {
      id: `project-contact-${contact.id}`,
      name: contact.name,
      company: contact.company,
      role: contact.role,
      email: contact.email,
      phone: contact.phone,
      sourceLabel: internalSourceLabel(contact.sourceSystem),
    })
  }

  return Array.from(contacts.values()).sort((left, right) =>
    left.name.localeCompare(right.name)
  )
}

export async function getVendor(id: string) {
  const user = await requireAuth()
  requirePermission(user, "vendor", "read")
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
  data: Omit<NewVendor, "id" | "createdAt" | "updatedAt" | "organizationId">
) {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(user, "vendor", "create")
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const now = new Date().toISOString()
    const id = crypto.randomUUID()

    await db.insert(vendors).values({
      id,
      organizationId: orgId,
      ...data,
      createdAt: now,
      updatedAt: now,
    })

    revalidatePath("/dashboard/vendors")
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
  data: Partial<NewVendor>
) {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(user, "vendor", "update")
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

    const nextIdentity = {
      email: data.email === undefined ? existing.email : data.email,
      phone: data.phone === undefined ? existing.phone : data.phone,
      address: data.address === undefined ? existing.address : data.address,
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

    const updatedAt = new Date().toISOString()
    await db.batch([
      db
        .update(vendors)
        .set({ ...data, updatedAt })
        .where(and(eq(vendors.id, id), eq(vendors.organizationId, orgId))),
      db
        .update(projectContacts)
        .set({ ...nextIdentity, updatedAt })
        .where(
          and(
            eq(projectContacts.sourceEntityType, "vendor"),
            eq(projectContacts.sourceEntityId, id)
          )
        ),
    ])

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

export async function deleteVendor(id: string) {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
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
