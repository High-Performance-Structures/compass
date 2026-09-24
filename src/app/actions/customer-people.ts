"use server"

import { and, asc, eq, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import { customerContacts, customers, projectContacts } from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { recordActivityEvent } from "@/lib/activity-log"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { requireOrg } from "@/lib/org-scope"

export type CustomerDirectoryPerson = {
  readonly id: string
  readonly customerId: string
  readonly userId: string | null
  readonly name: string
  readonly title: string | null
  readonly email: string | null
  readonly phone: string | null
  readonly isPrimary: boolean
  readonly sageContactId: string | null
  readonly sageLineNumber: number | null
}

export type CustomerPersonInput = {
  readonly name: string
  readonly title: string
  readonly email: string
  readonly phone: string
  readonly isPrimary: boolean
}

type MutationResult =
  | { readonly success: true; readonly id: string }
  | { readonly success: false; readonly error: string }

export async function getCustomerDirectoryPeople(customerId: string): Promise<readonly CustomerDirectoryPerson[]> {
  const user = await requireAuth()
  await requireFeaturePermission(user, "customers", "read")
  const orgId = requireOrg(user)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  return db.select({
    id: customerContacts.id,
    customerId: customerContacts.customerId,
    userId: customerContacts.userId,
    name: customerContacts.name,
    title: customerContacts.title,
    email: customerContacts.email,
    phone: customerContacts.phone,
    isPrimary: customerContacts.isPrimary,
    sageContactId: customerContacts.sageContactId,
    sageLineNumber: customerContacts.sageLineNumber,
  }).from(customerContacts)
    .innerJoin(customers, eq(customers.id, customerContacts.customerId))
    .where(and(eq(customers.id, customerId), eq(customers.organizationId, orgId), eq(customerContacts.active, true)))
    .orderBy(asc(customerContacts.name))
}

function normalized(input: CustomerPersonInput): CustomerPersonInput {
  return {
    name: input.name.trim(),
    title: input.title.trim(),
    email: input.email.trim().toLowerCase(),
    phone: input.phone.trim(),
    isPrimary: input.isPrimary,
  }
}

export async function saveCustomerDirectoryPerson(
  customerId: string,
  personId: string | null,
  input: CustomerPersonInput
): Promise<MutationResult> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) return { success: false, error: "DEMO_READ_ONLY" }
    await requireFeaturePermission(user, "customers", personId ? "update" : "create")
    const orgId = requireOrg(user)
    const value = normalized(input)
    if (!value.name) return { success: false, error: "Contact name is required." }
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const company = await db.select({ sageClientId: customers.sageClientId, sageClientNumber: customers.sageClientNumber })
      .from(customers).where(and(eq(customers.id, customerId), eq(customers.organizationId, orgId))).get()
    if (!company) return { success: false, error: "Client was not found." }
    if (company.sageClientId || company.sageClientNumber) {
      return { success: false, error: "Use the reviewed Sage workflow for contacts at this client." }
    }
    const now = new Date().toISOString()
    const id = personId ?? crypto.randomUUID()
    if (personId) {
      const existing = await db.select({ sageContactId: customerContacts.sageContactId })
        .from(customerContacts).where(and(
          eq(customerContacts.id, personId), eq(customerContacts.customerId, customerId),
          eq(customerContacts.active, true)
        )).get()
      if (!existing) return { success: false, error: "Contact was not found." }
      if (existing.sageContactId) return { success: false, error: "Use Sage review for a linked contact." }
      await db.update(customerContacts).set({
        name: value.name, title: value.title || null, email: value.email || null,
        phone: value.phone || null, isPrimary: value.isPrimary, updatedAt: now,
      }).where(eq(customerContacts.id, personId)).run()
    } else {
      await db.insert(customerContacts).values({
        id, customerId, name: value.name, title: value.title || null,
        email: value.email || null, phone: value.phone || null,
        isPrimary: value.isPrimary, sourceSystem: "manual", createdAt: now, updatedAt: now,
      }).run()
    }
    if (value.isPrimary) {
      await db.update(customerContacts).set({ isPrimary: false, updatedAt: now })
        .where(and(eq(customerContacts.customerId, customerId), sql`${customerContacts.id} <> ${id}`)).run()
    }
    await recordActivityEvent({
      db, organizationId: orgId,
      actor: { id: user.id, email: user.email, displayName: user.displayName,
        firstName: user.firstName, lastName: user.lastName, role: user.role },
      category: "account", action: personId ? "customer_contact.updated" : "customer_contact.created",
      entityType: "customer_contact", entityId: id,
      summary: `${personId ? "Updated" : "Created"} a client contact person.`,
      metadata: { customerId },
    })
    revalidatePath("/dashboard/contacts")
    revalidatePath("/dashboard/projects", "layout")
    return { success: true, id }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Could not save contact." }
  }
}

export async function deleteCustomerDirectoryPerson(personId: string): Promise<MutationResult> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) return { success: false, error: "DEMO_READ_ONLY" }
    await requireFeaturePermission(user, "customers", "delete")
    const orgId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const person = await db.select({
      id: customerContacts.id, userId: customerContacts.userId,
      sageContactId: customerContacts.sageContactId,
    }).from(customerContacts).innerJoin(customers, eq(customers.id, customerContacts.customerId))
      .where(and(eq(customerContacts.id, personId), eq(customers.organizationId, orgId), eq(customerContacts.active, true))).get()
    if (!person) return { success: false, error: "Contact was not found." }
    if (person.userId || person.sageContactId) {
      return { success: false, error: "Unlink the Compass account or resolve the Sage link before removing this contact." }
    }
    const assignment = await db.select({ id: projectContacts.id }).from(projectContacts)
      .where(eq(projectContacts.customerContactId, personId)).limit(1).get()
    if (assignment) return { success: false, error: "Remove this person from project contacts first." }
    await db.update(customerContacts).set({ active: false, updatedAt: new Date().toISOString() })
      .where(eq(customerContacts.id, personId)).run()
    await recordActivityEvent({
      db, organizationId: orgId,
      actor: { id: user.id, email: user.email, displayName: user.displayName,
        firstName: user.firstName, lastName: user.lastName, role: user.role },
      category: "account", action: "customer_contact.removed",
      entityType: "customer_contact", entityId: personId,
      summary: "Removed a client contact person from the active directory.",
    })
    revalidatePath("/dashboard/contacts")
    return { success: true, id: personId }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Could not remove contact." }
  }
}
