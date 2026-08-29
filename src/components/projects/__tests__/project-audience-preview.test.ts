import { describe, expect, it } from "vitest"

import type { AudienceScheduleItem } from "@/app/actions/project-audience-preview"
import { selectUpcomingScheduleItems } from "@/lib/project-audience-schedule-selection"

function scheduleItem(
  id: string,
  startDate: string,
  endDate: string,
  percentComplete: number,
  status = "scheduled"
): AudienceScheduleItem {
  return {
    id,
    title: id,
    startDate,
    endDate,
    workdays: 1,
    status,
    phase: "Construction",
    displayColor: "blue",
    assignedTo: null,
    percentComplete,
    isMilestone: false,
    confirmationRequired: false,
    confirmationStatus: "not_requested",
    viewerCanConfirm: false,
    proposedStartDate: null,
    proposedWorkdays: null,
    proposalNote: null,
    proposalSubmittedAt: null,
    assignees: [],
  }
}

describe("selectUpcomingScheduleItems", () => {
  it("shows current and future incomplete work instead of completed history", () => {
    const selected = selectUpcomingScheduleItems(
      [
        scheduleItem("future-later", "2026-08-03", "2026-08-05", 0),
        scheduleItem("past-incomplete", "2026-07-01", "2026-07-10", 50),
        scheduleItem("completed-future", "2026-07-30", "2026-07-30", 100),
        scheduleItem("active-now", "2026-07-27", "2026-07-29", 50),
        scheduleItem("future-next", "2026-07-30", "2026-08-01", 0),
      ],
      "2026-07-28"
    )

    expect(selected.map((item) => item.id)).toEqual([
      "active-now",
      "future-next",
      "future-later",
    ])
  })

  it("excludes records marked complete even when their percentage is stale", () => {
    const selected = selectUpcomingScheduleItems(
      [
        scheduleItem("stale-complete", "2026-07-29", "2026-07-29", 0, "complete"),
        scheduleItem("visible", "2026-07-30", "2026-07-30", 0),
      ],
      "2026-07-28"
    )

    expect(selected.map((item) => item.id)).toEqual(["visible"])
  })
})
