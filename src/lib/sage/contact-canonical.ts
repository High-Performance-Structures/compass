import "server-only"

import { getDb } from "@/db"
import {
  sageSnapshotDirectoryUpdateStatement,
  upsertInternalContactPrivateAddressStatement,
} from "@/lib/domain/contacts/store"
import type { SageContactKind } from "@/lib/sage/contact-change-proposal"
import type { SageContactEntityIdentity } from "@/lib/sage/contact-entity"
import { sageContactIdentityError } from "@/lib/sage/contact-bridge"
import { formatVendorAddress } from "@/lib/domain/sage-bridge/vendor-directory-updates"
import { noNewSageHoldGuard, sageHolds, withoutHeldFields } from "@/lib/sage/sage-held-fields"

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
  postalCode: "postal_code", primaryEmail: "primary_email",
}
/**
 * Company name, email and phone take Sage's value only when an approved
 * proposal wrote them, never on a plain read: Compass's display name may
 * differ on purpose ("Use Sage name" adopts it explicitly).
 */
const COMPANY_WRITTEN_ONLY: Readonly<Record<string, string>> = {
  name: "name", email: "email", phone: "phone",
}
const ADDRESS_PARTS = ["addressLine1", "addressLine2", "city", "state", "postalCode"] as const
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

/**
 * The company columns an approved write confirmed: name, email and phone it
 * changed (a blank name is never copied), and the one-line address rebuilt
 * when an address part changed.
 */
function writtenCompanyPatch(
  fields: Readonly<Record<string, string | null>>,
  writtenFields: readonly string[]
): { readonly clauses: readonly string[]; readonly values: readonly (string | null)[] } {
  const written = Object.fromEntries(Object.entries(COMPANY_WRITTEN_ONLY).filter(([field]) =>
    writtenFields.includes(field) && (field !== "name" || Boolean(fields[field]?.trim()))))
  const patch = patchFor(fields, written)
  if (!ADDRESS_PARTS.some((part) => writtenFields.includes(part))) return patch
  // A held address part is missing here; the one-line address keeps Compass's value.
  if (!ADDRESS_PARTS.every((part) => Object.prototype.hasOwnProperty.call(fields, part))) return patch
  const address = formatVendorAddress({
    addressLine1: fields.addressLine1 ?? null, addressLine2: fields.addressLine2 ?? null,
    city: fields.city ?? null, state: fields.state ?? null, postalCode: fields.postalCode ?? null,
  })
  return { clauses: [...patch.clauses, "`address` = ?"], values: [...patch.values, address] }
}

function merged(
  left: { readonly clauses: readonly string[]; readonly values: readonly (string | null)[] },
  right: { readonly clauses: readonly string[]; readonly values: readonly (string | null)[] }
): { readonly clauses: readonly string[]; readonly values: readonly (string | null)[] } {
  return { clauses: [...left.clauses, ...right.clauses], values: [...left.values, ...right.values] }
}

/** Only signed, validated Sage snapshots may call this function. */
export async function applySageContactSnapshotToCanonical(
  database: D1Database,
  organizationId: string,
  identity: SageContactEntityIdentity,
  snapshot: Snapshot,
  /** The fields an approved proposal wrote; empty for a plain read. */
  writtenFields: readonly string[] = [],
  /** The proposal whose confirmed write this is: its fields are no longer held. */
  options: { readonly releaseProposalId?: string } = {}
): Promise<CanonicalUpdateResult> {
  const identityError = sageContactIdentityError(identity, snapshot)
  if (identityError) return { success: false, error: identityError }
  // Compass already shows the value of an unfinished Sage change: Sage's
  // older value must not overwrite it. Every other field syncs as usual. The
  // write is guarded on no new change appearing meanwhile (a staff edit made
  // while this read was applied); when one did, it is planned once more.
  let result: CanonicalUpdateResult = { success: false, error: "The canonical directory link changed before Sage read-back." }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const holds = await sageHolds(getDb(database), organizationId, snapshot.kind, snapshot.entityId,
      { exceptProposalId: options.releaseProposalId })
    const guard = noNewSageHoldGuard({
      organizationId, kind: snapshot.kind, entityId: snapshot.entityId,
      seen: options.releaseProposalId ? [...holds.proposalIds, options.releaseProposalId] : holds.proposalIds,
    })
    const held = holds.fields
    result = held.size > 0
      ? await applySnapshotFields(database, organizationId, identity, {
          ...snapshot, fields: withoutHeldFields(snapshot.fields, held),
        }, writtenFields.filter((field) => !held.has(field)), guard)
      : await applySnapshotFields(database, organizationId, identity, snapshot, writtenFields, guard)
    if (result.success) return result
  }
  return result
}

async function applySnapshotFields(
  database: D1Database,
  organizationId: string,
  identity: SageContactEntityIdentity,
  snapshot: Snapshot,
  writtenFields: readonly string[],
  guard: ReturnType<typeof noNewSageHoldGuard>
): Promise<CanonicalUpdateResult> {
  // The snapshot names the same Sage record (ids compare case-insensitively), but the
  // guards below match the directory row exactly, so bind the id spelling it stores.
  const sageRecordId = identity.sageRecordId
  if (!sageRecordId) return { success: false, error: "Review and link the stable Sage record ID before synchronizing this contact." }
  const parentSageRecordId = identity.parentSageRecordId
  const now = new Date().toISOString()
  let statement: D1PreparedStatement
  if (snapshot.kind === "client_company") {
    const patch = merged(patchFor(snapshot.fields, CLIENT_COMPANY), writtenCompanyPatch(snapshot.fields, writtenFields))
    statement = sageSnapshotDirectoryUpdateStatement(database, snapshot.kind, updateAssignments("sage_client_id", patch),
      [sageRecordId, ...patch.values, now, snapshot.entityId, organizationId, sageRecordId], guard)
  } else if (snapshot.kind === "vendor_company") {
    const patch = merged(patchFor(snapshot.fields, VENDOR_COMPANY), writtenCompanyPatch(snapshot.fields, writtenFields))
    statement = sageSnapshotDirectoryUpdateStatement(database, snapshot.kind, updateAssignments("sage_vendor_id", patch),
      [sageRecordId, ...patch.values, now, now, snapshot.entityId, organizationId, sageRecordId], guard)
  } else if (snapshot.kind === "client_person") {
    const patch = patchFor(snapshot.fields, PERSON)
    statement = sageSnapshotDirectoryUpdateStatement(database, snapshot.kind, updateAssignments("sage_contact_id", patch),
      [sageRecordId, ...patch.values, now, now, snapshot.entityId, sageRecordId,
        organizationId, parentSageRecordId], guard)
  } else if (snapshot.kind === "vendor_person") {
    const patch = patchFor(snapshot.fields, PERSON)
    statement = sageSnapshotDirectoryUpdateStatement(database, snapshot.kind, updateAssignments("sage_contact_id", patch),
      [sageRecordId, ...patch.values, now, snapshot.entityId, sageRecordId,
        organizationId, parentSageRecordId], guard)
  } else {
    const patch = patchFor(snapshot.fields, EMPLOYEE)
    statement = sageSnapshotDirectoryUpdateStatement(database, snapshot.kind, updateAssignments("sage_employee_id", patch),
      [sageRecordId, ...patch.values, now, now, snapshot.entityId, organizationId, sageRecordId], guard)
  }
  const result = await statement.run()
  if (result.meta.changes !== 1) {
    return { success: false, error: "The canonical directory link changed before Sage read-back." }
  }
  if (snapshot.kind === "employee") {
    const privatePatch = patchFor(snapshot.fields, EMPLOYEE_PRIVATE)
    if (privatePatch.clauses.length > 0) {
      const columns = privatePatch.clauses.map((clause) => clause.slice(1, clause.indexOf("`", 1)))
      await upsertInternalContactPrivateAddressStatement(database, {
        internalContactId: snapshot.entityId, columns, values: privatePatch.values, now,
      }).run()
    }
  }
  return { success: true }
}
