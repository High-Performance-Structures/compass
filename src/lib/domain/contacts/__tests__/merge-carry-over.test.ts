import { describe, expect, it } from "vitest"

import { carryOverColumns, planCarryOver, splitForSage } from "@/lib/domain/contacts/merge-carry-over"

describe("planCarryOver", () => {
  it("fills blanks, offers a choice on conflicts, and skips values that only differ in case or spaces", () => {
    const plan = planCarryOver({
      kind: "vendor_company",
      kept: { email: "Office@Example.com ", phone: "555-0199", city: "", ownerName: null },
      merged: { email: "office@example.com", phone: "555-0100", city: "Denver", state: "CO", ownerName: "Pat" },
    })
    expect(plan.changes.map((change) => [change.key, change.action])).toEqual([["ownerName", "fill"], ["phone", "choose"], ["address", "fill"]])
    expect(plan.values).toEqual({
      ownerName: "Pat", addressLine1: null, addressLine2: null, city: "Denver", state: "CO", postalCode: null,
    })
  })

  it("moves an address as one group, so streets and cities never mix", () => {
    const plan = planCarryOver({
      kind: "customer_company",
      kept: { city: "Denver" },
      merged: { addressLine1: "1 Main St", city: "Boulder" },
      choices: { address: "merged" },
    })
    expect(plan.changes).toEqual([{ key: "address", label: "Address", keptValue: "Denver", mergedValue: "1 Main St, Boulder", action: "choose" }])
    expect(plan.values).toMatchObject({ addressLine1: "1 Main St", city: "Boulder" })
  })

  it("lists a locked sign-in email but never changes it", () => {
    const plan = planCarryOver({
      kind: "vendor_person", kept: { email: null }, merged: { email: "pat@example.com" }, lockedKeys: ["email"],
    })
    expect(plan.changes).toEqual([expect.objectContaining({ key: "email", action: "locked" })])
    expect(plan.values).toEqual({})
  })

  it("splits Sage-shared fields from Compass's own and maps columns", () => {
    const split = splitForSage("customer_person", { email: "a@example.com", cellPhone: "555", phoneExtension: "12" })
    expect(split).toEqual({ sage: { email: "a@example.com" }, compass: { cellPhone: "555", phoneExtension: "12" } })
    expect(carryOverColumns("customer_person", split.compass)).toEqual({ phone_extension: "12", cell_phone: "555" })
  })
})
