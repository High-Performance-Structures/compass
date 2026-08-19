import { describe, expect, it } from "vitest"

import { selectProjectAudienceScheduleItems } from "@/lib/project-audience-schedule-visibility"

const rows = [
  { id: "owner-and-partner", ownerVisible: true, subVendorVisible: true },
  { id: "owner-only", ownerVisible: true, subVendorVisible: false },
  { id: "internal", ownerVisible: false, subVendorVisible: false },
] as const

describe("project audience schedule visibility", () => {
  it("keeps owner visibility authoritative for owner workspaces", () => {
    expect(
      selectProjectAudienceScheduleItems(rows, "owner").map((item) => item.id)
    ).toEqual(["owner-and-partner", "owner-only"])
  })

  it("uses explicit partner selections when the schedule has them", () => {
    expect(
      selectProjectAudienceScheduleItems(rows, "sub_vendor").map(
        (item) => item.id
      )
    ).toEqual(["owner-and-partner"])
  })

  it("falls back to owner-approved rows for legacy schedules", () => {
    const legacyRows = rows.map((item) => ({
      ...item,
      subVendorVisible: false,
    }))
    expect(
      selectProjectAudienceScheduleItems(legacyRows, "sub_vendor").map(
        (item) => item.id
      )
    ).toEqual(["owner-and-partner", "owner-only"])
  })
})
