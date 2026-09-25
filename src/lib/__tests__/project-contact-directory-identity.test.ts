import { describe, expect, it } from "vitest"

import {
  isCanonicalDirectoryAssignment,
  isSameProjectContactDirectoryIdentity,
  isUnchangedProjectContactDirectorySelection,
  resolveProjectContactIdentity,
  resolveProjectContactMutationIdentity,
} from "@/lib/project-contact-directory-identity"

describe("isCanonicalDirectoryAssignment", () => {
  const unlinked = {
    sourceEntityType: "manual",
    customerId: null,
    customerContactId: null,
    vendorId: null,
    vendorContactId: null,
    internalContactId: null,
  }

  it("keeps unlinked legacy project snapshots editable", () => {
    expect(isCanonicalDirectoryAssignment(unlinked)).toBe(false)
  })

  it("protects current and legacy shared-directory links", () => {
    expect(isCanonicalDirectoryAssignment({ ...unlinked, vendorContactId: "person-1" })).toBe(true)
    expect(isCanonicalDirectoryAssignment({ ...unlinked, customerId: "client-1" })).toBe(true)
    expect(isCanonicalDirectoryAssignment({ ...unlinked, internalContactId: "staff-1" })).toBe(true)
    expect(isCanonicalDirectoryAssignment({ ...unlinked, sourceEntityType: "vendor_contact" })).toBe(true)
    expect(isCanonicalDirectoryAssignment({ ...unlinked, sourceEntityType: "user" })).toBe(true)
  })
})

describe("project directory selection access", () => {
  const existing = {
    sourceEntityType: "vendor_contact",
    sourceEntityId: "vendor-person-1",
    customerId: null,
    customerContactId: null,
    vendorId: "vendor-1",
    vendorContactId: "vendor-person-1",
    internalContactId: null,
  }

  it("permits project-only edits when the selected vendor person is unchanged", () => {
    expect(isUnchangedProjectContactDirectorySelection(existing, {
      sourceType: "vendor", sourceId: "vendor-1",
      customerContactId: null, vendorContactId: "vendor-person-1",
    })).toBe(true)
  })

  it("requires directory access for a new company or person selection", () => {
    for (const selected of [
      { sourceType: "vendor" as const, sourceId: "vendor-2", customerContactId: null, vendorContactId: null },
      { sourceType: "vendor" as const, sourceId: "vendor-1", customerContactId: null, vendorContactId: "vendor-person-2" },
    ]) {
      expect(isUnchangedProjectContactDirectorySelection(existing, selected)).toBe(false)
      expect(isUnchangedProjectContactDirectorySelection(null, selected)).toBe(false)
    }
  })

  it("recognizes unchanged client and internal assignments", () => {
    expect(isUnchangedProjectContactDirectorySelection({
      ...existing, sourceEntityType: "customer_contact", sourceEntityId: "client-person-1",
      customerId: "client-1", customerContactId: "client-person-1",
      vendorId: null, vendorContactId: null,
    }, {
      sourceType: "customer", sourceId: "client-1",
      customerContactId: "client-person-1", vendorContactId: null,
    })).toBe(true)
    expect(isUnchangedProjectContactDirectorySelection({
      ...existing, sourceEntityType: "internal_contact", sourceEntityId: "staff-1",
      vendorId: null, vendorContactId: null, internalContactId: "staff-1",
    }, {
      sourceType: "team", sourceId: "staff-1",
      customerContactId: null, vendorContactId: null,
    })).toBe(true)
    expect(isUnchangedProjectContactDirectorySelection({
      ...existing, sourceEntityType: "internal_contact", sourceEntityId: "staff-1",
      vendorId: null, vendorContactId: null, internalContactId: null,
    }, {
      sourceType: "team", sourceId: "staff-1",
      customerContactId: null, vendorContactId: null,
    })).toBe(true)
  })
})

describe("resolveProjectContactIdentity", () => {
  it("uses linked directory identity as the canonical contact information", () => {
    expect(
      resolveProjectContactIdentity(
        {
          email: "old@example.com",
          phone: "303-555-0100",
          address: "Old address",
        },
        {
          email: " current@example.com ",
          phone: "303-555-0199",
          address: "Current address",
        }
      )
    ).toEqual({
      email: "current@example.com",
      phone: "303-555-0199",
      address: "Current address",
    })
  })

  it("preserves snapshots only for unlinked legacy assignments", () => {
    expect(
      resolveProjectContactIdentity(
        {
          email: "project@example.com",
          phone: "303-555-0100",
          address: null,
        },
        { email: "", phone: null, address: "  " }
      )
    ).toEqual({
      email: "project@example.com",
      phone: "303-555-0100",
      address: null,
    })
  })

  it("never resurrects cleared fields for linked vendor, internal, or company records", () => {
    const snapshot = {
      email: "old@example.com",
      phone: "303-555-0100",
      address: "Old address",
    }
    for (const kind of ["vendor person", "internal person", "company"]) {
      expect(
        resolveProjectContactIdentity(
          snapshot,
          { email: "", phone: null, address: "  " },
          true
        ),
        kind
      ).toEqual({ email: null, phone: null, address: null })
    }
    expect(resolveProjectContactIdentity(snapshot, null, true)).toEqual({
      email: null,
      phone: null,
      address: null,
    })
  })

  it("ignores echoed identity fields when saving linked project metadata", () => {
    expect(
      resolveProjectContactMutationIdentity({
        submittedIdentity: {
          email: "stale@example.com",
          phone: "970-555-9999",
          address: "Submitted address",
        },
        existingIdentity: {
          email: "legacy@example.com",
          phone: "970-555-0100",
          address: "Legacy address",
        },
        directoryIdentity: {
          email: "current@example.com",
          phone: null,
          address: null,
        },
        managedByDirectory: true,
      })
    ).toEqual({
      email: "current@example.com",
      phone: null,
      address: null,
    })
  })

  it("keeps submitted identity fields editable for unmanaged contacts", () => {
    const submittedIdentity = {
      email: "updated@example.com",
      phone: "970-555-0199",
      address: "Updated address",
    }

    expect(
      resolveProjectContactMutationIdentity({
        submittedIdentity,
        existingIdentity: {
          email: "old@example.com",
          phone: null,
          address: null,
        },
        directoryIdentity: null,
        managedByDirectory: false,
      })
    ).toEqual(submittedIdentity)
  })

  it("matches migrated vendor-person identities by vendor contact ID", () => {
    expect(
      isSameProjectContactDirectoryIdentity(
        {
          sourceEntityType: "vendor",
          sourceEntityId: "vendor-1",
          customerContactId: null,
          vendorContactId: "person-1",
        },
        {
          sourceEntityType: "vendor_contact",
          sourceEntityId: "person-1",
          customerContactId: null,
          vendorContactId: "person-1",
        }
      )
    ).toBe(true)
  })

  it("does not reuse a snapshot when selecting a different vendor person", () => {
    expect(
      isSameProjectContactDirectoryIdentity(
        {
          sourceEntityType: "vendor",
          sourceEntityId: "vendor-1",
          customerContactId: null,
          vendorContactId: "person-1",
        },
        {
          sourceEntityType: "vendor_contact",
          sourceEntityId: "person-2",
          customerContactId: null,
          vendorContactId: "person-2",
        }
      )
    ).toBe(false)
  })

  it("matches a client person by canonical contact ID across legacy source types", () => {
    expect(
      isSameProjectContactDirectoryIdentity(
        {
          sourceEntityType: "customer",
          sourceEntityId: "customer-1",
          customerContactId: "person-1",
          vendorContactId: null,
        },
        {
          sourceEntityType: "customer_contact",
          sourceEntityId: "person-1",
          customerContactId: "person-1",
          vendorContactId: null,
        }
      )
    ).toBe(true)
  })
})
