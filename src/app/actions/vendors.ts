"use server"

import { getCloudflareContext } from "@/lib/db"
import { eq, and } from "drizzle-orm"
import { getDb } from "@/db"
import {
  organizationMembers,
  users,
  vendors,
  type NewVendor,
} from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { requirePermission } from "@/lib/permissions"
import { revalidatePath } from "next/cache"
import { requireOrg } from "@/lib/org-scope"
import { isDemoOrg, isDemoUser } from "@/lib/demo"
import { USER_ROLE_OPTIONS, userRoleLabel } from "@/lib/user-roles"

export type InternalDirectoryContact = {
  readonly id: string
  readonly name: string
  readonly company: string | null
  readonly role: string | null
  readonly email: string | null
  readonly phone: string | null
  readonly sourceLabel: string
}

const DEFAULT_INTERNAL_DEPARTMENT_CONTACTS: readonly InternalDirectoryContact[] = [
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

function shouldShowInInternalDirectory(role: string): boolean {
  const option = USER_ROLE_OPTIONS.find((item) => item.value === role)
  if (!option) return false
  return option.group !== "External"
}

function userDisplayName(input: {
  readonly displayName: string | null
  readonly firstName: string | null
  readonly lastName: string | null
  readonly email: string
}): string {
  if (input.displayName) return input.displayName

  const nameParts = [input.firstName, input.lastName].filter(
    (part): part is string => part !== null && part.trim() !== ""
  )
  const name = nameParts.join(" ").trim()
  return name || input.email
}

export async function getVendors() {
  const user = await requireAuth()
  requirePermission(user, "vendor", "read")
  const orgId = requireOrg(user)

  if (isDemoUser(user.id) || isDemoOrg(orgId)) {
    return []
  }

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

  if (isDemoUser(user.id) || isDemoOrg(orgId)) {
    return []
  }

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  const organizationUsers = await db
    .select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      displayName: users.displayName,
      role: organizationMembers.role,
    })
    .from(users)
    .innerJoin(organizationMembers, eq(organizationMembers.userId, users.id))
    .where(
      and(
        eq(users.isActive, true),
        eq(organizationMembers.organizationId, orgId)
      )
    )

  const contacts = new Map<string, InternalDirectoryContact>()

  for (const contact of DEFAULT_INTERNAL_DEPARTMENT_CONTACTS) {
    const key = normalizeInternalContactKey(
      [contact.name, contact.company ?? "", contact.email ?? ""].join("|")
    )
    contacts.set(key, contact)
  }

  for (const user of organizationUsers) {
    if (!shouldShowInInternalDirectory(user.role)) continue

    const name = userDisplayName(user)
    const key = normalizeInternalContactKey(
      [name, user.email].join("|")
    )
    if (contacts.has(key)) continue

    contacts.set(key, {
      id: `user-${user.id}`,
      name,
      company: "High Performance Structures",
      role: userRoleLabel(user.role),
      email: user.email,
      phone: null,
      sourceLabel: "Compass role",
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

    await db
      .update(vendors)
      .set({ ...data, updatedAt: new Date().toISOString() })
      .where(and(eq(vendors.id, id), eq(vendors.organizationId, orgId)))

    revalidatePath("/dashboard/vendors")
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
