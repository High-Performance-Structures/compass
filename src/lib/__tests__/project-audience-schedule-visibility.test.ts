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

  it("does not expose owner rows when every partner flag is off", () => {
    expect(
      selectProjectAudienceScheduleItems(
        rows.map((item) => ({ ...item, subVendorVisible: false })),
        "sub_vendor"
      ).map((item) => item.id)
    ).toEqual([])
  })

  it("keeps owner-approved rows visible for snapshots predating partner flags", () => {
    const legacyRows = rows.map((item) => ({
      id: item.id,
      ownerVisible: item.ownerVisible,
    }))
    expect(
      selectProjectAudienceScheduleItems(legacyRows, "sub_vendor").map(
        (item) => item.id
      )
    ).toEqual(["owner-and-partner", "owner-only"])
  })
})

describe("partner schedule rules", () => {
  const items = [
    { id: "marked", ownerVisible: true, subVendorVisible: true },
    { id: "theirs", ownerVisible: true, subVendorVisible: false },
    { id: "other", ownerVisible: true, subVendorVisible: false },
  ]

  it("shows a partner the items they're responsible for even when unmarked", () => {
    expect(
      selectProjectAudienceScheduleItems(items, "sub_vendor", { isViewerAssigned: (item) => item.id === "theirs" }).map((item) => item.id)
    ).toEqual(["marked", "theirs"])
  })

  it("shows every item when the job shows subs the full schedule", () => {
    expect(selectProjectAudienceScheduleItems(items, "sub_vendor", { view: "full" }).map((item) => item.id)).toEqual(["marked", "theirs", "other"])
  })

  it("never widens what owners see", () => {
    const ownerItems = items.map((item) => ({ ...item, ownerVisible: item.id !== "other" }))
    expect(
      selectProjectAudienceScheduleItems(ownerItems, "owner", { view: "full", isViewerAssigned: () => true }).map((item) => item.id)
    ).toEqual(["marked", "theirs"])
  })
})
