import "server-only"

import { and, eq } from "drizzle-orm"

import { customerContacts, customers, vendorContacts, vendors } from "@/db/schema"
import {
  syncCustomerCopiesStatement,
  syncVendorCompanyCopies,
  syncVendorPersonCopiesStatement,
  updateCustomerPerson,
  updateCustomerStatement,
  updateVendor,
  updateVendorPersonStatement,
} from "@/lib/domain/contacts/store"
import { formatVendorAddress } from "@/lib/domain/sage-bridge/vendor-directory-updates"
import type { SageContactField } from "@/lib/sage/contact-change-proposal"
import { SAGE_SHARED_FIELDS, type SageLinkedEditKind } from "@/lib/sage/sage-linked-edit-fields"
import type { Db } from "@/lib/server/action-context"

/**
 * Writes Sage-shared values of a Sage-linked client, vendor or Sage person
 * straight into Compass: the directory record and the project-contact copies
 * that still carry its name, email and phone. Used when staff save an inline
 * edit (Compass shows it at once while Sage catches up through the reviewed
 * change request) and when a rejected change puts Sage's value back.
 * Each Sage field is the Compass column of the same name.
 */

const ADDRESS_PARTS = ["addressLine1", "addressLine2", "city", "state", "postalCode"] as const

type Values = Readonly<Partial<Record<string, string | null>>>

function clean(value: string | null | undefined): string | null {
  const text = value?.trim()
  return text ? text : null
}

type SharedPatch = Partial<Record<Exclude<SageContactField, "name">, string | null>> & { name?: string }

/** Only the record's Sage-shared fields; a blank name is never written. */
function sharedValues(kind: SageLinkedEditKind, values: Values): SharedPatch {
  const patch: SharedPatch = {}
  for (const field of SAGE_SHARED_FIELDS[kind]) {
    if (!Object.prototype.hasOwnProperty.call(values, field)) continue
    const value = clean(values[field])
    if (field === "name") {
      if (value !== null) patch.name = value
    } else {
      patch[field] = value
    }
  }
  return patch
}

function text(row: Readonly<Record<string, unknown>>, field: string): string | null {
  const value = row[field]
  return typeof value === "string" ? value : null
}

/** The one-line address, rebuilt when an address part changed. */
function addressPatch(
  current: Readonly<Record<string, unknown>>,
  patch: SharedPatch
): { readonly address?: string | null } {
  if (!ADDRESS_PARTS.some((part) => Object.prototype.hasOwnProperty.call(patch, part))) return {}
  const part = (name: (typeof ADDRESS_PARTS)[number]): string | null =>
    Object.prototype.hasOwnProperty.call(patch, name) ? patch[name] ?? null : text(current, name)
  return {
    address: formatVendorAddress({
      addressLine1: part("addressLine1"), addressLine2: part("addressLine2"), city: part("city"),
      state: part("state"), postalCode: part("postalCode"),
    }),
  }
}

export type LocalApplyResult = { readonly success: true } | { readonly success: false; readonly error: string }

export async function applySageLinkedValuesInCompass(
  db: Db,
  organizationId: string,
  kind: SageLinkedEditKind,
  entityId: string,
  values: Values,
  now: string
): Promise<LocalApplyResult> {
  const patch = sharedValues(kind, values)
  if (Object.keys(patch).length === 0) return { success: true }
  if (kind === "vendor_company") {
    const vendor = await db.select().from(vendors)
      .where(and(eq(vendors.id, entityId), eq(vendors.organizationId, organizationId))).get()
    if (!vendor) return { success: false, error: "Vendor not found" }
    const next = { ...patch, ...addressPatch(vendor, patch), updatedAt: now }
    await updateVendor(db, { vendorId: entityId, organizationId, values: next })
    const merged = { ...vendor, ...next }
    await syncVendorCompanyCopies(db, {
      vendorId: entityId,
      companyName: merged.name,
      identity: { email: merged.email, phone: merged.phone, address: merged.address, updatedAt: now },
    })
    return { success: true }
  }
  if (kind === "client_company") {
    const customer = await db.select().from(customers)
      .where(and(eq(customers.id, entityId), eq(customers.organizationId, organizationId))).get()
    if (!customer) return { success: false, error: "Client not found" }
    const next = { ...patch, ...addressPatch(customer, patch), updatedAt: now }
    const merged = { ...customer, ...next }
    await db.batch([
      updateCustomerStatement(db, { customerId: entityId, organizationId, values: next }),
      syncCustomerCopiesStatement(db, {
        customerId: entityId,
        identity: { email: merged.email, phone: merged.phone, address: merged.address, updatedAt: now },
      }),
    ])
    return { success: true }
  }
  if (kind === "vendor_person") {
    const person = await db.select({ person: vendorContacts, companyName: vendors.name }).from(vendorContacts)
      .innerJoin(vendors, eq(vendorContacts.vendorId, vendors.id))
      .where(and(eq(vendorContacts.id, entityId), eq(vendors.organizationId, organizationId))).get()
    if (!person) return { success: false, error: "Vendor contact not found" }
    const merged = { ...person.person, ...patch, updatedAt: now }
    await db.batch([
      updateVendorPersonStatement(db, { vendorId: person.person.vendorId, personId: entityId, values: { ...patch, updatedAt: now } }),
      syncVendorPersonCopiesStatement(db, {
        vendorContactId: entityId,
        values: { displayName: merged.name, companyName: person.companyName, email: merged.email, phone: merged.phone, updatedAt: now },
        includeSourceEntityMatch: true,
      }),
    ])
    return { success: true }
  }
  const person = await db.select({ id: customerContacts.id }).from(customerContacts)
    .innerJoin(customers, eq(customerContacts.customerId, customers.id))
    .where(and(eq(customerContacts.id, entityId), eq(customers.organizationId, organizationId))).get()
  if (!person) return { success: false, error: "Client contact not found" }
  await updateCustomerPerson(db, { personId: entityId, values: { ...patch, updatedAt: now } })
  return { success: true }
}
