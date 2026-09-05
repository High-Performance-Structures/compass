import { describe, expect, it } from "vitest"

import {
  dashboardFinancials,
  dashboardFixture,
  dashboardScheduleItem,
} from "../../../__tests__/fixtures/project-audience-dashboard"
import {
  audienceDashboardDate,
  audienceDashboardHorizon,
  audienceDashboardModel,
  audienceDashboardNeedsConfirmation,
} from "@/lib/project-audience-dashboard"

describe("audience dashboard", () => {
  it("uses the project day across UTC midnight and DST boundaries", () => {
    expect(audienceDashboardDate(new Date("2026-09-09T02:00:00Z"))).toEqual({
      today: "2026-09-08",
      greeting: "Good evening",
    })
    expect(audienceDashboardDate(new Date("2026-03-08T15:00:00Z"))).toEqual({
      today: "2026-03-08",
      greeting: "Good morning",
    })
  })

  it("includes work spanning today but excludes completed, canceled, and out-of-range work", () => {
    const days = audienceDashboardHorizon(
      [
        dashboardScheduleItem({
          startDate: "2026-09-07",
          endDate: "2026-09-09",
        }),
        dashboardScheduleItem({ id: "complete", status: "complete" }),
        dashboardScheduleItem({ id: "cancelled", status: "cancelled" }),
        dashboardScheduleItem({
          id: "future",
          startDate: "2026-09-13",
          endDate: "2026-09-14",
        }),
      ],
      "2026-09-08"
    )
    expect(days.map((day) => day.date)).toEqual([
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
      "2026-09-11",
      "2026-09-12",
    ])
    expect(days.map((day) => day.items.map((item) => item.id))).toEqual([
      ["framing"],
      ["framing"],
      [],
      [],
      [],
    ])
  })

  it("only requests schedule responses that the viewer can give", () => {
    expect(audienceDashboardNeedsConfirmation(dashboardScheduleItem())).toBe(
      true
    )
    expect(
      audienceDashboardNeedsConfirmation(
        dashboardScheduleItem({ viewerCanConfirm: false })
      )
    ).toBe(false)
    expect(
      audienceDashboardNeedsConfirmation(
        dashboardScheduleItem({ confirmationStatus: "declined" })
      )
    ).toBe(false)
    expect(
      audienceDashboardNeedsConfirmation(
        dashboardScheduleItem({
          assignees: [
            {
              id: "assignee-1",
              assignedUserId: "viewer",
              projectContactId: null,
              displayName: "Alex",
              responseStatus: "confirmed",
              dateResponseStatus: "confirmed",
              durationResponseStatus: "confirmed",
              proposedStartDate: null,
              proposedWorkdays: null,
              responseMessage: null,
              viewerCanRespond: true,
            },
          ],
        })
      )
    ).toBe(false)
  })

  it("keeps owner links in the owner workspace and does not invent unread update totals", () => {
    const data = dashboardFixture()
    const model = audienceDashboardModel(
      data,
      dashboardFinancials(),
      "2026-09-08"
    )
    expect(model.priorities.map((item) => item.id)).toEqual([
      "schedule-framing",
      "change-co-1",
    ])
    expect(
      [...model.priorities, ...model.recent].every((item) =>
        item.href.startsWith("/preview/projects/cedar/owner/")
      )
    ).toBe(true)
    expect(
      model.alerts.some((item) => /update|unread|new/i.test(item.title))
    ).toBe(false)
    expect(model.recent[0]?.href).toBe("/preview/projects/cedar/owner/budget")
  })

  it("shares the partner workflow for quotes, commitments, and answered RFIs", () => {
    const model = audienceDashboardModel(
      dashboardFixture("sub_vendor"),
      dashboardFinancials(),
      "2026-09-08"
    )
    expect(model.priorities.map((item) => item.id)).toEqual([
      "schedule-framing",
      "rfq-quote-1",
      "commitment-po-1",
    ])
    expect(
      model.priorities.find((item) => item.id === "rfq-quote-1")?.href
    ).toBe("/preview/projects/cedar/sub-vendor/rfqs#rfq-quote-1")
    expect(model.recent[0]?.href).toBe(
      "/preview/projects/cedar/sub-vendor/rfis#rfi-rfi-1"
    )
    expect(
      [...model.priorities, ...model.recent].some((item) =>
        item.href.includes("/budget")
      )
    ).toBe(false)
  })

  it("does not present closed quotes, completed POs, or another party’s change request as pending", () => {
    const data = dashboardFixture("sub_vendor")
    const model = audienceDashboardModel(
      {
        ...data,
        rfqs: data.rfqs.map((item) => ({ ...item, status: "awarded" })),
        operations: data.operations.map((item) => ({
          ...item,
          status: "complete",
        })),
        scheduleItems: data.scheduleItems.map((item) => ({
          ...item,
          confirmationStatus: "confirmed",
        })),
      },
      {
        changeOrders: [
          {
            id: "co",
            title: "Other request",
            changeOrderNumber: "CO-1",
            status: "needs_information",
            canEdit: false,
          },
        ],
        applications: [],
      },
      "2026-09-08"
    )
    expect(model.priorities).toEqual([])
  })

  it("keeps unavailable summaries distinct from zero", () => {
    const model = audienceDashboardModel(
      dashboardFixture(),
      { changeOrders: null, applications: null },
      "2026-09-08"
    )
    expect(model.alerts.map((item) => item.title)).toEqual([
      "Schedule responses",
    ])
    expect(model.recent.map((item) => item.id)).toEqual(["update-update-1"])
  })

  it("keeps project identifiers encoded in every destination", () => {
    const data = dashboardFixture("sub_vendor")
    const model = audienceDashboardModel(
      { ...data, project: { ...data.project, id: "project/with space" } },
      dashboardFinancials(),
      "2026-09-08"
    )
    expect(
      [...model.priorities, ...model.recent].every((item) =>
        item.href.startsWith(
          "/preview/projects/project%2Fwith%20space/sub-vendor/"
        )
      )
    ).toBe(true)
  })
})
