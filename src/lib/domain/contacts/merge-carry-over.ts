/**
 * What a duplicate merge carries from the archived record to the kept one.
 *
 * A merge used to leave the survivor's own contact fields untouched, so a
 * duplicate that held the only email or phone lost it. Now every contact
 * field group (email, phone, address, ...) is compared:
 * - "fill": the kept record is blank there and the archived one is not; the
 *   archived value is copied over.
 * - "choose": both have different values; staff pick one in the merge
 *   dialog (default: the kept record's).
 * - "locked": the kept record's sign-in email belongs to a person who
 *   accepted a Compass invite; it never changes in a merge.
 *
 * Address parts move as one group, so a merge never mixes a street from one
 * record with a city from the other. Pure: no I/O. The merge action
 * (src/app/actions/contact-duplicates.ts) applies the result: Compass-only
 * fields in the merge batch, Sage-shared fields of a Sage-linked survivor
 * through the reviewed Sage change request, like a staff edit.
 */
import { SAGE_SHARED_FIELDS, type SageLinkedEditKind } from "@/lib/sage/sage-linked-edit-fields"

export type MergeKind = "customer_company" | "vendor_company" | "customer_person" | "vendor_person"

/** A field: its record key (camelCase) and its column. */
type Field = readonly [key: string, column: string]
type FieldGroup = { readonly key: string; readonly label: string; readonly fields: readonly Field[] }

const ADDRESS: readonly Field[] = [
  ["addressLine1", "address_line_1"], ["addressLine2", "address_line_2"],
  ["city", "city"], ["state", "state"], ["postalCode", "postal_code"],
]
const BILLING: readonly Field[] = [
  ["billingAddressLine1", "billing_address_line_1"], ["billingAddressLine2", "billing_address_line_2"],
  ["billingCity", "billing_city"], ["billingState", "billing_state"], ["billingPostalCode", "billing_postal_code"],
]
const PERSON_GROUPS: readonly FieldGroup[] = [
  { key: "title", label: "Job title", fields: [["title", "title"]] },
  { key: "email", label: "Email", fields: [["email", "email"]] },
  { key: "phone", label: "Phone", fields: [["phone", "phone"], ["phoneExtension", "phone_extension"]] },
  { key: "cellPhone", label: "Cell phone", fields: [["cellPhone", "cell_phone"]] },
]

/**
 * Every contact field of each record type (from src/db/schema-contacts.ts).
 * Names, identities (Sage, NetSuite, Buildertrend, import ids), status and
 * settings are not contact details and are never carried.
 */
const MERGE_FIELD_GROUPS: Readonly<Record<MergeKind, readonly FieldGroup[]>> = {
  customer_company: [
    { key: "company", label: "Company", fields: [["company", "company"]] },
    { key: "email", label: "Email", fields: [["email", "email"]] },
    { key: "primaryEmail", label: "Primary email", fields: [["primaryEmail", "primary_email"]] },
    { key: "phone", label: "Phone", fields: [["phone", "phone"]] },
    { key: "address", label: "Address", fields: ADDRESS },
    { key: "addressText", label: "Address shown on jobs", fields: [["address", "address"]] },
    { key: "billing", label: "Billing address", fields: BILLING },
    { key: "notes", label: "Notes", fields: [["notes", "notes"]] },
  ],
  vendor_company: [
    { key: "ownerName", label: "Owner", fields: [["ownerName", "owner_name"]] },
    { key: "email", label: "Email", fields: [["email", "email"]] },
    { key: "primaryEmail", label: "Primary email", fields: [["primaryEmail", "primary_email"]] },
    { key: "phone", label: "Phone", fields: [["phone", "phone"]] },
    { key: "address", label: "Address", fields: ADDRESS },
    { key: "addressText", label: "Address shown on jobs", fields: [["address", "address"]] },
  ],
  customer_person: PERSON_GROUPS,
  vendor_person: PERSON_GROUPS,
}

/** The columns a merge may write on each table (the store checks against this). */
export function mergeCarryOverColumns(kind: MergeKind): readonly string[] {
  return MERGE_FIELD_GROUPS[kind].flatMap((group) => group.fields.map(([, column]) => column))
}

export const MERGE_TABLE = {
  customer_company: "customers", vendor_company: "vendors", customer_person: "customer_contacts", vendor_person: "vendor_contacts",
} as const satisfies Record<MergeKind, string>

type SqlGuard = { readonly sql: string; readonly binds: readonly unknown[] }

/** The kept record's new contact fields, by column, for the store's guarded UPDATE. */
export type CarryOverWrite = {
  readonly kind: MergeKind
  readonly destinationId: string
  readonly now: string
  readonly values: Readonly<Record<string, string | null>>
  /** True only while the record being archived is still live, so the copy lands only with the merge. */
  readonly guard: SqlGuard
}

/** A person merge's source is still live (active and not merged). */
export function personMergeGuard(kind: "customer_person" | "vendor_person", sourceId: string): SqlGuard {
  return {
    sql: `EXISTS (SELECT 1 FROM ${MERGE_TABLE[kind]} merge_source WHERE merge_source.id = ? AND merge_source.active = 1 AND merge_source.merged_into_person_id IS NULL)`,
    binds: [sourceId],
  }
}

export const SAGE_EDIT_KIND:Readonly<Record<MergeKind, SageLinkedEditKind>> = {
  customer_company: "client_company", vendor_company: "vendor_company",
  customer_person: "client_person", vendor_person: "vendor_person",
}

export type MergeFieldChoice = "kept" | "merged"

export type MergeFieldChange = {
  readonly key: string
  readonly label: string
  /** The kept record's value, as shown (null when blank). */
  readonly keptValue: string | null
  /** The archived record's value, as shown. */
  readonly mergedValue: string | null
  readonly action: "fill" | "choose" | "locked"
}

export type CarryOverPlan = {
  /** Every group that differs, for the preview. */
  readonly changes: readonly MergeFieldChange[]
  /** New values by record key (camelCase) for the kept record, after the choices. */
  readonly values: Readonly<Record<string, string | null>>
}

function clean(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : ""
  return text.length > 0 ? text : null
}

function shown(group: FieldGroup, record: Readonly<Record<string, unknown>>): string | null {
  const parts = group.fields.map(([key]) => clean(record[key]))
  if (parts.every((part) => part === null)) return null
  if (group.key === "phone") return `${parts[0] ?? ""}${parts[1] ? ` ext. ${parts[1]}` : ""}`.trim()
  return parts.filter((part) => part !== null).join(", ")
}

function same(group: FieldGroup, a: Readonly<Record<string, unknown>>, b: Readonly<Record<string, unknown>>): boolean {
  return group.fields.every(([key]) => (clean(a[key])?.toLowerCase() ?? null) === (clean(b[key])?.toLowerCase() ?? null))
}

/**
 * Compares the archived record (`merged`) with the kept one. `choices` are
 * staff's picks for "choose" groups; anything not picked keeps the kept
 * record's value. `lockedKeys` are groups that must not change (sign-in email).
 */
export function planCarryOver(input: {
  readonly kind: MergeKind
  readonly kept: Readonly<Record<string, unknown>>
  readonly merged: Readonly<Record<string, unknown>>
  readonly choices?: Readonly<Record<string, MergeFieldChoice>>
  readonly lockedKeys?: readonly string[]
}): CarryOverPlan {
  const changes: MergeFieldChange[] = []
  const values: Record<string, string | null> = {}
  for (const group of MERGE_FIELD_GROUPS[input.kind]) {
    const mergedValue = shown(group, input.merged)
    if (mergedValue === null || same(group, input.kept, input.merged)) continue
    const keptValue = shown(group, input.kept)
    const locked = input.lockedKeys?.includes(group.key) ?? false
    const action = locked ? "locked" : keptValue === null ? "fill" : "choose"
    changes.push({ key: group.key, label: group.label, keptValue, mergedValue, action })
    if (action === "fill" || (action === "choose" && input.choices?.[group.key] === "merged")) {
      for (const [key] of group.fields) values[key] = clean(input.merged[key])
    }
  }
  return { changes, values }
}

/** Splits new values into Sage-shared fields (Sage review when linked) and Compass's own. */
export function splitForSage(kind: MergeKind, values: Readonly<Record<string, string | null>>): {
  readonly sage: Readonly<Record<string, string | null>>
  readonly compass: Readonly<Record<string, string | null>>
} {
  const shared: readonly string[] = SAGE_SHARED_FIELDS[SAGE_EDIT_KIND[kind]]
  const sage: Record<string, string | null> = {}
  const compass: Record<string, string | null> = {}
  for (const [key, value] of Object.entries(values)) {
    if (shared.includes(key)) sage[key] = value
    else compass[key] = value
  }
  return { sage, compass }
}

/** Record keys (camelCase) to columns, for the store's UPDATE. */
export function carryOverColumns(kind: MergeKind, values: Readonly<Record<string, string | null>>): Readonly<Record<string, string | null>> {
  const columns: Record<string, string | null> = {}
  for (const group of MERGE_FIELD_GROUPS[kind]) {
    for (const [key, column] of group.fields) {
      if (Object.prototype.hasOwnProperty.call(values, key)) columns[column] = values[key] ?? null
    }
  }
  return columns
}
