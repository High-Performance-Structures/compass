import { describe, expect, it } from "vitest"

import { reusableInternalProjectContacts } from "@/lib/reusable-internal-project-contacts"

const rows = [
  { id: "litten-jane", projectId: "litten", displayName: "Jane Doe", email: "Jane@Example.com", phone: null },
  { id: "other-alex-new", projectId: "other", displayName: "Alex Smith", email: "alex@example.com", phone: null },
  { id: "other-alex-old", projectId: "third", displayName: "Alex Smith", email: " ALEX@example.com ", phone: null },
  { id: "other-jane", projectId: "other", displayName: "Jane Doe", email: "jane@example.com", phone: null },
  { id: "other-sam", projectId: "other", displayName: "Sam Lee", email: null, phone: "(303) 555-0100" },
  { id: "third-sam", projectId: "third", displayName: "Sam Lee", email: null, phone: "303-555-0100" },
]

describe("reusableInternalProjectContacts", () => {
  it("offers internal contacts from other projects, not those already on the current project", () => {
    expect(reusableInternalProjectContacts(rows, "litten").map((row) => row.id)).toEqual([
      "other-alex-new",
      "other-sam",
    ])
  })

  it("keeps distinct contacts with no email or phone", () => {
    const noIdentityRows = [
      { id: "one", projectId: "other", displayName: "Pat", email: null, phone: null },
      { id: "two", projectId: "third", displayName: "Pat", email: null, phone: null },
    ]
    expect(reusableInternalProjectContacts(noIdentityRows, "litten").map((row) => row.id)).toEqual([
      "one",
      "two",
    ])
  })
})
