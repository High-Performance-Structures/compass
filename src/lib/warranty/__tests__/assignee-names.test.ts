import { describe, expect, it } from "vitest"
import { warrantyAssigneeChoices, warrantyAssigneeNames } from "@/lib/warranty/assignee-names"

describe("warranty assignees", () => {
  it("dedupes and sorts names from both contact lists", () => {
    expect(warrantyAssigneeNames({
      projectContacts: [{ name: "Wes Jones" }, { name: " Ted's Plumbing & Hydronics " }],
      directoryContacts: [{ name: "Wes Jones" }, { name: "" }],
    })).toEqual(["Ted's Plumbing & Hydronics", "Wes Jones"])
  })

  it("keeps the current assignee even when the list lacks it", () => {
    expect(warrantyAssigneeChoices([], "Ted's Plumbing & Hydronics")).toEqual(["Ted's Plumbing & Hydronics"])
    expect(warrantyAssigneeChoices(["Wes Jones"], "Wes Jones")).toEqual(["Wes Jones"])
    expect(warrantyAssigneeChoices(["Wes Jones"], null)).toEqual(["Wes Jones"])
  })
})
