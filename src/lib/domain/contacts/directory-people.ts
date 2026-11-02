/**
 * Adding a person to a vendor or client company in the directory. The
 * Contacts page, the project contact editor and "Connect to company…" on
 * the Unassigned tab all add people through these, so the rules (Sage-linked
 * vendors use Sage review, one active name per client) are in one place.
 * Callers check permissions, log activity and revalidate.
 */
import { and, eq, isNull, sql } from "drizzle-orm"

import { customerContacts, customers, vendors } from "@/db/schema"
import type { ActionFailure } from "@/lib/action-result"
import type { Db } from "@/lib/server/action-context"

import type { VendorContactItem } from "./directory-page"
import {
  clearOtherCustomerPrimaryPeople,
  clearVendorPrimaryPeople,
  insertCustomerPerson,
  insertVendorPeople,
  updateCustomerPerson,
} from "./store"

export type DirectoryPersonInput = {
  readonly name: string
  readonly title: string
  readonly email: string
  readonly phone: string
  readonly isPrimary: boolean
}

function nullableText(value: string): string | null {
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

/** A new person on an active, non-Sage vendor company. */
export async function addVendorPerson(
  db: Db,
  input: { readonly organizationId: string; readonly vendorId: string; readonly person: DirectoryPersonInput; readonly now: string }
): Promise<{ readonly success: true; readonly contact: VendorContactItem } | ActionFailure> {
  const name = input.person.name.trim()
  if (!name) return { success: false, error: "Contact name is required" }
  const vendor = await db
    .select({ id: vendors.id, sageVendorId: vendors.sageVendorId, sageVendorNumber: vendors.sageVendorNumber })
    .from(vendors)
    .where(and(eq(vendors.id, input.vendorId), eq(vendors.organizationId, input.organizationId), eq(vendors.directoryStatus, "active")))
    .get()
  if (!vendor) return { success: false, error: "Vendor company not found" }
  if (vendor.sageVendorId || vendor.sageVendorNumber) {
    return {
      success: false,
      error: "This vendor is linked to Sage. Add its contact through the reviewed Sage workflow.",
    }
  }
  if (input.person.isPrimary) await clearVendorPrimaryPeople(db, { vendorId: input.vendorId, now: input.now })
  const contact: VendorContactItem = {
    id: crypto.randomUUID(),
    vendorId: input.vendorId,
    name,
    title: nullableText(input.person.title),
    email: nullableText(input.person.email),
    phone: nullableText(input.person.phone),
    isPrimary: input.person.isPrimary,
    active: true,
    sourceSystem: "manual",
    userId: null,
    sageContactId: null,
    sageLineNumber: null,
  }
  await insertVendorPeople(db, [{ ...contact, sourceRecordId: null, createdAt: input.now, updatedAt: input.now }])
  return { success: true, contact }
}

/** Adds (personId null) or edits a named person on a client or lead. */
export async function saveCustomerPerson(
  db: Db,
  input: {
    readonly organizationId: string
    readonly customerId: string
    readonly personId: string | null
    readonly person: DirectoryPersonInput
    readonly now: string
  }
): Promise<{ readonly success: true; readonly id: string } | ActionFailure> {
  const value = {
    name: input.person.name.trim(),
    title: input.person.title.trim(),
    email: input.person.email.trim().toLowerCase(),
    phone: input.person.phone.trim(),
    isPrimary: input.person.isPrimary,
  }
  if (!value.name) return { success: false, error: "Contact name is required." }
  const { customerId, personId, now } = input
  const company = await db.select({ id: customers.id })
    .from(customers).where(and(eq(customers.id, customerId), eq(customers.organizationId, input.organizationId),
      isNull(customers.mergedIntoCustomerId))).get()
  if (!company) return { success: false, error: "Client was not found." }
  // A named Compass contact is not a Sage write. Sage child creation still
  // requires its separate reviewed proposal, even for a verified client.
  const id = personId ?? crypto.randomUUID()
  const existingName = await db.select({ id: customerContacts.id })
    .from(customerContacts).where(and(
      eq(customerContacts.customerId, customerId),
      eq(customerContacts.active, true),
      sql`lower(trim(${customerContacts.name})) = ${value.name.toLowerCase()}`,
      sql`${customerContacts.id} <> ${id}`
    )).limit(1).get()
  if (existingName) {
    return { success: false, error: "This person is already listed for this client. Select the existing name instead." }
  }
  if (personId) {
    const existing = await db.select({ sageContactId: customerContacts.sageContactId })
      .from(customerContacts).where(and(
        eq(customerContacts.id, personId), eq(customerContacts.customerId, customerId),
        eq(customerContacts.active, true)
      )).get()
    if (!existing) return { success: false, error: "Contact was not found." }
    if (existing.sageContactId) return { success: false, error: "Use Sage review for a linked contact." }
    await updateCustomerPerson(db, { personId, values: {
      name: value.name, title: value.title || null, email: value.email || null,
      phone: value.phone || null, isPrimary: value.isPrimary, updatedAt: now,
    } })
  } else {
    await insertCustomerPerson(db, {
      id, customerId, name: value.name, title: value.title || null,
      email: value.email || null, phone: value.phone || null,
      isPrimary: value.isPrimary, sourceSystem: "manual", createdAt: now, updatedAt: now,
    })
  }
  if (value.isPrimary) {
    await clearOtherCustomerPrimaryPeople(db, { customerId, keepPersonId: id, now })
  }
  return { success: true, id }
}
