import { describe, expect, it } from "vitest"

import {
  buildCsiGroups,
  buildGroups,
  byPrimaryThenName,
  customerToTaskAssigneeOption,
  directoryContactToTaskAssigneeOption,
  isExternalContactType,
  normalizeDirectoryKey,
  normalizeEmailKey,
  organizationUserToTaskAssigneeOption,
  projectContactToTaskAssigneeOption,
  restoredSourceLinkStatus,
  reviewRoleForContactType,
  sourceIdPart,
  toContactItem,
  toWritableContactType,
  validContactType,
  vendorPersonToTaskAssigneeOption,
} from "../rules"

const NOW = "2026-10-30T00:00:00.000Z"

function row(overrides: Partial<Parameters<typeof toContactItem>[0]> = {}): Parameters<typeof toContactItem>[0] {
  return {
    id: "pc-1",
    projectId: "project-1",
    contactType: "owner",
    sourceSystem: "compass",
    sourceRecordId: null,
    sourceEntityType: "manual",
    sourceEntityId: null,
    vendorId: null,
    vendorContactId: null,
    customerId: null,
    customerContactId: null,
    internalContactId: null,
    displayName: "Pat Owner",
    companyName: "Owner LLC",
    role: null,
    trade: null,
    csiDivision: null,
    csiDivisionName: null,
    primaryCostCode: null,
    email: "pat@example.com",
    phone: null,
    address: "1 Main St",
    notes: null,
    ownerPortalVisible: false,
    subVendorPortalVisible: false,
    internalVisible: true,
    primaryContact: false,
    active: true,
    sortOrder: 0,
    syncStatus: "manual",
    lastSyncedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

describe("contact types", () => {
  it("validates and defaults review input to subcontractor", () => {
    expect(validContactType("owner")).toBe(true)
    expect(validContactType("vendor")).toBe(false)
    expect(toWritableContactType("supplier")).toBe("supplier")
    expect(toWritableContactType("anything")).toBe("subcontractor")
  })

  it("labels review roles and external types", () => {
    expect(reviewRoleForContactType("owner")).toBe("Owner")
    expect(reviewRoleForContactType("internal")).toBe("Internal")
    expect(reviewRoleForContactType("supplier")).toBe("Supplier")
    expect(reviewRoleForContactType("subcontractor")).toBe("Subcontractor")
    expect(isExternalContactType("supplier")).toBe(true)
    expect(isExternalContactType("owner")).toBe(false)
  })

  it("parks TBD source rows for assignment instead of matching", () => {
    expect(restoredSourceLinkStatus("Framing TBD")).toBe("pending_assignment")
    expect(restoredSourceLinkStatus("To be determined")).toBe("pending_assignment")
    expect(restoredSourceLinkStatus("Acme Framing")).toBe("unmatched")
  })
})

describe("toContactItem", () => {
  it("drops internal addresses and defaults unknown types to internal", () => {
    expect(toContactItem(row({ contactType: "internal", address: "Home" })).address).toBeNull()
    // A legacy stored value outside the list still reads as internal.
    expect(toContactItem(Object.assign(row(), { contactType: "staff" })).contactType).toBe("internal")
  })

  it("marks directory-linked contacts as managed by the directory", () => {
    expect(toContactItem(row()).identityManagedByActiveUser).toBe(false)
    expect(toContactItem(row({ vendorId: "vendor-1" })).identityManagedByActiveUser).toBe(true)
    expect(toContactItem(row(), "active").identityManagedByActiveUser).toBe(true)
  })
})

describe("grouping", () => {
  it("groups by type in a fixed order and by CSI division", () => {
    const contacts = [
      toContactItem(row({ id: "a", contactType: "subcontractor", csiDivision: "06", csiDivisionName: "Wood" })),
      toContactItem(row({ id: "b", contactType: "owner" })),
      toContactItem(row({ id: "c", contactType: "subcontractor", csiDivision: "06", csiDivisionName: "Wood" })),
    ]
    expect(buildGroups(contacts).map((group) => [group.label, group.count])).toEqual([
      ["Owners", 1],
      ["Suppliers", 0],
      ["Subcontractors", 2],
      ["Internal", 0],
    ])
    expect(buildCsiGroups(contacts)).toEqual([
      { csiDivision: "06", csiDivisionName: "Wood", count: 2, contacts: [contacts[0], contacts[2]] },
    ])
  })
})

describe("keys", () => {
  it("normalizes ids, names and emails", () => {
    expect(sourceIdPart("  Smith & Sons, LLC ")).toBe("smith-and-sons-llc")
    expect(sourceIdPart("x".repeat(90))).toHaveLength(70)
    expect(normalizeDirectoryKey("  O'Brien  Co. ")).toBe("o brien co")
    expect(normalizeDirectoryKey(null)).toBe("")
    expect(normalizeEmailKey(" Pat@Example.COM ")).toBe("pat@example.com")
    expect(normalizeEmailKey(undefined)).toBe("")
  })

  it("puts primary people first, then sorts by name", () => {
    const people = [
      { isPrimary: false, name: "Bea" },
      { isPrimary: true, name: "Zed" },
      { isPrimary: false, name: "Al" },
    ]
    expect([...people].sort(byPrimaryThenName).map((person) => person.name)).toEqual(["Zed", "Al", "Bea"])
  })
})

describe("assignee options", () => {
  it("labels project contacts with their company when it differs", () => {
    const option = projectContactToTaskAssigneeOption(toContactItem(row()))
    expect(option).toMatchObject({ id: "project:pc-1", label: "Pat Owner - Owner LLC", source: "project", projectAccess: true })
    expect(projectContactToTaskAssigneeOption(toContactItem(row({ companyName: "Pat Owner" }))).label).toBe("Pat Owner")
  })

  it("builds directory, client, vendor-person and staff options", () => {
    expect(directoryContactToTaskAssigneeOption({ id: "v", name: "Acme", category: "Supplier", email: null, phone: null })).toMatchObject({
      id: "directory:v",
      label: "Acme - Directory",
      contactType: "supplier",
      directoryContactId: "v",
    })
    expect(customerToTaskAssigneeOption({ id: "c", name: "Pat", company: "Owner LLC", email: null, phone: null }).label).toBe(
      "Pat - Owner LLC"
    )
    expect(
      vendorPersonToTaskAssigneeOption({ id: "p", vendorName: "Acme", category: "Subcontractor", name: "Sam", email: null, phone: null })
    ).toMatchObject({ id: "directory:vendor-contact:p", label: "Sam - Acme", contactType: "subcontractor" })
    expect(
      organizationUserToTaskAssigneeOption({ id: "u", email: "a@b.c", displayName: " ", firstName: "Ana", lastName: "Lee" }).name
    ).toBe("Ana Lee")
    expect(
      organizationUserToTaskAssigneeOption({ id: "u", email: "a@b.c", displayName: null, firstName: null, lastName: null }).name
    ).toBe("a@b.c")
  })
})
