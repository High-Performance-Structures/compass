import { describe, expect, it } from "vitest"

import {
  isSameProjectContactDirectoryIdentity,
  resolveProjectContactIdentity,
  resolveProjectContactMutationIdentity,
} from "@/lib/project-contact-directory-identity"

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

  it("preserves project snapshots when a linked directory field is blank", () => {
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

  it("ignores echoed identity fields when saving active-user project metadata", () => {
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
        managedByActiveUser: true,
      })
    ).toEqual({
      email: "current@example.com",
      phone: "970-555-0100",
      address: "Legacy address",
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
        managedByActiveUser: false,
      })
    ).toEqual(submittedIdentity)
  })

  it("matches migrated vendor-person identities by vendor contact ID", () => {
    expect(
      isSameProjectContactDirectoryIdentity(
        {
          sourceEntityType: "vendor",
          sourceEntityId: "vendor-1",
          vendorContactId: "person-1",
        },
        {
          sourceEntityType: "vendor_contact",
          sourceEntityId: "person-1",
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
          vendorContactId: "person-1",
        },
        {
          sourceEntityType: "vendor_contact",
          sourceEntityId: "person-2",
          vendorContactId: "person-2",
        }
      )
    ).toBe(false)
  })
})
