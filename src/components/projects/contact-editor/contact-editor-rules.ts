/*
 * Pure rules for the project contact editor: the starting input, role
 * presets, directory grouping and how picking a directory record, person,
 * division or cost code changes the draft.
 */

import type {
  ProjectContactCostCodeOption,
  ProjectContactDirectoryOption,
  ProjectContactItem,
  ProjectContactMutationInput,
  ProjectContactSageOptions,
  ProjectContactType,
} from "@/lib/domain/contacts/types"
import { PROJECT_WORKFLOW_ROLE_LENSES } from "@/lib/project-workflow-roles"

export const CUSTOM_PROJECT_ROLE_VALUE = "custom-project-role"
export const EXTERNAL_PROJECT_ROLES = [
  "Owner / Client",
  "Subcontractor",
  "Supplier",
] as const
const PROJECT_ROLE_LABELS = [
  ...PROJECT_WORKFLOW_ROLE_LENSES.map((role) => role.label),
  ...EXTERNAL_PROJECT_ROLES,
] as const

export function isPresetProjectRole(value: string): boolean {
  return PROJECT_ROLE_LABELS.some((role) => role === value)
}

export function defaultProjectRole(type: ProjectContactType): string {
  switch (type) {
    case "owner":
      return "Owner / Client"
    case "supplier":
      return "Supplier"
    case "subcontractor":
      return "Subcontractor"
    case "internal":
      return ""
  }
}

export function isProjectContactType(value: string): value is ProjectContactType {
  return (
    value === "owner" ||
    value === "supplier" ||
    value === "subcontractor" ||
    value === "internal"
  )
}

export function directorySourceLabel(
  sourceType: ProjectContactDirectoryOption["sourceType"]
): string {
  switch (sourceType) {
    case "customer":
      return "Customers"
    case "vendor":
      return "Vendors and subcontractors"
    case "team":
      return "Internal team"
  }
}

export function initialInput(
  projectId: string,
  contact: ProjectContactItem | null
): ProjectContactMutationInput {
  const directorySourceType = contact?.vendorId
    ? "vendor"
    : contact?.customerId ||
        contact?.sourceEntityType === "customer" ||
        contact?.sourceEntityType === "customer_contact"
      ? "customer"
      : contact?.internalContactId ||
          contact?.sourceEntityType === "internal_contact" ||
          contact?.sourceEntityType === "user"
        ? "team"
        : null
  const directorySourceId =
    contact?.vendorId ??
    contact?.customerId ??
    contact?.internalContactId ??
    (directorySourceType && contact?.sourceEntityId
      ? contact.sourceEntityId
      : null)

  return {
    projectId,
    contactId: contact?.id ?? null,
    directorySourceType,
    directorySourceId,
    vendorId: contact?.vendorId ?? null,
    vendorContactId: contact?.vendorContactId ?? null,
    customerContactId: contact?.customerContactId ?? null,
    contactType: contact?.contactType ?? "owner",
    displayName: contact?.displayName ?? "",
    companyName: contact?.companyName ?? "",
    role: contact?.role ?? "",
    trade: contact?.trade ?? "",
    csiDivision: contact?.csiDivision ?? "",
    csiDivisionName: contact?.csiDivisionName ?? "",
    primaryCostCode: contact?.primaryCostCode ?? "",
    email: contact?.email ?? "",
    phone: contact?.phone ?? "",
    address: contact?.address ?? "",
    notes: contact?.notes ?? "",
    ownerPortalVisible: contact?.ownerPortalVisible ?? false,
    subVendorPortalVisible: contact?.subVendorPortalVisible ?? false,
    internalVisible: contact?.internalVisible ?? true,
    primaryContact: contact?.primaryContact ?? false,
  }
}

export function isVendorContactType(type: ProjectContactType): boolean {
  return type === "supplier" || type === "subcontractor"
}

export function groupedDirectoryOptions(
  options: readonly ProjectContactDirectoryOption[]
): readonly {
  readonly sourceType: ProjectContactDirectoryOption["sourceType"]
  readonly options: readonly ProjectContactDirectoryOption[]
}[] {
  return (["customer", "vendor", "team"] satisfies readonly ProjectContactDirectoryOption["sourceType"][])
    .map((sourceType) => ({
      sourceType,
      options: options.filter((option) => option.sourceType === sourceType),
    }))
    .filter((group) => group.options.length > 0)
}

/** The draft linked to a directory record, with its type's default role. */
export function inputWithDirectoryOption(
  current: ProjectContactMutationInput,
  option: ProjectContactDirectoryOption
): ProjectContactMutationInput {
  const contactType =
    option.sourceType === "vendor" &&
    isVendorContactType(current.contactType)
      ? current.contactType
      : option.suggestedContactType
  return {
    ...current,
    directorySourceType: option.sourceType,
    directorySourceId: option.id,
    vendorId: option.sourceType === "vendor" ? option.id : null,
    vendorContactId: null,
    customerContactId: null,
    contactType,
    displayName: option.displayName,
    companyName: option.companyName ?? "",
    email: option.email ?? "",
    phone: option.phone ?? "",
    address: option.address ?? "",
    role: defaultProjectRole(contactType),
    ownerPortalVisible:
      contactType === "internal" || current.ownerPortalVisible,
    subVendorPortalVisible:
      isVendorContactType(contactType) || current.subVendorPortalVisible,
  }
}

/**
 * The draft with a vendor person picked ("company-only" for none). Returns
 * null when the person isn't on the vendor.
 */
export function inputWithVendorContact(
  current: ProjectContactMutationInput,
  vendor: ProjectContactDirectoryOption,
  contactId: string
): ProjectContactMutationInput | null {
  if (contactId === "company-only") {
    return {
      ...current,
      vendorContactId: null,
      displayName: vendor.displayName,
      companyName: vendor.displayName,
      email: vendor.email ?? "",
      phone: vendor.phone ?? "",
      address: vendor.address ?? "",
    }
  }
  const vendorContact = vendor.vendorContacts.find(
    (option) => option.id === contactId
  )
  if (!vendorContact) return null
  return {
    ...current,
    vendorContactId: vendorContact.id,
    displayName: vendorContact.name,
    companyName: vendor.displayName,
    email: vendorContact.email ?? "",
    phone: vendorContact.phone ?? "",
    address: vendor.address ?? "",
  }
}

/**
 * The draft with a client person picked ("company-only" for none). Returns
 * null when the person isn't on the client.
 */
export function inputWithCustomerContact(
  current: ProjectContactMutationInput,
  customer: ProjectContactDirectoryOption,
  contactId: string
): ProjectContactMutationInput | null {
  if (contactId === "company-only") {
    return {
      ...current,
      customerContactId: null,
      displayName: customer.displayName,
      email: customer.email ?? "",
      phone: customer.phone ?? "",
      address: customer.address ?? "",
    }
  }
  const person = customer.customerContacts.find(
    (option) => option.id === contactId
  )
  if (!person) return null
  return {
    ...current,
    customerContactId: person.id,
    displayName: person.name,
    email: person.email ?? "",
    phone: person.phone ?? "",
    address: customer.address ?? "",
  }
}

/**
 * The draft moved to a division ("unassigned" clears it). The cost code is
 * kept only when it belongs to the division. Null for an unknown division.
 */
export function inputWithDivision(
  current: ProjectContactMutationInput,
  divisionCode: string,
  sageOptions: ProjectContactSageOptions
): ProjectContactMutationInput | null {
  if (divisionCode === "unassigned") {
    return {
      ...current,
      csiDivision: "",
      csiDivisionName: "",
      primaryCostCode: "",
    }
  }
  const division = sageOptions.divisions.find(
    (option) => option.value === divisionCode
  )
  if (!division) return null
  const selectedCostCode = sageOptions.costCodes.find(
    (option) => option.value === current.primaryCostCode
  )
  return {
    ...current,
    csiDivision: division.value,
    csiDivisionName: division.name,
    primaryCostCode:
      selectedCostCode?.divisionCode === division.value
        ? current.primaryCostCode
        : "",
  }
}

/** The draft with a cost code (and its division), or with none. */
export function inputWithCostCode(
  current: ProjectContactMutationInput,
  option: ProjectContactCostCodeOption | null
): ProjectContactMutationInput {
  return option
    ? {
        ...current,
        primaryCostCode: option.value,
        csiDivision: option.divisionCode,
        csiDivisionName: option.divisionName,
      }
    : { ...current, primaryCostCode: "" }
}

/**
 * The draft with a new contact type and its default role. The directory
 * link survives only a supplier/subcontractor switch.
 */
export function inputWithContactType(
  current: ProjectContactMutationInput,
  contactType: ProjectContactType,
  keepVendor: boolean
): ProjectContactMutationInput {
  return {
    ...current,
    contactType,
    role: defaultProjectRole(contactType),
    ...(keepVendor
      ? {}
      : {
          directorySourceType: null,
          directorySourceId: null,
          vendorId: null,
          vendorContactId: null,
          customerContactId: null,
        }),
  }
}

/** Client directory records that match a new contact by email or name + company. */
export function matchingCustomerOptions(
  customerOptions: readonly ProjectContactDirectoryOption[],
  draft: { readonly name: string; readonly email: string; readonly company: string }
): ProjectContactDirectoryOption[] {
  const name = draft.name.trim()
  const email = draft.email.trim().toLowerCase()
  const company = draft.company.trim().toLowerCase()
  return customerOptions.filter((option) => {
    const sameEmail =
      email.length > 0 && option.email?.trim().toLowerCase() === email
    const sameNameAndCompany =
      option.displayName.trim().toLowerCase() === name.toLowerCase() &&
      (option.companyName?.trim().toLowerCase() ?? "") === company
    return sameEmail || sameNameAndCompany
  })
}
