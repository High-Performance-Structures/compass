import { describe, expect, it } from "vitest"

import { sageContactProposalFields } from "@/lib/sage/contact-change-proposal"
import {
  COMPASS_ONLY_FIELDS,
  describeSageChanges,
  SAGE_SHARED_FIELDS,
  sageSharedChanges,
  sameRequestedChanges,
} from "@/lib/sage/sage-linked-edit-fields"

describe("Sage-linked inline edit fields", () => {
  it("only shares fields a reviewed Sage proposal can carry", () => {
    for (const [kind, fields] of Object.entries(SAGE_SHARED_FIELDS)) {
      if (kind !== "vendor_company" && kind !== "client_company" && kind !== "vendor_person" && kind !== "client_person") continue
      for (const field of fields) expect(sageContactProposalFields(kind)).toContain(field)
    }
    expect(SAGE_SHARED_FIELDS.client_company).not.toContain("primaryEmail")
    expect(COMPASS_ONLY_FIELDS.vendor_company).toEqual(["category"])
    expect(COMPASS_ONLY_FIELDS.client_company).toEqual(["company", "notes", "primaryEmail"])
  })

  it("finds only Sage-shared fields that changed", () => {
    const current = { name: "Acme", phone: "555-0100", email: null, category: "Supplier" }
    expect(sageSharedChanges("vendor_company", current, {
      name: " Acme ", phone: "555-0199", email: "", category: "Subcontractor",
    })).toEqual({ phone: "555-0199" })
    expect(sageSharedChanges("vendor_company", current, { email: "ap@acme.example" })).toEqual({ email: "ap@acme.example" })
    expect(sageSharedChanges("client_company", { name: "Kelly", company: "K LLC" }, { company: "Other" })).toEqual({})
  })

  it("recognizes a repeated request and describes changes for Activity", () => {
    const open = [{ field: "phone", after: "555-0199" }]
    expect(sameRequestedChanges(open, { phone: " 555-0199 " })).toBe(true)
    expect(sameRequestedChanges(open, { phone: "555-0100" })).toBe(false)
    expect(sameRequestedChanges(open, { phone: "555-0199", name: "Acme" })).toBe(false)
    expect(describeSageChanges([{ field: "phone", before: null, after: "555-0199" }])).toBe("Phone: (blank) → 555-0199")
  })
})
