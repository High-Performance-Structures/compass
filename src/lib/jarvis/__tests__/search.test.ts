import { describe, expect, it } from "vitest"

import {
  canSearchCompassRole,
  currentProjectIdFromPath,
  dailyLogHref,
  feedbackRequestHref,
  jarvisSearchTerms,
  ownerUpdateHref,
  projectIdsForJarvisSearch,
  projectSectionHref,
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
  })

  it("narrows explicit record-type requests", () => {
    expect(requestedJarvisSearchKinds("Show the open RFIs")).toEqual(["rfi"])
    expect(requestedJarvisSearchKinds("Latest owner update")).toEqual([
      "owner_update",
    ])
    expect(requestedJarvisSearchKinds("Find yesterday's daily log")).toEqual([
      "daily_log",
    ])
    expect(
      requestedJarvisSearchKinds("Has my schedule bug report been implemented?")
    ).toEqual(["feedback_request"])
    expect(
      requestedJarvisSearchKinds("Verify the status of my feedback request")
    ).toEqual(["feedback_request"])
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
  })
})
