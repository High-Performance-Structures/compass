import { describe, expect, it } from "vitest"

import { findExistingNamedPerson } from "../customer-person-match"

describe("findExistingNamedPerson", () => {
  const people = [
    { id: "alex", name: "Alex Morgan", email: "family@example.com" },
    { id: "taylor", name: "Taylor Morgan", email: "family@example.com" },
  ]

  it("reuses an existing name despite casing and surrounding space", () => {
    expect(findExistingNamedPerson(people, "  ALEX MORGAN ")?.id).toBe("alex")
  })

  it("does not collapse different people who share an email", () => {
    expect(findExistingNamedPerson(people, "Taylor Morgan")?.id).toBe("taylor")
    expect(findExistingNamedPerson(people, "Casey Morgan")).toBeNull()
  })

  it("ignores the record being edited", () => {
    expect(findExistingNamedPerson(people, "Alex Morgan", "alex")).toBeNull()
  })
})
