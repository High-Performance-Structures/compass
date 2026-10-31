/**
 * Pure contacts rules: contact types, list grouping, picker options and the
 * matching keys used to link project contacts to directory records. No
 * database or network access, so client components may reuse it.
 */
import type { projectContacts, projectContactSourceLinks } from "@/db/schema"
import { vendorCategoryToContactType } from "@/lib/contact-project-association"
import type {
  ProjectContactAccessStatus,
  ProjectContactCompassAccountStatus,
} from "@/lib/project-contact-access-status"
import { isCanonicalDirectoryAssignment } from "@/lib/project-contact-directory-identity"
import { projectContactAddress } from "@/lib/project-contact-privacy"

import type {
  ProjectContactCsiGroup,
  ProjectContactGroup,
  ProjectContactItem,
  ProjectContactSourceLinkItem,
  ProjectContactType,
  ProjectTaskAssigneeOption,
} from "./types"

type ProjectContactRow = typeof projectContacts.$inferSelect
type SourceLinkRow = typeof projectContactSourceLinks.$inferSelect

const CONTACT_TYPES: readonly ProjectContactType[] = [
  "owner",
  "supplier",
  "subcontractor",
  "internal",
]

function contactTypeLabel(type: ProjectContactType): string {
  switch (type) {
    case "owner":
      return "Owners"
    case "supplier":
      return "Suppliers"
    case "subcontractor":
      return "Subcontractors"
    case "internal":
      return "Internal"
  }
}

/** Stored rows default anything unknown to internal. */
function toContactType(value: string): ProjectContactType {
  if (value === "owner") return "owner"
  if (value === "supplier") return "supplier"
  if (value === "subcontractor") return "subcontractor"
  return "internal"
}

/** Review-queue input defaults anything unknown to subcontractor. */
export function toWritableContactType(value: string): ProjectContactType {
  if (value === "owner") return "owner"
  if (value === "supplier") return "supplier"
  if (value === "internal") return "internal"
  return "subcontractor"
}

export function validContactType(value: string): value is ProjectContactType {
  return CONTACT_TYPES.some((contactType) => contactType === value)
}

/** The role label the review queue writes for a contact type. */
export function reviewRoleForContactType(contactType: ProjectContactType): string {
  switch (contactType) {
    case "owner":
      return "Owner"
    case "internal":
      return "Internal"
    case "supplier":
      return "Supplier"
    case "subcontractor":
      return "Subcontractor"
  }
}

export function isExternalContactType(contactType: ProjectContactType): boolean {
  return contactType === "supplier" || contactType === "subcontractor"
}

/** A source row named "TBD" waits for a real company instead of matching Sage. */
export function restoredSourceLinkStatus(sourceName: string): "pending_assignment" | "unmatched" {
  return /\b(tbd|to\s+be\s+determined)\b/i.test(sourceName) ? "pending_assignment" : "unmatched"
}

export function toContactItem(
  row: ProjectContactRow,
  accessStatus: ProjectContactAccessStatus = "not_invited",
  directoryIdentityManaged = false,
  compassAccountStatus: ProjectContactCompassAccountStatus = "not_registered",
  welcomeEmail: ProjectContactItem["welcomeEmail"] = null
): ProjectContactItem {
  return {
    id: row.id,
    contactType: toContactType(row.contactType),
    sourceSystem: row.sourceSystem,
    sourceRecordId: row.sourceRecordId,
    sourceEntityType: row.sourceEntityType,
    sourceEntityId: row.sourceEntityId,
    customerId: row.customerId,
    customerContactId: row.customerContactId,
    vendorId: row.vendorId,
    vendorContactId: row.vendorContactId,
    internalContactId: row.internalContactId,
    displayName: row.displayName,
    companyName: row.companyName,
    role: row.role,
    trade: row.trade,
    csiDivision: row.csiDivision,
    csiDivisionName: row.csiDivisionName,
    primaryCostCode: row.primaryCostCode,
    email: row.email,
    phone: row.phone,
    // Employee home addresses never belong in a project-contact response.
    address: projectContactAddress(row.contactType, row.address),
    notes: row.notes,
    ownerPortalVisible: row.ownerPortalVisible,
    subVendorPortalVisible: row.subVendorPortalVisible,
    internalVisible: row.internalVisible,
    primaryContact: row.primaryContact,
    active: row.active,
    syncStatus: row.syncStatus,
    lastSyncedAt: row.lastSyncedAt,
    accessStatus,
    welcomeEmail,
    compassAccountStatus,
    identityManagedByActiveUser:
      accessStatus === "active" ||
      directoryIdentityManaged ||
      isCanonicalDirectoryAssignment(row),
  }
}

export function buildCsiGroups(
  contacts: readonly ProjectContactItem[]
): readonly ProjectContactCsiGroup[] {
  const groups = new Map<string, ProjectContactItem[]>()

  for (const contact of contacts) {
    if (!contact.csiDivision || !contact.csiDivisionName) continue

    const key = `${contact.csiDivision}|${contact.csiDivisionName}`
    const existing = groups.get(key) ?? []
    existing.push(contact)
    groups.set(key, existing)
  }

  return Array.from(groups.entries()).map(([key, items]) => {
    const [csiDivision, csiDivisionName] = key.split("|")
    return {
      csiDivision,
      csiDivisionName,
      count: items.length,
      contacts: items,
    }
  })
}

export function buildGroups(
  contacts: readonly ProjectContactItem[]
): readonly ProjectContactGroup[] {
  return CONTACT_TYPES.map((contactType) => {
    const items = contacts.filter((contact) => contact.contactType === contactType)
    return {
      contactType,
      label: contactTypeLabel(contactType),
      count: items.length,
      contacts: items,
    }
  })
}

export function toSourceLinkItem(
  row: SourceLinkRow,
  contact: ProjectContactItem | undefined
): ProjectContactSourceLinkItem {
  return {
    id: row.id,
    projectId: row.projectId,
    projectContactId: row.projectContactId,
    sourceSystem: row.sourceSystem,
    sourceRecordType: row.sourceRecordType,
    sourceRecordId: row.sourceRecordId,
    sourceRecordNumber: row.sourceRecordNumber,
    sourceLabel: row.sourceLabel,
    sourceName: row.sourceName,
    matchStatus: row.matchStatus,
    matchConfidence: row.matchConfidence,
    matchReason: row.matchReason,
    contactDisplayName: contact?.displayName ?? null,
    contactType: contact?.contactType ?? null,
    csiDivision: contact?.csiDivision ?? null,
    csiDivisionName: contact?.csiDivisionName ?? null,
  }
}

/** A readable, stable id fragment for generated project-contact ids. */
export function sourceIdPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 70)
}

/** Lowercase letters and digits only, for comparing names across records. */
export function normalizeDirectoryKey(value: string | null): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/** Lowercased, trimmed email; empty when missing. */
export function normalizeEmailKey(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? ""
}

export function projectContactToTaskAssigneeOption(
  contact: ProjectContactItem
): ProjectTaskAssigneeOption {
  const companySuffix =
    contact.companyName && contact.companyName !== contact.displayName
      ? ` - ${contact.companyName}`
      : ""

  return {
    id: `project:${contact.id}`,
    label: `${contact.displayName}${companySuffix}`,
    name: contact.displayName,
    companyName: contact.companyName,
    email: contact.email,
    phone: contact.phone,
    contactType: contact.contactType,
    source: "project",
    projectContactId: contact.id,
    directoryContactId: null,
    projectAccess: true,
  }
}

export function directoryContactToTaskAssigneeOption(input: {
  readonly id: string
  readonly name: string
  readonly category: string
  readonly email: string | null
  readonly phone: string | null
}): ProjectTaskAssigneeOption {
  const contactType = vendorCategoryToContactType(input.category)

  return {
    id: `directory:${input.id}`,
    label: `${input.name} - Directory`,
    name: input.name,
    companyName: input.name,
    email: input.email,
    phone: input.phone,
    contactType,
    source: "directory",
    projectContactId: null,
    directoryContactId: input.id,
    projectAccess: false,
  }
}

export function customerToTaskAssigneeOption(input: {
  readonly id: string
  readonly name: string
  readonly company: string | null
  readonly email: string | null
  readonly phone: string | null
}): ProjectTaskAssigneeOption {
  const companySuffix =
    input.company && input.company !== input.name ? ` - ${input.company}` : ""

  return {
    id: `directory:customer:${input.id}`,
    label: `${input.name}${companySuffix}`,
    name: input.name,
    companyName: input.company,
    email: input.email,
    phone: input.phone,
    contactType: "owner",
    source: "directory",
    projectContactId: null,
    directoryContactId: null,
    projectAccess: false,
  }
}

export function vendorPersonToTaskAssigneeOption(input: {
  readonly id: string
  readonly vendorName: string
  readonly category: string
  readonly name: string
  readonly email: string | null
  readonly phone: string | null
}): ProjectTaskAssigneeOption {
  return {
    id: `directory:vendor-contact:${input.id}`,
    label: `${input.name} - ${input.vendorName}`,
    name: input.name,
    companyName: input.vendorName,
    email: input.email,
    phone: input.phone,
    contactType: vendorCategoryToContactType(input.category),
    source: "directory",
    projectContactId: null,
    directoryContactId: null,
    projectAccess: false,
  }
}

export function organizationUserToTaskAssigneeOption(input: {
  readonly id: string
  readonly email: string
  readonly displayName: string | null
  readonly firstName: string | null
  readonly lastName: string | null
}): ProjectTaskAssigneeOption {
  const fullName = [input.firstName, input.lastName]
    .filter((part): part is string => part !== null && part.trim().length > 0)
    .join(" ")
  const name = input.displayName?.trim() || fullName || input.email

  return {
    id: `team:${input.id}`,
    label: name,
    name,
    companyName: null,
    email: input.email,
    phone: null,
    contactType: "internal",
    source: "project",
    projectContactId: null,
    directoryContactId: null,
    projectAccess: true,
  }
}

/** Directory primary people first, then by name. */
export function byPrimaryThenName(
  left: { readonly isPrimary: boolean; readonly name: string },
  right: { readonly isPrimary: boolean; readonly name: string }
): number {
  return Number(right.isPrimary) - Number(left.isPrimary) || left.name.localeCompare(right.name)
}
