"use server"

import { getCloudflareContext } from "@/lib/db"
import { eq, and } from "drizzle-orm"
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
    await db.batch([
      db
        .update(customers)
        .set({ ...data, updatedAt })
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
