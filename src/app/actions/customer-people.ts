"use server"

import { and, asc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { customerContacts, customers, projectContacts } from "@/db/schema"
import { recordActivityEvent } from "@/lib/activity-log"
import { saveCustomerPerson } from "@/lib/domain/contacts/directory-people"
import { stalePendingInvitationCount, stalePendingInvitationWarning } from "@/lib/domain/contacts/pending-invitations"
import { updateCustomerPerson } from "@/lib/domain/contacts/store"
import { isDemoUser } from "@/lib/demo"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { requireOrg } from "@/lib/org-scope"
import { requireUserContext } from "@/lib/server/action-context"

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
  | { readonly success: true; readonly id: string; readonly warning?: string }
  | { readonly success: false; readonly error: string }

export async function getCustomerDirectoryPeople(customerId: string): Promise<readonly CustomerDirectoryPerson[]> {
  const { user, db } = await requireUserContext()
  await requireFeaturePermission(user, "customers", "read")
  const orgId = requireOrg(user)
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

export async function saveCustomerDirectoryPerson(
  customerId: string,
  personId: string | null,
  input: CustomerPersonInput
): Promise<MutationResult> {
  try {
    const { user, db } = await requireUserContext()
    if (isDemoUser(user.id)) return { success: false, error: "DEMO_READ_ONLY" }
    await requireFeaturePermission(user, "customers", personId ? "update" : "create")
    const orgId = requireOrg(user)
    const now = new Date().toISOString()
    const before = personId
      ? await db.select({ email: customerContacts.email }).from(customerContacts)
          .where(and(eq(customerContacts.id, personId), eq(customerContacts.customerId, customerId))).get()
      : undefined
    const saved = await saveCustomerPerson(db, {
      organizationId: orgId, customerId, personId, person: input, now,
    })
    if (!saved.success) return saved
    const { id } = saved
    // A pending (unaccepted) invitation stays at the old address; warn, never resend.
    const nextEmail = input.email.trim().toLowerCase()
    const warning = before && (before.email?.trim().toLowerCase() ?? "") !== nextEmail
      ? stalePendingInvitationWarning(await stalePendingInvitationCount(db, {
          organizationId: orgId, person: { kind: "customer_contact", id }, nextEmail, now,
        }))
      : null
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
    return warning ? { success: true, id, warning } : { success: true, id }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Could not save contact." }
  }
}

export async function deleteCustomerDirectoryPerson(personId: string): Promise<MutationResult> {
  try {
    const { user, db } = await requireUserContext()
    if (isDemoUser(user.id)) return { success: false, error: "DEMO_READ_ONLY" }
    await requireFeaturePermission(user, "customers", "delete")
    const orgId = requireOrg(user)
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
    await updateCustomerPerson(db, { personId, values: { active: false, updatedAt: new Date().toISOString() } })
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
