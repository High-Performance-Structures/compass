import { describe, expect, it } from "vitest"

import {
  changesSageLinkedCustomerIdentity,
  changesSageLinkedVendorIdentity,
  isLegacySageClientEmailFill,
  sameSageLinkedVendorContacts,
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

  it("preserves only the guarded first-email Sage write", () => {
    const existing = {
      sageClientId: "101", sageClientNumber: "123", email: null,
      name: "Acme", phone: null,
    }
    expect(isLegacySageClientEmailFill(existing, { email: "new@example.com", name: "Acme" })).toBe(true)
    expect(isLegacySageClientEmailFill(existing, { email: "new@example.com", name: "Different" })).toBe(false)
    expect(isLegacySageClientEmailFill({ ...existing, email: "old@example.com" }, {
      email: "new@example.com",
    })).toBe(false)
  })

  it("allows a category-only vendor edit when the dialog resubmits unchanged contacts", () => {
    const existing = [{
      id: "contact-1", name: "Alex", title: "Owner", email: "alex@example.com",
      phone: "555-0100", isPrimary: true, active: true,
    }]
    const submitted = [{
      id: "contact-1", name: "Alex", title: "Owner", email: "alex@example.com",
      phone: "555-0100", isPrimary: true,
    }]
    expect(sameSageLinkedVendorContacts(submitted, existing)).toBe(true)
    expect(sameSageLinkedVendorContacts([{ ...submitted[0], phone: "555-0200" }], existing)).toBe(false)
    expect(sameSageLinkedVendorContacts([], existing)).toBe(false)
  })
})
