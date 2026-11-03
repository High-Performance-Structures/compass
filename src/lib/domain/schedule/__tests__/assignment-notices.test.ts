import { describe, expect, it } from "vitest"

import { publishedAssigneeUserIds, scheduleConfirmationHref } from "../assignment-notices"

describe("schedule assignment notices", () => {
  it("reads a publication's assignee list, or the single account older snapshots kept", () => {
    expect(publishedAssigneeUserIds({ assignedUserId: "u-ann", assigneeUserIds: ["u-ann", "u-cy"] })).toEqual([
      "u-ann",
      "u-cy",
    ])
    expect(publishedAssigneeUserIds({ assignedUserId: "u-ann", assigneeUserIds: [] })).toEqual(["u-ann"])
    expect(publishedAssigneeUserIds({ assignedUserId: null, assigneeUserIds: [] })).toEqual([])
  })

  it("links owners and vendors to their portal and staff to the item", () => {
    expect(scheduleConfirmationHref("p1", "t1", "owner")).toBe("/preview/projects/p1/owner/schedule")
    expect(scheduleConfirmationHref("p1", "t1", "supplier")).toBe("/preview/projects/p1/sub-vendor/schedule")
    expect(scheduleConfirmationHref("p1", "t1", null)).toBe("/dashboard/projects/p1/schedule?view=list&item=t1")
  })
})
