import { describe, expect, it } from "vitest"

import {
  canSearchCompassRole,
  calendarEventHref,
  currentProjectIdFromPath,
  dailyLogHref,
  estimateHref,
  feedbackRequestHref,
  isProjectScopedJarvisCalendarSearch,
  jarvisSearchQueryForConversation,
  jarvisSearchTerms,
  ownerUpdateHref,
  projectIdsForJarvisCalendarSearch,
  projectIdsForJarvisProjectSearch,
  projectIdsForJarvisSearch,
  projectSectionHref,
  requestedCalendarDate,
  requestedProjectStatus,
  requestedJarvisSearchKinds,
  rfiHref,
  type JarvisSearchProject,
} from "@/lib/jarvis/search"

const projects: readonly JarvisSearchProject[] = [
  {
    id: "proj-loomis",
    name: "Loomis",
    projectNumber: "O-170",
    clientName: "Loomis Family",
  },
  {
    id: "proj-loeffler",
    name: "Loeffler",
    projectNumber: "O-202",
    clientName: "Loeffler Family",
  },
]

describe("Jarvis Compass search", () => {
  it("allows staff roles but never guest or client roles", () => {
    expect(canSearchCompassRole("admin")).toBe(true)
    expect(canSearchCompassRole("office")).toBe(true)
    expect(canSearchCompassRole("field")).toBe(true)
    expect(canSearchCompassRole("project_manager")).toBe(true)
    expect(canSearchCompassRole("project_administrator")).toBe(true)
    expect(canSearchCompassRole("field_crew")).toBe(true)
    expect(canSearchCompassRole("guest")).toBe(false)
    expect(canSearchCompassRole("client")).toBe(false)
    expect(canSearchCompassRole("developer")).toBe(false)
  })

  it("derives a project only from a project dashboard path", () => {
    expect(
      currentProjectIdFromPath("/dashboard/projects/proj-loomis/daily-logs")
    ).toBe("proj-loomis")
    expect(currentProjectIdFromPath("/dashboard/projects")).toBeNull()
    expect(currentProjectIdFromPath("/dashboard")).toBeNull()
  })

  it("prefers a project explicitly named in the question", () => {
    expect(
      projectIdsForJarvisSearch(
        projects,
        "What are the latest Loomis updates?",
        "proj-loeffler"
      )
    ).toEqual(["proj-loomis"])
    expect(
      projectIdsForJarvisSearch(projects, "What happened today?", "proj-loeffler")
    ).toEqual(["proj-loeffler"])
    expect(
      projectIdsForJarvisSearch(projects, "What happened today?", null),
    ).toEqual(["proj-loomis", "proj-loeffler"])
  })

  it("narrows calendar searches only when the question names a project", () => {
    expect(
      projectIdsForJarvisCalendarSearch(
        projects,
        "What is on my calendar today?",
        "proj-loeffler",
      ),
    ).toEqual(["proj-loomis", "proj-loeffler"])
    expect(
      projectIdsForJarvisCalendarSearch(
        projects,
        "What meetings are on the Loomis project today?",
        "proj-loeffler",
      ),
    ).toEqual(["proj-loomis"])
    expect(
      projectIdsForJarvisCalendarSearch(
        projects,
        "What meetings are on this project today?",
        "proj-loeffler",
      ),
    ).toEqual(["proj-loeffler"])
    expect(
      isProjectScopedJarvisCalendarSearch(
        projects,
        "What is on my calendar today?",
        "proj-loeffler",
      ),
    ).toBe(false)
    expect(
      isProjectScopedJarvisCalendarSearch(
        projects,
        "What meetings are on the Loomis project today?",
        "proj-loeffler",
      ),
    ).toBe(true)
  })

  it("keeps broad project lists independent from the current page", () => {
    expect(
      projectIdsForJarvisProjectSearch(
        projects,
        "List all active projects",
        "proj-loeffler",
      ),
    ).toEqual(["proj-loomis", "proj-loeffler"])
    expect(
      projectIdsForJarvisProjectSearch(
        projects,
        "Find the Loomis project",
        "proj-loeffler",
      ),
    ).toEqual(["proj-loomis"])
    expect(
      projectIdsForJarvisProjectSearch(
        projects,
        "Show this project",
        "proj-loeffler",
      ),
    ).toEqual(["proj-loeffler"])
  })

  it("removes generic words while retaining project identifiers", () => {
    expect(jarvisSearchTerms("Please show updates for O-202 Loeffler")).toEqual([
      "o-202",
      "loeffler",
    ])
    expect(
      jarvisSearchTerms(
        "I think you can now provide some links to locations in Compass now."
      )
    ).toEqual([])
    expect(
      jarvisSearchTerms(
        "Do you have any updates on the status of my requests through Compass?"
      )
    ).toEqual([])
  })

  it("narrows explicit record-type requests", () => {
    expect(requestedJarvisSearchKinds("List all active projects")).toEqual([
      "project",
    ])
    expect(
      requestedJarvisSearchKinds("Give me the estimate for the Loomis customer"),
    ).toEqual(["estimate"])
    expect(
      requestedJarvisSearchKinds("What is on my calendar today?"),
    ).toEqual(["calendar_event"])
    expect(requestedJarvisSearchKinds("Show the open RFIs")).toEqual(["rfi"])
    expect(
      requestedJarvisSearchKinds("Show the open RFIs for the Loomis project"),
    ).toEqual(["rfi"])
    expect(requestedJarvisSearchKinds("Latest owner update")).toEqual([
      "owner_update",
    ])
    expect(
      requestedJarvisSearchKinds("Latest owner update for this project"),
    ).toEqual(["owner_update"])
    expect(requestedJarvisSearchKinds("Find yesterday's daily log")).toEqual([
      "daily_log",
    ])
    expect(
      requestedJarvisSearchKinds("Has my schedule bug report been implemented?")
    ).toEqual(["feedback_request"])
    expect(
      requestedJarvisSearchKinds("Verify the status of my feedback request")
    ).toEqual(["feedback_request"])
    expect(
      requestedJarvisSearchKinds(
        "Do you have any updates on the status of my requests through Compass?"
      )
    ).toEqual(["feedback_request"])
  })

  it("keeps verified request-status scope for an immediate retry", () => {
    expect(
      jarvisSearchQueryForConversation([
        "Do you have any updates on the status of my requests through Compass?",
        "Check again please.",
      ])
    ).toBe(
      "Do you have any updates on the status of my requests through Compass?"
    )
    expect(
      jarvisSearchQueryForConversation([
        "Show the open Loomis RFIs.",
        "Check again please.",
      ])
    ).toBe("Show the open Loomis RFIs.")
  })

  it("derives project status buckets and calendar dates", () => {
    expect(requestedProjectStatus("List all active projects")).toBe("active")
    expect(requestedProjectStatus("Show warranty projects")).toBe("warranty")
    expect(requestedProjectStatus("Find the Loomis project")).toBeNull()
    expect(
      requestedCalendarDate(
        "What is on my calendar today?",
        "America/Denver",
        new Date("2026-09-08T18:00:00.000Z"),
      ),
    ).toBe("2026-09-08")
    expect(
      requestedCalendarDate(
        "What is on my calendar tomorrow?",
        "America/Denver",
        new Date("2026-09-08T18:00:00.000Z"),
      ),
    ).toBe("2026-09-09")
    expect(
      requestedCalendarDate(
        "What was on my calendar yesterday?",
        "America/Denver",
        new Date("2026-09-08T18:00:00.000Z"),
      ),
    ).toBe("2026-09-07")
    expect(
      requestedCalendarDate(
        "Show meetings on 2026-09-10",
        "America/Denver",
        new Date("2026-09-08T18:00:00.000Z"),
      ),
    ).toBe("2026-09-10")
    expect(
      requestedCalendarDate(
        "Show meetings next Friday",
        "America/Denver",
        new Date("2026-09-08T18:00:00.000Z"),
      ),
    ).toBeNull()
  })

  it("builds encoded live Compass links", () => {
    expect(projectSectionHref("proj one", "daily-logs")).toBe(
      "/dashboard/projects/proj%20one/daily-logs"
    )
    expect(ownerUpdateHref("proj one", "update one")).toBe(
      "/dashboard/projects/proj%20one/owner-updates/update%20one"
    )
    expect(dailyLogHref("proj one", "log one")).toBe(
      "/dashboard/projects/proj%20one/daily-logs#daily-log-log%20one"
    )
    expect(rfiHref("proj one", "rfi one")).toBe(
      "/dashboard/projects/proj%20one/rfis?status=all#rfi-rfi%20one"
    )
    expect(feedbackRequestHref("request one")).toBe(
      "/dashboard/requests/request%20one"
    )
    expect(estimateHref("proj one", "estimate one")).toBe(
      "/dashboard/projects/proj%20one/estimate?estimateId=estimate%20one",
    )
    expect(calendarEventHref("event one")).toBe(
      "/dashboard/schedule?kind=event&item=event%20one#work-calendar-event%20one",
    )
  })
})
