import { describe, expect, it } from "vitest"

import type {
  ProjectContactDirectoryOption,
  ProjectContactItem,
} from "@/app/actions/project-contacts"
import {
  buildProjectContactDisplayGroups,
  canViewHistoricalProjectContacts,
  projectContactCanEdit,
} from "@/lib/project-contact-display"

function contact(
  id: string,
  contactType: ProjectContactItem["contactType"],
  active = true
): ProjectContactItem {
  return {
    id,
    contactType,
    sourceSystem: "buildertrend",
    sourceRecordId: null,
    sourceEntityType: "user",
    sourceEntityId: id,
    vendorId: null,
    vendorContactId: null,
    displayName: id,
    companyName: null,
    role: null,
    trade: null,
    csiDivision: null,
    csiDivisionName: null,
    primaryCostCode: null,
    email: null,
    phone: null,
    address: null,
    notes: null,
    ownerPortalVisible: true,
    subVendorPortalVisible: true,
    internalVisible: true,
    primaryContact: false,
    active,
    syncStatus: "synced",
    lastSyncedAt: null,
    accessStatus: "not_invited",
    identityManagedByActiveUser: false,
  }
}

describe("buildProjectContactDisplayGroups", () => {
  it("labels the active contact buckets Owners, Vendors, and Internal", () => {
    const groups = buildProjectContactDisplayGroups([
      contact("owner", "owner"),
      contact("supplier", "supplier"),
      contact("subcontractor", "subcontractor"),
      contact("internal", "internal"),
    ])

    expect(groups.map((group) => group.label)).toEqual([
      "Owners",
      "Vendors",
      "Internal",
    ])
    expect(groups.map((group) => group.contacts.length)).toEqual([1, 2, 1])
  })
})

describe("projectContactCanEdit", () => {
  it("keeps historical contacts read-only even when directory options exist", () => {
    const directoryOptions: readonly ProjectContactDirectoryOption[] = []

    expect(projectContactCanEdit(contact("former", "internal", false), directoryOptions)).toBe(
      false
    )
    expect(projectContactCanEdit(contact("active", "internal"), directoryOptions)).toBe(true)
    expect(projectContactCanEdit(contact("active", "internal"), undefined)).toBe(false)
  })
})

describe("canViewHistoricalProjectContacts", () => {
  it("limits historical contacts to internal staff roles", () => {
    expect(canViewHistoricalProjectContacts("project_manager")).toBe(true)
    expect(canViewHistoricalProjectContacts("client")).toBe(false)
    expect(canViewHistoricalProjectContacts(null)).toBe(false)
  })
})
