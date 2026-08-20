"use server"

import { getCloudflareContext } from "@/lib/db"
import { eq, and, or, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { customers, projectContacts, type NewCustomer } from "@/db/schema"
import { sageClientProjectWriteOperations } from "@/db/schema-sage"
import { requireAuth } from "@/lib/auth"
import { requirePermission } from "@/lib/permissions"
import { revalidatePath } from "next/cache"
import { requireOrg } from "@/lib/org-scope"
import { isDemoUser } from "@/lib/demo"
import {
  isSageWriteApproved,
  parseSageClientStatusId,
  sageClientStatusName,
  sageShortName,
  type SageClientStatusId,
} from "@/lib/sage/client-project-write"
import {
  contactIdentityChanged,
  directoryIdentityManagedByActiveUser,
} from "@/lib/contact-identity-ownership"

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

export async function getCustomers() {
  const user = await requireAuth()
  requirePermission(user, "customer", "read")
  const orgId = requireOrg(user)

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  return db.select().from(customers).where(eq(customers.organizationId, orgId))
}

export async function getCustomer(id: string) {
  const user = await requireAuth()
  requirePermission(user, "customer", "read")
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
    requirePermission(user, "customer", "create")
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
    const approved = await isSageWriteApproved(db, orgId, user.id)
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
        status: approved ? "queued" : "approval_required",
        requestedAt: now,
        updatedAt: now,
      }),
    ])

    revalidatePath("/dashboard/customers")
    return {
      success: true,
      id,
      sageStatus: approved ? "queued" : "approval_required",
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
    requirePermission(user, "customer", "create")
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
  data: Partial<NewCustomer>
) {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(user, "customer", "update")
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const existing = await db
      .select()
      .from(customers)
      .where(and(eq(customers.id, id), eq(customers.organizationId, orgId)))
      .limit(1)
      .get()
    if (!existing) return { success: false, error: "Customer not found" }
    if (
      data.relationshipType !== undefined &&
      data.relationshipType !== "client" &&
      data.relationshipType !== "lead"
    ) {
      return { success: false, error: "Choose Client or Lead." }
    }

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
      data.relationshipType === "lead"
        ? { ...data, relationshipType: "client" }
        : data
    await db.batch([
      db
        .update(customers)
        .set({ ...safeData, updatedAt })
        .where(and(eq(customers.id, id), eq(customers.organizationId, orgId))),
      db
        .update(projectContacts)
        .set({ ...nextIdentity, updatedAt })
        .where(
          and(
            eq(projectContacts.sourceEntityType, "customer"),
            eq(projectContacts.sourceEntityId, id)
          )
        ),
    ])

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
