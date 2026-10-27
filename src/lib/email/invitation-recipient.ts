import "server-only"

import { and, eq, sql } from "drizzle-orm"
import type { getDb } from "@/db"
import { customerContacts, customers, internalContacts, organizationMembers, projectContacts, projects, users, vendorContacts, vendors } from "@/db/schema"
import { projectContactNeedsPersonForInvitation } from "@/lib/project-contact-access-status"
import { isInternalStaffRole } from "@/lib/user-roles"

type Db = ReturnType<typeof getDb>
type Person = { readonly email: string | null; readonly userId: string | null }

/** Directory identity can change while a welcome waits for the provider. */
export async function currentInvitationRecipient(db: Db, input: {
  readonly projectId: string
  readonly contactId: string
  readonly organizationId: string
  readonly role: string
}): Promise<string | null> {
  const contact = await db.select({
    contactType: projectContacts.contactType, email: projectContacts.email,
    customerId: projectContacts.customerId, customerContactId: projectContacts.customerContactId,
    vendorId: projectContacts.vendorId, vendorContactId: projectContacts.vendorContactId,
    internalContactId: projectContacts.internalContactId, sourceEntityType: projectContacts.sourceEntityType,
    sourceEntityId: projectContacts.sourceEntityId,
  }).from(projectContacts).innerJoin(projects, eq(projects.id, projectContacts.projectId)).where(and(
    eq(projectContacts.id, input.contactId), eq(projectContacts.projectId, input.projectId),
    eq(projects.organizationId, input.organizationId), eq(projectContacts.active, true),
  )).get()
  if (!contact || projectContactNeedsPersonForInvitation(contact)) return null
  if (!isInternalStaffRole(input.role) && contact.contactType !== input.role &&
    !(input.role === "client" && contact.contactType === "owner")) return null
  let identity: Person | undefined = { email: contact.email, userId: null }
  if (contact.customerContactId) {
    const parentId = contact.customerId ?? (contact.sourceEntityType === "customer" ? contact.sourceEntityId : null)
    if (!parentId) return null
    identity = await db.select({ email: customerContacts.email, userId: customerContacts.userId })
      .from(customerContacts).innerJoin(customers, eq(customers.id, customerContacts.customerId)).where(and(
        eq(customerContacts.id, contact.customerContactId), eq(customerContacts.customerId, parentId), eq(customerContacts.active, true),
        eq(customers.organizationId, input.organizationId),
      )).get()
  } else if (contact.vendorContactId) {
    const parentId = contact.vendorId ?? (contact.sourceEntityType === "vendor" ? contact.sourceEntityId : null)
    if (!parentId) return null
    identity = await db.select({ email: vendorContacts.email, userId: vendorContacts.userId })
      .from(vendorContacts).innerJoin(vendors, eq(vendors.id, vendorContacts.vendorId)).where(and(
        eq(vendorContacts.id, contact.vendorContactId), eq(vendorContacts.vendorId, parentId), eq(vendorContacts.active, true),
        eq(vendors.organizationId, input.organizationId),
      )).get()
  } else if (contact.internalContactId) {
    identity = await db.select({ email: internalContacts.email, userId: internalContacts.userId }).from(internalContacts).where(and(
      eq(internalContacts.id, contact.internalContactId), eq(internalContacts.active, true), eq(internalContacts.organizationId, input.organizationId),
    )).get()
  } else if (contact.sourceEntityType === "user" && contact.sourceEntityId) {
    identity = { email: null, userId: contact.sourceEntityId }
  } else {
    const customerId = contact.customerId ?? (contact.sourceEntityType === "customer" ? contact.sourceEntityId : null)
    const vendorId = contact.vendorId ?? (contact.sourceEntityType === "vendor" ? contact.sourceEntityId : null)
    if (customerId) {
      const row = await db.select({ email: customers.email }).from(customers).where(and(eq(customers.id, customerId), eq(customers.organizationId, input.organizationId))).get()
      identity = row ? { email: row.email, userId: null } : undefined
    } else if (vendorId) {
      const row = await db.select({ email: vendors.email }).from(vendors).where(and(eq(vendors.id, vendorId), eq(vendors.organizationId, input.organizationId))).get()
      identity = row ? { email: row.email, userId: null } : undefined
    }
  }
  if (!identity) return null
  if (identity.userId) {
    const linked = await db.select({ email: users.email, active: users.isActive, id: users.id, role: organizationMembers.role }).from(users)
      .innerJoin(organizationMembers, and(eq(organizationMembers.userId, users.id), eq(organizationMembers.organizationId, input.organizationId)))
      .where(eq(users.id, identity.userId)).get()
    if (!linked || (!linked.active && linked.id.startsWith("user_"))) return null
    if (contact.contactType === "owner" && linked.role !== "client") return null
    if (["supplier", "subcontractor"].includes(contact.contactType) && !["supplier", "subcontractor"].includes(linked.role)) return null
    if (contact.contactType === "internal" && !isInternalStaffRole(linked.role)) return null
    return linked.email.trim().toLowerCase()
  }
  const email = identity.email?.trim().toLowerCase()
  if (!email) return null
  const account = await db.select({ id: users.id, active: users.isActive }).from(users)
    .where(sql`lower(trim(${users.email})) = ${email}`).get()
  if (account && !account.active && account.id.startsWith("user_")) return null
  return email
}
