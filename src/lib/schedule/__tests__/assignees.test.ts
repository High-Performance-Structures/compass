import { describe, expect, it } from "vitest"

import {
  addedAssigneeUserIds,
  compactAssigneeLabel,
  joinAssigneeNames,
  normalizeAssigneeInputs,
  samePeople,
  scheduleItemAssigneeNames,
  scheduleItemAssigneeUserIds,
} from "@/lib/schedule/assignees"

const ann = { name: "Ann Lee", assignedUserId: "u-ann", projectContactId: null }
const bo = { name: "Bo Diaz", assignedUserId: null, projectContactId: "pc-bo" }
const cy = { name: "Cy Ross", assignedUserId: "u-cy", projectContactId: null }

describe("schedule assignees", () => {
  it("joins names for the legacy assigned_to column", () => {
    expect(joinAssigneeNames(["Ann Lee", "Bo Diaz"])).toBe("Ann Lee, Bo Diaz")
    expect(joinAssigneeNames([])).toBeNull()
  })

  it("trims, drops blanks and repeats, and keeps picked order", () => {
    expect(
      normalizeAssigneeInputs([
        { name: "  Bo  Diaz ", optionId: " project:pc-bo " },
        { name: "", optionId: null },
        { name: "ann lee", optionId: "team:u-ann" },
        { name: "BO DIAZ", optionId: null },
      ])
    ).toEqual([
      { name: "Bo Diaz", optionId: "project:pc-bo" },
      { name: "ann lee", optionId: "team:u-ann" },
    ])
  })

  it("shows the people rows while they still match assigned_to", () => {
    expect(scheduleItemAssigneeNames({ assignedTo: "Ann Lee, Bo Diaz", people: [ann, bo] })).toEqual([
      "Ann Lee",
      "Bo Diaz",
    ])
  })

  it("falls back to the single stored name when rows are missing or stale", () => {
    expect(scheduleItemAssigneeNames({ assignedTo: "Framing Crew" })).toEqual(["Framing Crew"])
    // Another writer (an import, the API) changed assigned_to after the rows.
    expect(scheduleItemAssigneeNames({ assignedTo: "Cy Ross", people: [ann, bo] })).toEqual(["Cy Ross"])
    expect(scheduleItemAssigneeNames({ assignedTo: null, people: [] })).toEqual([])
  })

  it("lists every linked account once, including the legacy single account", () => {
    expect(
      scheduleItemAssigneeUserIds({ assignedTo: "Ann Lee, Bo Diaz, Cy Ross", assignedUserId: "u-ann", people: [ann, bo, cy] })
    ).toEqual(["u-ann", "u-cy"])
    expect(scheduleItemAssigneeUserIds({ assignedTo: "Ann Lee", assignedUserId: "u-old" })).toEqual(["u-old"])
    expect(scheduleItemAssigneeUserIds({ assignedTo: "Ann Lee", assignedUserId: null })).toEqual([])
  })

  it("shows one name and +N for the rest", () => {
    expect(compactAssigneeLabel(["Ann Lee"])).toBe("Ann Lee")
    expect(compactAssigneeLabel(["Ann Lee", "Bo Diaz", "Cy Ross"])).toBe("Ann Lee +2")
    expect(compactAssigneeLabel([])).toBe("-")
  })

  it("names only the accounts a change added", () => {
    expect(addedAssigneeUserIds(["u-ann"], ["u-ann", "u-cy"])).toEqual(["u-cy"])
    expect(addedAssigneeUserIds(["u-ann", "u-cy"], ["u-cy"])).toEqual([])
    expect(addedAssigneeUserIds([], ["u-ann"])).toEqual(["u-ann"])
  })

  it("compares people lists by name, links and order", () => {
    expect(samePeople([ann, bo], [ann, bo])).toBe(true)
    expect(samePeople([ann, bo], [bo, ann])).toBe(false)
    expect(samePeople([ann], [{ ...ann, assignedUserId: null }])).toBe(false)
    expect(samePeople([], [ann])).toBe(false)
  })
})
