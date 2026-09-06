import { spawnSync } from "node:child_process"
import { describe, expect, it } from "vitest"

import {
  HELP_GUIDES,
  canAccessHelpGuide,
  getHelpGuide,
  getHelpGuidesForRoute,
  getHelpTopic,
  helpAudienceForRole,
  searchHelpGuides,
} from "@/lib/help"

describe("help registry", () => {
  it("keeps generated data synchronized with canonical Markdown", () => {
    const result = spawnSync(
      "bun",
      ["scripts/generate-help-resources.mjs", "--check"],
      { cwd: process.cwd(), encoding: "utf8" }
    )
    expect(result.stderr).toBe("")
    expect(result.status).toBe(0)
  })

  it("provides the initial canonical guide set with unique stable IDs", () => {
    expect(HELP_GUIDES).toHaveLength(14)
    expect(new Set(HELP_GUIDES.map((guide) => guide.id)).size).toBe(14)
    expect(new Set(HELP_GUIDES.map((guide) => guide.slug)).size).toBe(14)
    expect(HELP_GUIDES.map((guide) => guide.id)).toEqual(
      expect.arrayContaining(["audience.owner", "audience.trade"])
    )

    const topicIds = HELP_GUIDES.flatMap((guide) =>
      guide.sections.map((section) => section.topicId)
    )
    expect(new Set(topicIds).size).toBe(topicIds.length)
    expect(HELP_GUIDES.every((guide) => !guide.content.includes("{#"))).toBe(true)
  })

  it("resolves guide and section topics to stable help URLs", () => {
    expect(getHelpTopic("schedule")?.href).toBe(
      "/dashboard/help/schedules-and-tasks"
    )
    expect(getHelpTopic("schedule.critical-path")?.href).toBe(
      "/dashboard/help/schedules-and-tasks#critical-path"
    )
    expect(getHelpTopic("contacts.access.add-and-invite")?.section?.title).toBe(
      "Add and Invite a Contact"
    )
    expect(getHelpTopic("not-a-topic")).toBeNull()
  })

  it("searches body content and tolerates natural-language stop words", () => {
    const naturalLanguageResults = searchHelpGuides(
      "how do I invite a customer"
    )
    expect(naturalLanguageResults[0]?.guide.id).toBe("contacts.access")

    const bodyResults = searchHelpGuides("delayed responses duplicates")
    expect(bodyResults.some((result) => result.guide.id === "financials")).toBe(
      true
    )
  })

  it("matches concrete paths against dynamic registered routes", () => {
    expect(
      getHelpGuidesForRoute("/dashboard/projects/project-123/schedule").map(
        (guide) => guide.id
      )
    ).toContain("schedule")
    expect(
      getHelpGuidesForRoute(
        "/dashboard/projects/project-123/owner-updates/update-456?preview=1"
      ).map((guide) => guide.id)
    ).toContain("owner.updates")
    expect(
      getHelpGuidesForRoute(
        "/preview/projects/project-123/owner/updates/update-456"
      ).map((guide) => guide.id)
    ).toContain("audience.owner")
    expect(
      getHelpGuidesForRoute(
        "/preview/projects/project-123/sub-vendor/rfqs"
      ).map((guide) => guide.id)
    ).toContain("audience.trade")
  })

  it("keeps portal guidance limited to its intended external audience", () => {
    const ownerGuide = getHelpGuide("owner-workspace")
    const tradePartnerGuide = getHelpGuide("trade-partner-workspace")
    expect(ownerGuide?.audiences).toEqual(["owner"])
    expect(tradePartnerGuide?.audiences).toEqual([
      "subcontractor",
      "supplier",
    ])
    if (!ownerGuide || !tradePartnerGuide) return

    const permissions = ["help:read", "project:read"] as const
    expect(canAccessHelpGuide(ownerGuide, { role: "client", permissions })).toBe(
      true
    )
    expect(
      canAccessHelpGuide(ownerGuide, { role: "supplier", permissions })
    ).toBe(false)
    expect(
      canAccessHelpGuide(tradePartnerGuide, {
        role: "subcontractor",
        permissions,
      })
    ).toBe(true)
    expect(
      canAccessHelpGuide(tradePartnerGuide, { role: "client", permissions })
    ).toBe(false)
  })

  it("gives external audiences a direct Compass support contact", () => {
    const supportAddress = "compasshelp@hps-colorado.com"
    const supportPhone = "719-896-6149"

    for (const slug of [
      "requesting-help",
      "owner-workspace",
      "trade-partner-workspace",
    ]) {
      expect(getHelpGuide(slug)?.content).toContain(supportAddress)
      expect(getHelpGuide(slug)?.content).toContain(supportPhone)
    }
  })

  it("teaches users how to recognize and use contextual Help beacons", () => {
    const supportGuide = getHelpGuide("requesting-help")
    const navigationGuide = getHelpGuide("navigating-projects")

    expect(supportGuide?.content).toContain("compass ring with a question mark")
    expect(supportGuide?.content).toContain("Hover over a beacon")
    expect(supportGuide?.content).toContain("Double-clicking a beacon")
    expect(supportGuide?.content).toContain("Close help")
    expect(navigationGuide?.content).toContain(
      "compass-and-question-mark beacons"
    )
  })

  it("retains canonical audience and resource-permission metadata", () => {
    expect(helpAudienceForRole("client")).toBe("owner")
    expect(helpAudienceForRole("field_superintendent")).toBe("staff")
    expect(helpAudienceForRole("guest")).toBe("guest")

    const ownerWorkspace = getHelpGuide("owner-workspace")
    const selections = getHelpGuide("finish-selections")
    expect(ownerWorkspace).not.toBeNull()
    expect(selections).not.toBeNull()
    if (!ownerWorkspace || !selections) return

    expect(
      canAccessHelpGuide(ownerWorkspace, {
        role: "client",
        permissions: ["help:read", "project:read"],
      })
    ).toBe(true)
    expect(
      canAccessHelpGuide(selections, {
        role: "client",
        permissions: ["help:read", "project:read"],
      })
    ).toBe(false)
    expect(
      canAccessHelpGuide(ownerWorkspace, {
        role: "client",
        permissions: ["help:read"],
      })
    ).toBe(false)
  })
})
