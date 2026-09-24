import "server-only"

import type { SageContactKind } from "@/lib/sage/contact-change-proposal"
import type { SageContactEntityIdentity } from "@/lib/sage/contact-entity"

type Snapshot = {
  readonly kind: SageContactKind
  readonly entityId: string
  readonly sageRecordId: string
  readonly sageRecordNumber: string | null
  readonly parentSageRecordId: string | null
  readonly fields: Readonly<Record<string, string | null>>
}

type CanonicalUpdateResult =
  | { readonly success: true }
  | { readonly success: false; readonly error: string }

const CLIENT_COMPANY: Readonly<Record<string, string>> = {
  addressLine1: "address_line_1", addressLine2: "address_line_2",
  city: "city", state: "state", postalCode: "postal_code",
  billingAddressLine1: "billing_address_line_1",
  billingAddressLine2: "billing_address_line_2",
  billingCity: "billing_city", billingState: "billing_state",
  billingPostalCode: "billing_postal_code",
}
const VENDOR_COMPANY: Readonly<Record<string, string>> = {
  ownerName: "owner_name", addressLine1: "address_line_1",
  addressLine2: "address_line_2", city: "city", state: "state",
  postalCode: "postal_code",
}
const PERSON: Readonly<Record<string, string>> = {
  name: "name", title: "title", email: "email", phone: "phone",
  phoneExtension: "phone_extension", cellPhone: "cell_phone",
}
const EMPLOYEE: Readonly<Record<string, string>> = {
  email: "email", phone: "phone", cellPhone: "cell_phone",
}
const EMPLOYEE_PRIVATE: Readonly<Record<string, string>> = {
  addressLine1: "address_line_1", addressLine2: "address_line_2",
  city: "city", state: "state", postalCode: "postal_code",
}

function patchFor(
  fields: Readonly<Record<string, string | null>>,
  mapping: Readonly<Record<string, string>>
): { readonly clauses: readonly string[]; readonly values: readonly (string | null)[] } {
  const clauses: string[] = []
  const values: (string | null)[] = []
  for (const [field, column] of Object.entries(mapping)) {
    if (!Object.prototype.hasOwnProperty.call(fields, field)) continue
    clauses.push(`\`${column}\` = ?`)
    values.push(fields[field] ?? null)
  }
  return { clauses, values }
}

function updateAssignments(sageIdColumn: string, patch: { readonly clauses: readonly string[] }): string {
  return [`\`${sageIdColumn}\` = ?`, ...patch.clauses, "updated_at = ?"].join(", ")
}

/** Only signed, validated Sage snapshots may call this function. */
export async function applySageContactSnapshotToCanonical(
  database: D1Database,
  organizationId: string,
  identity: SageContactEntityIdentity,
  snapshot: Snapshot
): Promise<CanonicalUpdateResult> {
  if (identity.sageRecordId && identity.sageRecordId !== snapshot.sageRecordId) {
    return { success: false, error: "Sage record ID does not match the directory link." }
  }
  if (!identity.sageRecordId && (!identity.sageRecordNumber ||
    identity.sageRecordNumber !== snapshot.sageRecordNumber)) {
    return { success: false, error: "Sage record number does not match the directory link." }
  }
  if (identity.parentSageRecordId !== snapshot.parentSageRecordId) {
    return { success: false, error: "Sage parent company does not match the directory link." }
  }
  const now = new Date().toISOString()
  let statement: D1PreparedStatement
  if (snapshot.kind === "client_company") {
    const patch = patchFor(snapshot.fields, CLIENT_COMPANY)
    statement = database.prepare(
      `UPDATE customers SET ${updateAssignments("sage_client_id", patch)}
       WHERE id = ? AND organization_id = ? AND
         (sage_client_id = ? OR (sage_client_id IS NULL AND sage_client_number = ?))`
    ).bind(snapshot.sageRecordId, ...patch.values, now, snapshot.entityId,
      organizationId, snapshot.sageRecordId, snapshot.sageRecordNumber)
  } else if (snapshot.kind === "vendor_company") {
    const patch = patchFor(snapshot.fields, VENDOR_COMPANY)
    statement = database.prepare(
      `UPDATE vendors SET ${updateAssignments("sage_vendor_id", patch)}
       WHERE id = ? AND organization_id = ? AND
         (sage_vendor_id = ? OR (sage_vendor_id IS NULL AND sage_vendor_number = ?))`
    ).bind(snapshot.sageRecordId, ...patch.values, now, snapshot.entityId,
      organizationId, snapshot.sageRecordId, snapshot.sageRecordNumber)
  } else if (snapshot.kind === "client_person") {
    const patch = patchFor(snapshot.fields, PERSON)
    statement = database.prepare(
      `UPDATE customer_contacts SET ${updateAssignments("sage_contact_id", patch)}
       WHERE id = ? AND (sage_contact_id = ? OR (sage_contact_id IS NULL AND sage_line_number = ?))
         AND customer_id IN (SELECT id FROM customers WHERE organization_id = ? AND sage_client_id = ?)`
    ).bind(snapshot.sageRecordId, ...patch.values, now, snapshot.entityId,
      snapshot.sageRecordId, snapshot.sageRecordNumber,
      organizationId, snapshot.parentSageRecordId)
  } else if (snapshot.kind === "vendor_person") {
    const patch = patchFor(snapshot.fields, PERSON)
    statement = database.prepare(
      `UPDATE vendor_contacts SET ${updateAssignments("sage_contact_id", patch)}
       WHERE id = ? AND (sage_contact_id = ? OR (sage_contact_id IS NULL AND sage_line_number = ?))
         AND vendor_id IN (SELECT id FROM vendors WHERE organization_id = ? AND sage_vendor_id = ?)`
    ).bind(snapshot.sageRecordId, ...patch.values, now, snapshot.entityId,
      snapshot.sageRecordId, snapshot.sageRecordNumber,
      organizationId, snapshot.parentSageRecordId)
  } else {
    const patch = patchFor(snapshot.fields, EMPLOYEE)
    statement = database.prepare(
      `UPDATE internal_contacts SET ${updateAssignments("sage_employee_id", patch)}
       WHERE id = ? AND organization_id = ? AND
         (sage_employee_id = ? OR (sage_employee_id IS NULL AND sage_employee_number = ?))`
    ).bind(snapshot.sageRecordId, ...patch.values, now, snapshot.entityId,
      organizationId, snapshot.sageRecordId, snapshot.sageRecordNumber)
  }
  const result = await statement.run()
  if (result.meta.changes !== 1) {
    return { success: false, error: "The canonical directory link changed before Sage read-back." }
  }
  if (snapshot.kind === "employee") {
    const privatePatch = patchFor(snapshot.fields, EMPLOYEE_PRIVATE)
    if (privatePatch.clauses.length > 0) {
      const columns = privatePatch.clauses.map((clause) => clause.slice(1, clause.indexOf("`", 1)))
      const placeholders = columns.map(() => "?").join(", ")
      const updates = columns.map((column) => `\`${column}\` = excluded.\`${column}\``).join(", ")
      await database.prepare(
        `INSERT INTO internal_contact_private_addresses
         (internal_contact_id, ${columns.map((column) => `\`${column}\``).join(", ")}, updated_at)
         VALUES (?, ${placeholders}, ?)
         ON CONFLICT(internal_contact_id) DO UPDATE SET
           ${updates},
           updated_at = excluded.updated_at`
      ).bind(snapshot.entityId, ...privatePatch.values, now).run()
    }
  }
  return { success: true }
}
