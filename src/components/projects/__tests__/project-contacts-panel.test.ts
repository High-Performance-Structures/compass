import { describe, expect, it } from "vitest"

import type { ProjectContactItem } from "@/app/actions/project-contacts"
import { buildProjectContactDisplayGroups } from "@/lib/project-contact-display"

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
