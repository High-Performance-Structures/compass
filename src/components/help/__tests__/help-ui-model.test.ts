import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import {
  buildHelpTopicPrompt,
  helpGuidesForPathname,
  searchAllowedHelpGuides,
  type HelpGuidePreview,
} from "@/components/help/help-ui-model"

function guide(input: {
  readonly id: string
  readonly title: string
  readonly searchText: string
  readonly route: string
  readonly sectionText: string
}): HelpGuidePreview {
  return {
    id: input.id,
    slug: input.id,
    title: input.title,
    summary: `${input.title} summary`,
    contextSummary: `${input.title} context`,
    category: "Project Operations",
    tags: [],
    routes: [input.route],
    searchText: input.searchText,
    readingMinutes: 2,
    sections: [
      {
        id: "details",
        topicId: `${input.id}.details`,
        title: "Details",
        summary: "Detailed help",
        searchText: input.sectionText,
      },
    ],
  }
}

describe("Compass Help UI model", () => {
  it("builds a topic-grounded Jarvis request", () => {
    const prompt = buildHelpTopicPrompt({
      topicId: "schedule.critical-path",
      title: "Critical path",
    })

    expect(prompt).toContain("schedule.critical-path")
    expect(prompt).toContain("official Compass Help topic")
    expect(prompt).toContain("page I am currently viewing")
  })

  it("searches only server-approved previews and preserves an exact section link", () => {
    const allowed = guide({
      id: "schedule",
      title: "Schedule",
      searchText: "critical path dependencies",
      route: "/dashboard/projects/[id]/schedule",
      sectionText: "critical path dependencies",
    })

    expect(searchAllowedHelpGuides([allowed], "how do I use critical path")).toEqual([
      expect.objectContaining({
        href: "/dashboard/help/schedule#details",
        guide: expect.objectContaining({ id: "schedule" }),
      }),
    ])
    expect(searchAllowedHelpGuides([], "internal financial workflow")).toEqual([])
  })

  it("suggests an approved dynamic-route guide for the current page", () => {
    const allowed = guide({
      id: "photos",
      title: "Photos",
      searchText: "photo visibility",
      route: "/dashboard/projects/[id]/photos",
      sectionText: "photo visibility",
    })

    expect(
      helpGuidesForPathname([allowed], "/dashboard/projects/project-42/photos"),
    ).toEqual([allowed])
  })

  it("keeps generated help registries out of client help components", () => {
    for (const filename of [
      "help-drawer.tsx",
      "help-resources-library.tsx",
      "contextual-help-beacon.tsx",
    ]) {
      const source = readFileSync(
        join(process.cwd(), "src/components/help", filename),
        "utf8",
      )
      expect(source).not.toContain('from "@/lib/help"')
      expect(source).not.toContain("help-guides.generated")
    }
  })
})
