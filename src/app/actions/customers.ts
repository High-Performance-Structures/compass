"use server"

import { getCloudflareContext } from "@/lib/db"
import { eq, and, or, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { customers, projectContacts } from "@/db/schema"
import { sageClientProjectWriteOperations } from "@/db/schema-sage"
import { requireAuth } from "@/lib/auth"
import { requirePermission } from "@/lib/permissions"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { revalidatePath } from "next/cache"
import { requireOrg } from "@/lib/org-scope"
import { isDemoUser } from "@/lib/demo"
import { z } from "zod/v4"
import {
  parseSageClientStatusId,
  sageClientStatusName,
  sageShortName,
  type SageClientStatusId,
} from "@/lib/sage/client-project-write"
import {
  contactIdentityChanged,
  directoryIdentityManagedByActiveUser,
} from "@/lib/contact-identity-ownership"
import {
  changesSageLinkedCustomerIdentity,
} from "@/lib/sage/contact-edit-gate"

export type CreateCustomerInput = {
  readonly name: string
  readonly company: string | null
  readonly email: string | null
  readonly phone: string | null
  readonly address: string | null
  readonly notes: string | null
  readonly sageClientStatusId: SageClientStatusId
}

export type CustomerRelationshipType = "client" | "lead"

export type CreateCustomerDirectoryContactInput = {
  readonly name: string
  readonly company: string | null
  readonly email: string | null
  readonly phone: string | null
  readonly address: string | null
  readonly notes: string | null
  readonly relationshipType: CustomerRelationshipType
}

const customerDirectoryUpdateSchema = z.strictObject({
  name: z.string().optional(),
  company: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  addressLine1: z.string().nullable().optional(),
  addressLine2: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  postalCode: z.string().nullable().optional(),
  billingAddressLine1: z.string().nullable().optional(),
  billingAddressLine2: z.string().nullable().optional(),
  billingCity: z.string().nullable().optional(),
  billingState: z.string().nullable().optional(),
  billingPostalCode: z.string().nullable().optional(),
  primaryEmail: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  relationshipType: z.enum(["client", "lead"]).optional(),
})

export async function getCustomers() {
  const user = await requireAuth()
  await requireFeaturePermission(user, "customers", "read")
  const orgId = requireOrg(user)

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  return db.select().from(customers).where(eq(customers.organizationId, orgId))
}

export async function getCustomer(id: string) {
  const user = await requireAuth()
  await requireFeaturePermission(user, "customers", "read")
  const orgId = requireOrg(user)

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  const rows = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, id), eq(customers.organizationId, orgId)))
    .limit(1)

  return rows[0] ?? null
}

export async function createCustomer(
  data: CreateCustomerInput
) {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    // This action enqueues Sage client creation; a directory edit grant alone
    // must not expand who can start that separate workflow.
    requirePermission(user, "customer", "create")
    await requireFeaturePermission(user, "customers", "create")
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    const statusId = parseSageClientStatusId(data.sageClientStatusId)
    if (!statusId) {
      return { success: false, error: "Choose a Sage client status." }
    }
    const name = data.name.trim()
    if (!name) return { success: false, error: "Customer name is required." }
    const operationId = crypto.randomUUID()
    const customerValues = {
      id,
      organizationId: orgId,
      name,
      company: data.company?.trim() || null,
      email: data.email?.trim() || null,
      phone: data.phone?.trim() || null,
      address: data.address?.trim() || null,
      notes: data.notes?.trim() || null,
      sageClientStatusId: statusId,
      createdAt: now,
      updatedAt: now,
    }
    const payload = {
      operationType: "ensure_client" as const,
      company: "High Performance Structures Inc" as const,
      client: {
        compassCustomerId: id,
        name,
        shortName: sageShortName(data.company?.trim() || name),
        company: data.company?.trim() || null,
        email: data.email?.trim() || null,
        phone: data.phone?.trim() || null,
        address: data.address?.trim() || null,
        billingAddress: data.address?.trim() || null,
        notes: data.notes?.trim() || null,
        status: {
          expectedNumber: statusId,
          name: sageClientStatusName(statusId),
        },
      },
    }

    await db.batch([
      db.insert(customers).values(customerValues),
      db.insert(sageClientProjectWriteOperations).values({
        id: operationId,
        organizationId: orgId,
        customerId: id,
        projectId: null,
        requestedByUserId: user.id,
        operationType: "ensure_client",
        idempotencyKey: `customer:${id}`,
        payloadJson: JSON.stringify(payload),
        status: "queued",
        requestedAt: now,
        updatedAt: now,
      }),
    ])

    revalidatePath("/dashboard/customers")
    return {
      success: true,
      id,
      sageStatus: "queued",
    }
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "Failed to create customer",
    }
  }
}

export async function createCustomerDirectoryContact(
  data: CreateCustomerDirectoryContactInput
) {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    await requireFeaturePermission(user, "customers", "create")
    const orgId = requireOrg(user)
    const name = data.name.trim()
    if (!name) {
      return { success: false, error: "Client or lead name is required." }
    }
    if (data.relationshipType !== "client" && data.relationshipType !== "lead") {
      return { success: false, error: "Choose Client or Lead." }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const company = data.company?.trim() || null
    const email = data.email?.trim() || null
    const phone = data.phone?.trim() || null
    const address = data.address?.trim() || null
    const notes = data.notes?.trim() || null
    const nameAndCompanyMatch = and(
      sql`lower(trim(${customers.name})) = ${name.toLowerCase()}`,
      sql`lower(trim(COALESCE(${customers.company}, ''))) = ${(company ?? "").toLowerCase()}`
    )
    const identityMatch = email
      ? or(
          sql`lower(trim(COALESCE(${customers.email}, ''))) = ${email.toLowerCase()}`,
          nameAndCompanyMatch
        )
      : nameAndCompanyMatch
    const existingMatches = await db
      .select()
      .from(customers)
      .where(and(eq(customers.organizationId, orgId), identityMatch))
      .limit(2)
    if (existingMatches.length > 1) {
      return {
        success: false,
        error:
          "More than one directory contact matches. Select the correct existing contact instead.",
      }
    }
    const existing = existingMatches[0]
    if (existing) {
      return { success: true, id: existing.id, existing: true, customer: existing }
    }

    const now = new Date().toISOString()
    const customer = {
      id: crypto.randomUUID(),
      organizationId: orgId,
      name,
      company,
      email,
      phone,
      address,
      notes,
      relationshipType: data.relationshipType,
      createdAt: now,
      updatedAt: now,
    }
    await db.insert(customers).values(customer)

    revalidatePath("/dashboard/customers")
    revalidatePath("/dashboard/contacts")
    revalidatePath("/dashboard/projects", "layout")
    return {
      success: true,
      id: customer.id,
      existing: false,
      customer: {
        ...customer,
        netsuiteId: null,
        sageClientId: null,
        sageClientNumber: null,
        sageClientStatusId: null,
        buildertrendContactId: null,
      },
    }
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to create client or lead contact",
    }
  }
}

export async function updateCustomer(
  id: string,
  data: unknown
) {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    await requireFeaturePermission(user, "customers", "update")
    const orgId = requireOrg(user)
    const parsed = customerDirectoryUpdateSchema.safeParse(data)
    if (!parsed.success) {
      return { success: false, error: "Only client directory details may be edited here." }
    }
    const patch = parsed.data
    if (patch.name !== undefined && !patch.name.trim()) {
      return { success: false, error: "Client name is required." }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const existing = await db
      .select()
      .from(customers)
      .where(and(eq(customers.id, id), eq(customers.organizationId, orgId)))
      .limit(1)
      .get()
    if (!existing) return { success: false, error: "Customer not found" }
    const normalizedExistingEmail = existing.email?.trim() || null
    const normalizedNextEmail = patch.email === undefined
      ? normalizedExistingEmail
      : patch.email?.trim() || null
    if (
      (existing.sageClientId || existing.sageClientNumber) &&
      changesSageLinkedCustomerIdentity(existing, patch)
    ) {
      return {
        success: false,
        error: "This client is linked to Sage. Contact changes need Sage review before Compass can update the directory.",
      }
    }
    if (
      patch.relationshipType !== undefined &&
      patch.relationshipType !== "client" &&
      patch.relationshipType !== "lead"
    ) {
      return { success: false, error: "Choose Client or Lead." }
    }

    const nextIdentity = {
      email: patch.email === undefined ? existing.email : patch.email,
      phone: patch.phone === undefined ? existing.phone : patch.phone,
      address: patch.address === undefined ? existing.address : patch.address,
    }
    const identityChanged = contactIdentityChanged(existing, nextIdentity)
    if (
      identityChanged &&
      (await directoryIdentityManagedByActiveUser({
        db,
        organizationId: orgId,
        entityType: "customer",
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
    const safeData =
      (existing.sageClientId || existing.sageClientNumber) &&
      patch.relationshipType === "lead"
        ? { ...patch, relationshipType: "client" }
        : patch
    const customerUpdate = db
      .update(customers)
      .set({ ...safeData, email: normalizedNextEmail, updatedAt })
      .where(and(eq(customers.id, id), eq(customers.organizationId, orgId)))
    const projectContactUpdate = db
      .update(projectContacts)
      .set({ ...nextIdentity, email: normalizedNextEmail, updatedAt })
      .where(
        and(
          eq(projectContacts.sourceEntityType, "customer"),
          eq(projectContacts.sourceEntityId, id)
        )
      )

    await db.batch([customerUpdate, projectContactUpdate])

    revalidatePath("/dashboard/customers")
    revalidatePath("/dashboard/contacts")
    revalidatePath("/dashboard/projects", "layout")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "Failed to update customer",
    }
  }
}

export async function deleteCustomer(id: string) {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    await requireFeaturePermission(user, "customers", "delete")
    requirePermission(user, "customer", "delete")
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    await db
      .delete(customers)
      .where(and(eq(customers.id, id), eq(customers.organizationId, orgId)))

    revalidatePath("/dashboard/customers")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "Failed to delete customer",
    }
  }
}
