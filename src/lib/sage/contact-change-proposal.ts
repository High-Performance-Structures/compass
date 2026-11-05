import { sameSageRecordId } from "@/lib/sage/record-id"

/** Contact changes are proposals against an authoritative Sage read snapshot. */
export type SageContactKind =
  | "client_company"
  | "client_person"
  | "vendor_company"
  | "vendor_person"
  | "employee"

export type SageContactField =
  | "name"
  | "title"
  | "ownerName"
  | "addressLine1"
  | "addressLine2"
  | "city"
  | "state"
  | "postalCode"
  | "billingAddressLine1"
  | "billingAddressLine2"
  | "billingCity"
  | "billingState"
  | "billingPostalCode"
  | "primaryEmail"
  | "email"
  | "phone"
  | "phoneExtension"
  | "cellPhone"

type SageContactFields = Readonly<Partial<Record<SageContactField, string | null>>>

export type SageContactSnapshot = {
  readonly organizationId: string
  readonly kind: SageContactKind
  readonly sageRecordId: string
  readonly parentSageRecordId: string | null
  readonly revision: string
  readonly fields: SageContactFields
}

export type SageContactFieldChange = {
  readonly field: SageContactField
  readonly before: string | null
  readonly after: string | null
}

export type SageContactProposalPlan = {
  readonly organizationId: string
  readonly kind: SageContactKind
  readonly sageRecordId: string
  readonly parentSageRecordId: string | null
  readonly baseRevision: string
  readonly changes: readonly SageContactFieldChange[]
}

export type SageContactCreateFields = Readonly<{
  name: string
  title: string | null
  phone: string | null
  phoneExtension: string | null
  email: string | null
  cellPhone: string | null
}>

type CreatePlanResult =
  | { readonly success: true; readonly fields: SageContactCreateFields }
  | { readonly success: false; readonly error: string }

type PlanResult =
  | { readonly success: true; readonly plan: SageContactProposalPlan }
  | { readonly success: false; readonly error: string }

// Client primary-email writes still need a verified UI/API binding. HPS Test
// established that child contact line 1 Email does not mirror reccln.stmeml.
// Vendor PrimaryEmail <-> actpay.prmeml passed API write/readback/restore.
const FIELDS_BY_KIND: Readonly<Record<SageContactKind, readonly SageContactField[]>> = {
  client_company: [
    "addressLine1", "addressLine2", "city", "state", "postalCode",
    "billingAddressLine1", "billingAddressLine2", "billingCity",
    "billingState", "billingPostalCode",
    "name", "email", "phone",
  ],
  client_person: ["name", "title", "phone", "phoneExtension", "email", "cellPhone"],
  vendor_company: [
    "ownerName", "addressLine1", "addressLine2", "city", "state", "postalCode", "primaryEmail",
    "name", "email", "phone",
  ],
  vendor_person: ["name", "title", "phone", "phoneExtension", "email", "cellPhone"],
  employee: ["addressLine1", "addressLine2", "city", "state", "postalCode", "phone", "cellPhone", "email"],
}

// Maximum lengths come from the installed Sage 100 Contractor mbxml.xsd.
const FIELD_MAX_LENGTH: Readonly<Partial<Record<SageContactField, number>>> = {
  name: 50, title: 50, ownerName: 50,
  addressLine1: 50, addressLine2: 50, city: 50, state: 2,
  billingAddressLine1: 50, billingAddressLine2: 50,
  billingCity: 50, billingState: 2,
  email: 75, primaryEmail: 75, phoneExtension: 6,
}

/**
 * Company name, email and phone (client reccln clnnme/e_mail/phnnum, vendor
 * actpay vndnme/e_mail/phnnum). The Sage writer sends them only once its
 * host has both the column and the installed API element, so an older
 * writer's read-back may leave them out: they are optional in a snapshot,
 * and a proposal for one needs a read that carried it.
 */
const EXTENDED_FIELDS_BY_KIND: Readonly<Record<SageContactKind, readonly SageContactField[]>> = {
  client_company: ["name", "email", "phone"],
  client_person: [],
  vendor_company: ["name", "email", "phone"],
  vendor_person: [],
  employee: [],
}

export function sageContactProposalFields(kind: SageContactKind): readonly SageContactField[] {
  return FIELDS_BY_KIND[kind]
}

/** Fields a Sage read-back must always carry for this kind. */
export function sageContactRequiredSnapshotFields(kind: SageContactKind): readonly SageContactField[] {
  const extended = EXTENDED_FIELDS_BY_KIND[kind]
  return FIELDS_BY_KIND[kind].filter((field) => !extended.includes(field))
}

/** Fields only a Sage writer that knows them sends; see EXTENDED_FIELDS_BY_KIND. */
export function sageContactExtendedFields(kind: SageContactKind): readonly SageContactField[] {
  return EXTENDED_FIELDS_BY_KIND[kind]
}

export function isPrivateEmployeeContactField(field: string): boolean {
  return field === "addressLine1" || field === "addressLine2" ||
    field === "city" || field === "state" || field === "postalCode"
}

function normalized(value: string | null | undefined): string | null {
  const text = value?.trim() ?? ""
  return text.length > 0 ? text : null
}

function isFieldName(value: string): value is SageContactField {
  return Object.values(FIELDS_BY_KIND).some((fields) =>
    fields.some((field) => field === value)
  )
}

/** Validates a new child contact before it enters independent Sage review. */
export function planSageContactCreate(
  kind: "client_person" | "vendor_person",
  submitted: Readonly<Record<string, string | null>>
): CreatePlanResult {
  const allowed = sageContactProposalFields(kind)
  for (const [key, value] of Object.entries(submitted)) {
    if (!isFieldName(key) || !allowed.includes(key)) {
      return { success: false, error: `Sage contact field ${key} is not approved for ${kind}.` }
    }
    if (value !== null && typeof value !== "string") {
      return { success: false, error: `Invalid value for ${key}.` }
    }
    const cleaned = normalized(value)
    if (cleaned !== null && cleaned.length > (FIELD_MAX_LENGTH[key] ?? 255)) {
      return { success: false, error: `${key} exceeds the Sage field limit.` }
    }
  }
  const name = normalized(submitted.name)
  if (!name) return { success: false, error: "A Sage contact name is required." }
  return {
    success: true,
    fields: {
      name,
      title: normalized(submitted.title),
      phone: normalized(submitted.phone),
      phoneExtension: normalized(submitted.phoneExtension),
      email: normalized(submitted.email),
      cellPhone: normalized(submitted.cellPhone),
    },
  }
}

/** Fail closed on unknown fields, missing source values, and missing Sage IDs. */
export function planSageContactChange(input: {
  readonly snapshot: SageContactSnapshot
  readonly proposed: Readonly<Record<string, string | null>>
  /**
   * Inline Compass edits only: an extended field the Sage writer has not read
   * yet is planned with an unknown (null) before-value instead of refused.
   * Every Sage writer refuses a change to a field its own read did not carry
   * ("unsupported field"), so such a request fails visibly and writes nothing
   * until the writer's update is installed and a new read re-plans it.
   */
  readonly allowUnreadExtended?: boolean
}): PlanResult {
  const { snapshot } = input
  if (!snapshot.organizationId.trim() || !snapshot.sageRecordId.trim() || !snapshot.revision.trim()) {
    return { success: false, error: "A scoped Sage identity and source revision are required." }
  }
  if (
    (snapshot.kind === "client_person" || snapshot.kind === "vendor_person") &&
    !snapshot.parentSageRecordId?.trim()
  ) {
    return { success: false, error: "A Sage person must have an exact parent company ID." }
  }
  const allowed = sageContactProposalFields(snapshot.kind)
  const changes: SageContactFieldChange[] = []
  for (const [key, submitted] of Object.entries(input.proposed)) {
    if (!isFieldName(key) || !allowed.includes(key)) {
      return { success: false, error: `Sage contact field ${key} is not approved for ${snapshot.kind}.` }
    }
    const extended = EXTENDED_FIELDS_BY_KIND[snapshot.kind].includes(key)
    if (!Object.prototype.hasOwnProperty.call(snapshot.fields, key) && !(extended && input.allowUnreadExtended)) {
      return {
        success: false,
        error: extended
          ? `Sage does not send ${key} to Compass yet. The Sage writer on the Sage computer needs its update first.`
          : `No Sage read value is available for ${key}.`,
      }
    }
    if (submitted !== null && typeof submitted !== "string") {
      return { success: false, error: `Invalid value for ${key}.` }
    }
    const after = normalized(submitted)
    if (after !== null && after.length > (FIELD_MAX_LENGTH[key] ?? 255)) {
      return { success: false, error: `${key} exceeds the Sage field limit.` }
    }
    if (key === "name" && after === null) {
      return { success: false, error: "A Sage name cannot be cleared." }
    }
    const before = normalized(snapshot.fields[key])
    if (before !== after) changes.push({ field: key, before, after })
  }
  if (changes.length === 0) {
    return { success: false, error: "The proposal contains no changed fields." }
  }
  changes.sort((left, right) => left.field.localeCompare(right.field))
  return {
    success: true,
    plan: {
      organizationId: snapshot.organizationId.trim(),
      kind: snapshot.kind,
      sageRecordId: snapshot.sageRecordId.trim(),
      parentSageRecordId: normalized(snapshot.parentSageRecordId),
      baseRevision: snapshot.revision.trim(),
      changes,
    },
  }
}

export function isSageContactProposalCurrent(
  plan: SageContactProposalPlan,
  latest: SageContactSnapshot
): boolean {
  return plan.organizationId === latest.organizationId &&
    plan.kind === latest.kind &&
    sameSageRecordId(plan.sageRecordId, latest.sageRecordId) &&
    sameSageRecordId(plan.parentSageRecordId, normalized(latest.parentSageRecordId)) &&
    plan.baseRevision === latest.revision
}
