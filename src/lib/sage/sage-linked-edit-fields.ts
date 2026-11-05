/**
 * Which fields of a Sage-linked client or vendor (and their Sage people) are
 * shared with Sage and which are Compass's own, for the inline edit forms.
 *
 * Every save writes Compass directly. A change to a Sage-shared field also
 * becomes one reviewed Sage change request per record
 * (sage_contact_change_proposals); until it is written or rejected, Sage
 * syncs leave the field alone (sage-held-fields.ts). Pure: no I/O.
 */
import type { SageContactField, SageContactKind } from "@/lib/sage/contact-change-proposal"

export type SageLinkedEditKind = Extract<SageContactKind, "client_company" | "vendor_company" | "client_person" | "vendor_person">

/**
 * Sage-shared fields edited on the Contacts forms. Each is a Sage proposal
 * field of the same name and a Compass column of the same name.
 * Client primary email is not here: its Sage screen binding is unverified
 * (docs/wip/shared-contact-directory-sage-field-map.md), so it is saved in
 * Compass only (no Sage read writes it either).
 */
export const SAGE_SHARED_FIELDS: Readonly<Record<SageLinkedEditKind, readonly SageContactField[]>> = {
  vendor_company: [
    "name", "ownerName", "email", "phone", "primaryEmail",
    "addressLine1", "addressLine2", "city", "state", "postalCode",
  ],
  client_company: [
    "name", "email", "phone",
    "addressLine1", "addressLine2", "city", "state", "postalCode",
    "billingAddressLine1", "billingAddressLine2", "billingCity", "billingState", "billingPostalCode",
  ],
  vendor_person: ["name", "title", "email", "phone"],
  client_person: ["name", "title", "email", "phone"],
}

/** Fields saved straight to Compass even when the record is linked to Sage. */
export const COMPASS_ONLY_FIELDS: Readonly<Record<SageLinkedEditKind, readonly string[]>> = {
  // Category follows Sage's vendor type when the company maps one (#1142);
  // otherwise it is Compass's own.
  vendor_company: ["category"],
  client_company: ["company", "notes", "primaryEmail"],
  vendor_person: [],
  client_person: [],
}

export const SAGE_FIELD_LABELS: Readonly<Record<SageContactField, string>> = {
  name: "Name", title: "Job title", ownerName: "Owner",
  addressLine1: "Address 1", addressLine2: "Address 2", city: "City",
  state: "State", postalCode: "ZIP code",
  billingAddressLine1: "Billing address 1", billingAddressLine2: "Billing address 2",
  billingCity: "Billing city", billingState: "Billing state",
  billingPostalCode: "Billing ZIP code", primaryEmail: "Primary email",
  email: "Email", phone: "Phone", phoneExtension: "Extension", cellPhone: "Cell phone",
}

function clean(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : ""
  return text.length > 0 ? text : null
}

/**
 * The Sage-shared fields whose submitted value differs from Compass's current
 * value, with the cleaned new value. Fields not submitted are left alone.
 */
export function sageSharedChanges(
  kind: SageLinkedEditKind,
  current: Readonly<Record<string, unknown>>,
  submitted: Readonly<Record<string, unknown>>
): Readonly<Partial<Record<SageContactField, string | null>>> {
  const changes: Partial<Record<SageContactField, string | null>> = {}
  for (const field of SAGE_SHARED_FIELDS[kind]) {
    if (!Object.prototype.hasOwnProperty.call(submitted, field)) continue
    const after = clean(submitted[field])
    if (after !== clean(current[field])) changes[field] = after
  }
  return changes
}

/** True when an open request already asks for exactly these new values. */
export function sameRequestedChanges(
  open: readonly { readonly field: string; readonly after: string | null }[],
  requested: Readonly<Partial<Record<string, string | null>>>
): boolean {
  const keys = Object.keys(requested)
  return keys.length === open.length && open.every((change) =>
    Object.prototype.hasOwnProperty.call(requested, change.field) &&
    clean(requested[change.field]) === clean(change.after))
}

/** "Phone: 555-0100 → 555-0199; Name: Acme → Acme Inc" for Activity. */
export function describeSageChanges(
  changes: readonly { readonly field: string; readonly before: string | null; readonly after: string | null }[]
): string {
  const labels: Readonly<Record<string, string>> = SAGE_FIELD_LABELS
  return changes.map((change) => {
    const label = labels[change.field] ?? change.field
    return `${label}: ${change.before ?? "(blank)"} → ${change.after ?? "(blank)"}`
  }).join("; ")
}

/** The Activity entity a Sage contact record is logged under. */
export function sageContactActivityEntityType(kind: SageContactKind): string {
  switch (kind) {
    case "client_company": return "customer"
    case "vendor_company": return "vendor"
    case "client_person": return "customer_contact"
    case "vendor_person": return "vendor_contact"
    case "employee": return "internal_contact"
  }
}
