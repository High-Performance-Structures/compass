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
    expect(HELP_GUIDES).toHaveLength(12)
    expect(new Set(HELP_GUIDES.map((guide) => guide.id)).size).toBe(12)
    expect(new Set(HELP_GUIDES.map((guide) => guide.slug)).size).toBe(12)

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
  })

  it("retains canonical audience and resource-permission metadata", () => {
    expect(helpAudienceForRole("client")).toBe("owner")
    expect(helpAudienceForRole("field_superintendent")).toBe("staff")
    expect(helpAudienceForRole("guest")).toBe("guest")

    const selections = getHelpGuide("finish-selections")
    expect(selections).not.toBeNull()
    if (!selections) return

    expect(
      canAccessHelpGuide(selections, {
        role: "client",
        permissions: ["help:read", "project:read"],
      })
    ).toBe(true)
    expect(
      canAccessHelpGuide(selections, {
        role: "supplier",
        permissions: ["help:read", "project:read"],
      })
    ).toBe(false)
    expect(
      canAccessHelpGuide(selections, {
        role: "client",
        permissions: ["help:read"],
      })
    ).toBe(false)
  })
})
import { spawnSync } from "node:child_process"
