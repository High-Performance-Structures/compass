import { describe, expect, it } from "vitest"
import { warrantyAssigneeKey, warrantyAssigneeOptions, type WarrantyAssigneeOption } from "@/lib/warranty/assignee"

const options: readonly WarrantyAssigneeOption[] = [
  { key: "project:pc-ted", label: "Ted's Plumbing & Hydronics", name: "Ted's Plumbing & Hydronics", projectContactId: "pc-ted", vendorId: null },
  { key: "directory:v-ted", label: "Ted's Plumbing & Hydronics - Directory", name: "Ted's Plumbing & Hydronics", projectContactId: null, vendorId: "v-ted" },
  { key: "project:pc-wes", label: "Wes Jones - Bishop Built", name: "Wes Jones", projectContactId: "pc-wes", vendorId: null },
]

describe("warrantyAssigneeKey", () => {
  it("starts on the linked contact, then the vendor", () => {
    expect(warrantyAssigneeKey({ assignedName: "x", assignedProjectContactId: "pc-wes", assignedVendorId: null }, options)).toBe("project:pc-wes")
    expect(warrantyAssigneeKey({ assignedName: "x", assignedProjectContactId: null, assignedVendorId: "v-ted" }, options)).toBe("directory:v-ted")
  })

  it("links an older text-only assignment by name, preferring the project contact", () => {
    expect(warrantyAssigneeKey({ assignedName: "Ted's Plumbing & Hydronics", assignedProjectContactId: null, assignedVendorId: null }, options)).toBe("project:pc-ted")
  })

  it("keeps an unmatched name as-is and an empty one as unassigned", () => {
    expect(warrantyAssigneeKey({ assignedName: "Old Sub LLC", assignedProjectContactId: null, assignedVendorId: null }, options)).toBe("name:Old Sub LLC")
    expect(warrantyAssigneeKey({ assignedName: null, assignedProjectContactId: null, assignedVendorId: null }, options)).toBe("")
  })
})

describe("warrantyAssigneeOptions", () => {
  it("keeps project contacts and vendors, and leaves out customers", () => {
    const result = warrantyAssigneeOptions({
      projectContacts: [{ id: "project:pc-ted", label: "Ted", name: "Ted", projectContactId: "pc-ted" }],
      directoryContacts: [
        { id: "directory:v-ted", label: "Ted - Directory", name: "Ted", directoryContactId: "v-ted" },
        { id: "directory:vendor-contact:vc-1", label: "Ann - Ted", name: "Ann", directoryContactId: null },
        { id: "directory:customer:c-1", label: "Shultz", name: "Shultz", directoryContactId: null },
      ],
    })
    expect(result.map((option) => option.key)).toEqual(["project:pc-ted", "directory:v-ted", "directory:vendor-contact:vc-1"])
    expect(result[1]?.vendorId).toBe("v-ted")
  })
})
