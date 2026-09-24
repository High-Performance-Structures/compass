"use server"

import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import {
  customerContacts,
  customers,
  organizationMembers,
  users,
  vendorContacts,
  vendors,
} from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { canManageUserAccess } from "@/lib/permissions"
import { requireOrg } from "@/lib/org-scope"

export type DirectoryPersonKind = "client_person" | "vendor_person"

export type DirectoryAccountOption = {
  readonly id: string
  readonly name: string
  readonly email: string
  readonly role: string
}

type LinkResult =
  | { readonly success: true; readonly userId: string | null }
  | { readonly success: false; readonly error: string }

function featureFor(kind: DirectoryPersonKind): "customers" | "vendors" {
  return kind === "client_person" ? "customers" : "vendors"
}

function allowedRole(kind: DirectoryPersonKind, role: string): boolean {
  return kind === "client_person"
    ? role === "client"
    : role === "subcontractor" || role === "supplier"
}

async function requireLinkManager(kind: DirectoryPersonKind): Promise<{
  readonly userId: string
  readonly organizationId: string
}> {
  const user = await requireAuth()
  if (isDemoUser(user.id) || !canManageUserAccess(user)) {
    throw new Error("Only an account administrator can link a contact to a Compass login.")
  }
  await requireFeaturePermission(user, featureFor(kind), "update")
  return { userId: user.id, organizationId: requireOrg(user) }
}

export async function listDirectoryAccountOptions(
  kind: DirectoryPersonKind
): Promise<readonly DirectoryAccountOption[]> {
  if (kind !== "client_person" && kind !== "vendor_person") return []
  const manager = await requireLinkManager(kind)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const rows = await db.select({
    id: users.id,
    displayName: users.displayName,
    firstName: users.firstName,
    lastName: users.lastName,
    email: users.email,
    role: organizationMembers.role,
  }).from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(eq(organizationMembers.organizationId, manager.organizationId))
  return rows.filter((row) => allowedRole(kind, row.role)).map((row) => ({
    id: row.id,
    name: row.displayName?.trim() ||
      [row.firstName, row.lastName].filter(Boolean).join(" ").trim() || row.email,
    email: row.email,
    role: row.role,
  })).sort((left, right) => left.name.localeCompare(right.name))
}

/** A deliberate ID selection is required; matching an email is never enough. */
export async function linkDirectoryPersonAccount(
  kind: DirectoryPersonKind,
  personId: string,
  nextUserId: string | null
): Promise<LinkResult> {
  try {
    if (kind !== "client_person" && kind !== "vendor_person") {
      return { success: false, error: "Invalid contact type." }
    }
    if (!personId.trim() || (nextUserId !== null && !nextUserId.trim())) {
      return { success: false, error: "Choose a valid contact and account." }
    }
    const manager = await requireLinkManager(kind)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const person = kind === "client_person"
      ? await db.select({
          userId: customerContacts.userId,
          active: customerContacts.active,
          organizationId: customers.organizationId,
        }).from(customerContacts)
          .innerJoin(customers, eq(customers.id, customerContacts.customerId))
          .where(and(eq(customerContacts.id, personId), eq(customers.organizationId, manager.organizationId)))
          .get()
      : await db.select({
          userId: vendorContacts.userId,
          active: vendorContacts.active,
          organizationId: vendors.organizationId,
        }).from(vendorContacts)
          .innerJoin(vendors, eq(vendors.id, vendorContacts.vendorId))
          .where(and(eq(vendorContacts.id, personId), eq(vendors.organizationId, manager.organizationId), eq(vendors.directoryStatus, "active")))
          .get()
    if (!person) return { success: false, error: "Contact was not found in this organization." }
    if (!person.active) return { success: false, error: "Inactive contacts cannot be linked to an account." }
    if (person.userId === nextUserId) return { success: true, userId: nextUserId }

    if (nextUserId !== null) {
      const account = await db.select({ role: organizationMembers.role })
        .from(organizationMembers)
        .where(and(
          eq(organizationMembers.organizationId, manager.organizationId),
          eq(organizationMembers.userId, nextUserId)
        )).get()
      if (!account || !allowedRole(kind, account.role)) {
        return { success: false, error: "Choose an account with the matching client or vendor role." }
      }
    }

    const now = new Date().toISOString()
    const updateSql = kind === "client_person"
      ? `UPDATE customer_contacts SET user_id = ?, updated_at = ?
         WHERE id = ? AND user_id IS ? AND customer_id IN
           (SELECT id FROM customers WHERE organization_id = ?)`
      : `UPDATE vendor_contacts SET user_id = ?, updated_at = ?
         WHERE id = ? AND user_id IS ? AND vendor_id IN
           (SELECT id FROM vendors WHERE organization_id = ?)`
    // D1 batch is transactional. The audit insert follows the compare-and-set
    // update only when that update actually changed one row.
    const results = await env.DB.batch([
      env.DB.prepare(updateSql).bind(nextUserId, now, personId, person.userId, manager.organizationId),
      env.DB.prepare(
        `INSERT INTO contact_account_link_events
         (id, organization_id, person_kind, person_id, previous_user_id,
          next_user_id, changed_by_user_id, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1`
      ).bind(crypto.randomUUID(), manager.organizationId, kind, personId,
        person.userId, nextUserId, manager.userId, now),
    ])
    if (results[0]?.meta.changes !== 1 || results[1]?.meta.changes !== 1) {
      return { success: false, error: "The account link changed while you were editing. Reload and try again." }
    }
    revalidatePath("/dashboard/contacts")
    revalidatePath("/dashboard/projects", "layout")
    return { success: true, userId: nextUserId }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Could not link contact account." }
  }
}
