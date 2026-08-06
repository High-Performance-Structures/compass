import { describe, expect, it } from "vitest"

import {
  buildRfiContactOptions,
  RFI_CONTACT_GROUPS,
} from "@/lib/rfis/contact-options"

describe("RFI contact options", () => {
  it("includes and groups staff, owners, subcontractors, and suppliers", () => {
    const result = buildRfiContactOptions([
      { label: "Wes Jones", contactType: "internal" },
      { label: "Tanis Loomis", contactType: "owner" },
      { label: "Acme Electric", contactType: "subcontractor" },
      { label: "Front Range Supply", contactType: "supplier" },
    ])

    expect(result).toEqual([
      { value: "Wes Jones", label: "Wes Jones", group: "internal" },
      { value: "Tanis Loomis", label: "Tanis Loomis", group: "owner" },
      {
        value: "Acme Electric",
        label: "Acme Electric",
        group: "subcontractor",
      },
      {
        value: "Front Range Supply",
        label: "Front Range Supply",
        group: "supplier",
      },
    ])
    expect(RFI_CONTACT_GROUPS.map((group) => group.label)).toEqual([
      "Internal staff",
      "Owners",
      "Subcontractors",
      "Suppliers",
    ])
  })

  it("deduplicates the same person across project and directory sources", () => {
    const result = buildRfiContactOptions([
      { label: "Sylvi Vogel", contactType: "internal" },
      { label: " sylvi vogel ", contactType: "internal" },
    ])

    expect(result).toHaveLength(1)
    expect(result[0]?.label).toBe("Sylvi Vogel")
  })
})
