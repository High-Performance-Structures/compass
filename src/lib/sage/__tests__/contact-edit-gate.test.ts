import { describe, expect, it } from "vitest"

import {
  changesSageLinkedCustomerIdentity,
  changesSageLinkedVendorIdentity,
  COMPASS_ONLY_PRIMARY_ERROR,
  sageLinkedVendorPeopleChangeError,
} from "@/lib/sage/contact-edit-gate"

describe("Sage-linked contact edit gate", () => {
  it("does not treat unchanged customer fields or local notes as Sage changes", () => {
    const existing = { name: "Acme", email: "a@example.com", notes: "old" }
    expect(changesSageLinkedCustomerIdentity(existing, {
      name: " Acme ", notes: "new",
    })).toBe(false)
  })

  it("detects customer address and primary-email changes", () => {
    const existing = { addressLine1: "1 Main", primaryEmail: null }
    expect(changesSageLinkedCustomerIdentity(existing, {
      addressLine1: "2 Main",
    })).toBe(true)
    expect(changesSageLinkedCustomerIdentity(existing, {
      primaryEmail: "owner@example.com",
    })).toBe(true)
  })

  it("detects vendor identity changes but permits Compass-only category edits", () => {
    const existing = { name: "Supply Co", ownerName: "Jane", category: "Supplier" }
    expect(changesSageLinkedVendorIdentity(existing, {
      category: "Subcontractor",
    })).toBe(false)
    expect(changesSageLinkedVendorIdentity(existing, {
      ownerName: "Alex",
    })).toBe(true)
  })

  it("allows a category-only vendor edit when the dialog resubmits unchanged contacts", () => {
    const existing = [{
      id: "contact-1", name: "Alex", title: "Owner", email: "alex@example.com",
      phone: "555-0100", isPrimary: true, active: true, sageContactId: "S-1", sageLineNumber: 1,
    }]
    const submitted = [{
      id: "contact-1", name: "Alex", title: "Owner", email: "alex@example.com",
      phone: "555-0100", isPrimary: true,
    }]
    expect(sageLinkedVendorPeopleChangeError(submitted, existing)).toBeNull()
    expect(sageLinkedVendorPeopleChangeError([{ ...submitted[0], phone: "555-0200" }], existing)).toContain("Sage review")
    expect(sageLinkedVendorPeopleChangeError([], existing)).toContain("Sage review")
  })

  it("lets Compass-only people be added, edited and removed, but never made primary", () => {
    const sage = { id: "sage-1", name: "Alex", title: "", email: "", phone: "", isPrimary: true }
    const local = { id: "local-1", name: "Jane", title: "", email: "", phone: "", isPrimary: false }
    const existing = [
      { ...sage, title: null, email: null, phone: null, active: true, sageContactId: null, sageLineNumber: 4 },
      { ...local, title: null, email: null, phone: null, active: true, sageContactId: null, sageLineNumber: null },
    ]
    expect(sageLinkedVendorPeopleChangeError([sage, { ...local, phone: "555-0300", title: "PM" }], existing)).toBeNull()
    expect(sageLinkedVendorPeopleChangeError([sage], existing)).toBeNull()
    expect(sageLinkedVendorPeopleChangeError([sage, local, { ...local, id: null, name: "New" }], existing)).toBeNull()
    expect(sageLinkedVendorPeopleChangeError([{ ...sage, isPrimary: false }, { ...local, isPrimary: true }], existing)).toBe(COMPASS_ONLY_PRIMARY_ERROR)
    expect(sageLinkedVendorPeopleChangeError([sage, { ...local, id: null, isPrimary: true }], existing)).toBe(COMPASS_ONLY_PRIMARY_ERROR)
    expect(sageLinkedVendorPeopleChangeError([local], existing)).toContain("Sage review")
  })
})
