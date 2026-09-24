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
  | "email"
  | "phone"
  | "phoneExtension"
  | "cellPhone"

export type SageContactFields = Readonly<Partial<Record<SageContactField, string | null>>>

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

type PlanResult =
  | { readonly success: true; readonly plan: SageContactProposalPlan }
  | { readonly success: false; readonly error: string }

// Primary-email writes need a verified UI/API binding: the existing client
// read path uses child contact line 1, while the vendor mapping remains open.
// Both are deliberately absent from this allowlist.
const FIELDS_BY_KIND: Readonly<Record<SageContactKind, readonly SageContactField[]>> = {
  client_company: [
    "addressLine1", "addressLine2", "city", "state", "postalCode",
    "billingAddressLine1", "billingAddressLine2", "billingCity",
    "billingState", "billingPostalCode",
  ],
  client_person: ["name", "title", "phone", "phoneExtension", "email", "cellPhone"],
  vendor_company: ["ownerName", "addressLine1", "addressLine2", "city", "state", "postalCode"],
  vendor_person: ["name", "title", "phone", "phoneExtension", "email", "cellPhone"],
  employee: ["addressLine1", "addressLine2", "city", "state", "postalCode", "phone", "cellPhone", "email"],
}

// Maximum lengths come from the installed Sage 100 Contractor mbxml.xsd.
const FIELD_MAX_LENGTH: Readonly<Partial<Record<SageContactField, number>>> = {
  name: 50, title: 50, ownerName: 50,
  addressLine1: 50, addressLine2: 50, city: 50, state: 2,
  billingAddressLine1: 50, billingAddressLine2: 50,
  billingCity: 50, billingState: 2,
  email: 75, phoneExtension: 6,
}

export function sageContactProposalFields(kind: SageContactKind): readonly SageContactField[] {
  return FIELDS_BY_KIND[kind]
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

/** Fail closed on unknown fields, missing source values, and missing Sage IDs. */
export function planSageContactChange(input: {
  readonly snapshot: SageContactSnapshot
  readonly proposed: Readonly<Record<string, string | null>>
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
    if (!Object.prototype.hasOwnProperty.call(snapshot.fields, key)) {
      return { success: false, error: `No Sage read value is available for ${key}.` }
    }
    if (submitted !== null && typeof submitted !== "string") {
      return { success: false, error: `Invalid value for ${key}.` }
    }
    const after = normalized(submitted)
    if (after !== null && after.length > (FIELD_MAX_LENGTH[key] ?? 255)) {
      return { success: false, error: `${key} exceeds the Sage field limit.` }
    }
    if (key === "name" && after === null) {
      return { success: false, error: "A Sage contact name cannot be cleared." }
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
    plan.sageRecordId === latest.sageRecordId &&
    plan.parentSageRecordId === normalized(latest.parentSageRecordId) &&
    plan.baseRevision === latest.revision
}
