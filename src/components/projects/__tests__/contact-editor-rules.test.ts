import { describe, expect, it } from "vitest"

import {
  defaultProjectRole,
  directorySourceLabel,
  groupedDirectoryOptions,
  initialInput,
  inputWithContactType,
  inputWithCostCode,
  inputWithCustomerContact,
  inputWithDirectoryOption,
  inputWithDivision,
  inputWithVendorContact,
  isPresetProjectRole,
  isProjectContactType,
  isVendorContactType,
  matchingCustomerOptions,
} from "@/components/projects/contact-editor/contact-editor-rules"
import type {
  ProjectContactDirectoryOption,
  ProjectContactSageOptions,
} from "@/lib/domain/contacts/types"

function directory(overrides: Partial<ProjectContactDirectoryOption> = {}): ProjectContactDirectoryOption {
  return {
    id: "v1",
    sourceType: "vendor",
    displayName: "Peak Glass",
    companyName: "Peak Glass",
    email: "office@peak.test",
    phone: "719-555-0100",
    address: "1 Main St",
    suggestedContactType: "supplier",
    identityManagedByActiveUser: false,
    customerContacts: [],
    vendorContacts: [
      { id: "vc1", name: "Pat Lee", title: "PM", email: "pat@peak.test", phone: null, isPrimary: true, identityManagedByActiveUser: false },
    ],
    ...overrides,
  }
}

const sageOptions: ProjectContactSageOptions = {
  divisions: [
    { value: "08", label: "08 Openings", name: "Openings" },
    { value: "09", label: "09 Finishes", name: "Finishes" },
  ],
  costCodes: [
    { value: "08-500", label: "08-500 Windows", description: "", divisionCode: "08", divisionName: "Openings" },
  ],
}

const blank = initialInput("p1", null)

describe("contact editor basics", () => {
  it("starts a new owner contact", () => {
    expect(blank).toMatchObject({
      projectId: "p1",
      contactId: null,
      directorySourceType: null,
      contactType: "owner",
      internalVisible: true,
      ownerPortalVisible: false,
    })
  })

  it("knows roles, types and directory labels", () => {
    expect(defaultProjectRole("owner")).toBe("Owner / Client")
    expect(defaultProjectRole("internal")).toBe("")
    expect(isPresetProjectRole("Supplier")).toBe(true)
    expect(isPresetProjectRole("Landscape architect")).toBe(false)
    expect(isProjectContactType("subcontractor")).toBe(true)
    expect(isProjectContactType("vendor")).toBe(false)
    expect(isVendorContactType("supplier")).toBe(true)
    expect(isVendorContactType("owner")).toBe(false)
    expect(directorySourceLabel("team")).toBe("Internal team")
  })

  it("groups directory options in customer, vendor, team order", () => {
    const groups = groupedDirectoryOptions([
      directory({ id: "t", sourceType: "team" }),
      directory({ id: "c", sourceType: "customer" }),
    ])
    expect(groups.map((group) => group.sourceType)).toEqual(["customer", "team"])
  })
})

describe("contact editor draft changes", () => {
  it("links a vendor and opens the sub/vendor workspace", () => {
    const next = inputWithDirectoryOption({ ...blank, contactType: "subcontractor" }, directory())
    expect(next).toMatchObject({
      directorySourceType: "vendor",
      directorySourceId: "v1",
      vendorId: "v1",
      contactType: "subcontractor",
      role: "Subcontractor",
      displayName: "Peak Glass",
      subVendorPortalVisible: true,
    })
  })

  it("links a customer using its suggested type", () => {
    const next = inputWithDirectoryOption(blank, directory({ id: "c1", sourceType: "customer", suggestedContactType: "owner" }))
    expect(next).toMatchObject({ vendorId: null, contactType: "owner", role: "Owner / Client" })
  })

  it("picks a vendor person or the company only", () => {
    const vendor = directory()
    expect(inputWithVendorContact(blank, vendor, "vc1")).toMatchObject({ vendorContactId: "vc1", displayName: "Pat Lee", email: "pat@peak.test", phone: "", companyName: "Peak Glass" })
    expect(inputWithVendorContact(blank, vendor, "company-only")).toMatchObject({ vendorContactId: null, displayName: "Peak Glass", phone: "719-555-0100" })
    expect(inputWithVendorContact(blank, vendor, "missing")).toBeNull()
  })

  it("picks a client person or the company only", () => {
    const customer = directory({
      sourceType: "customer",
      customerContacts: [{ id: "cc1", name: "Sam Ortiz", title: null, email: null, phone: "719-555-0199", isPrimary: false, identityManagedByActiveUser: false }],
    })
    expect(inputWithCustomerContact(blank, customer, "cc1")).toMatchObject({ customerContactId: "cc1", displayName: "Sam Ortiz", email: "", phone: "719-555-0199", address: "1 Main St" })
    expect(inputWithCustomerContact(blank, customer, "company-only")).toMatchObject({ customerContactId: null, displayName: "Peak Glass" })
    expect(inputWithCustomerContact(blank, customer, "missing")).toBeNull()
  })

  it("keeps a cost code only inside its division", () => {
    const withCode = inputWithCostCode(blank, sageOptions.costCodes[0] ?? null)
    expect(withCode).toMatchObject({ primaryCostCode: "08-500", csiDivision: "08", csiDivisionName: "Openings" })
    expect(inputWithDivision(withCode, "08", sageOptions)?.primaryCostCode).toBe("08-500")
    expect(inputWithDivision(withCode, "09", sageOptions)).toMatchObject({ csiDivision: "09", primaryCostCode: "" })
    expect(inputWithDivision(withCode, "unassigned", sageOptions)).toMatchObject({ csiDivision: "", csiDivisionName: "", primaryCostCode: "" })
    expect(inputWithDivision(withCode, "77", sageOptions)).toBeNull()
    expect(inputWithCostCode(withCode, null).primaryCostCode).toBe("")
  })

  it("drops the directory link unless switching between vendor types", () => {
    const linked = inputWithDirectoryOption({ ...blank, contactType: "supplier" }, directory())
    expect(inputWithContactType(linked, "subcontractor", true)).toMatchObject({ vendorId: "v1", role: "Subcontractor" })
    expect(inputWithContactType(linked, "owner", false)).toMatchObject({ vendorId: null, directorySourceId: null, role: "Owner / Client" })
  })

  it("finds existing clients by email or name and company", () => {
    const options = [
      directory({ id: "c1", sourceType: "customer", displayName: "Sam Ortiz", companyName: null, email: "SAM@x.test" }),
      directory({ id: "c2", sourceType: "customer", displayName: "Lee Family", companyName: "Lee Trust", email: null }),
    ]
    expect(matchingCustomerOptions(options, { name: "Other", email: " sam@x.test ", company: "" }).map((option) => option.id)).toEqual(["c1"])
    expect(matchingCustomerOptions(options, { name: "lee family", email: "", company: "LEE TRUST" }).map((option) => option.id)).toEqual(["c2"])
    expect(matchingCustomerOptions(options, { name: "Nobody", email: "", company: "" })).toEqual([])
  })
})
