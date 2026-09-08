import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import {
  buildHelpTopicPrompt,
  helpGuidesForPathname,
  helpHrefWithReturnTo,
  helpReturnToForLocation,
  safeHelpReturnTo,
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
    content: `## Details\n\n${input.sectionText}`,
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
    expect(prompt).toContain("Lead with the useful next step")
    expect(prompt).toContain("Write naturally and concisely")
    expect(prompt).not.toContain("Clearly separate official workflow guidance")
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

  it("keeps full-guide navigation reversible without relying on a new tab", () => {
    expect(
      helpHrefWithReturnTo(
        "/dashboard/help/schedule#details",
        "/preview/projects/project-42/sub-vendor",
      ),
    ).toBe(
      "/dashboard/help/schedule?returnTo=%2Fpreview%2Fprojects%2Fproject-42%2Fsub-vendor#details",
    )
    expect(safeHelpReturnTo("/dashboard/projects/project-42/schedule")).toBe(
      "/dashboard/projects/project-42/schedule",
    )
    expect(safeHelpReturnTo("//outside.example")).toBeNull()
    expect(safeHelpReturnTo("/dashboard/help/requesting-help")).toBeNull()
    expect(
      helpReturnToForLocation(
        "/dashboard/projects/project-42",
        "tab=rfis&status=open",
      ),
    ).toBe("/dashboard/projects/project-42?tab=rfis&status=open")
    expect(
      helpReturnToForLocation(
        "/dashboard/help/schedule",
        "returnTo=%2Fdashboard%2Fprojects%2Fproject-42%3Ftab%3Drfis",
      ),
    ).toBe("/dashboard/projects/project-42?tab=rfis")
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

  it("wires server-filtered Help into previews without enabling Jarvis", () => {
    const layoutSource = readFileSync(
      join(process.cwd(), "src/app/preview/layout.tsx"),
      "utf8",
    )
    const controlsSource = readFileSync(
      join(
        process.cwd(),
        "src/components/projects/project-audience-header-controls.tsx",
      ),
      "utf8",
    )

    expect(layoutSource).toContain("getEffectiveHelpGuideAccess(user)")
    expect(layoutSource).toContain("allowedHelpGuideIds.has(guide.id)")
    expect(layoutSource).toContain("<HelpUiProvider")
    expect(layoutSource).toContain("canUseJarvis={false}")
    expect(layoutSource).not.toContain("ChatProvider")
    expect(controlsSource).toContain("<HelpDrawer")
    expect(controlsSource).toContain("useCanViewHelp()")
    const drawerSource = readFileSync(
      join(process.cwd(), "src/components/help/help-drawer.tsx"),
      "utf8",
    )
    expect(drawerSource).toContain("mailto:compasshelp@hps-colorado.com")
    expect(drawerSource).toContain("tel:+17198966149")
  })

  it("keeps full-guide navigation reversible from the active workspace", () => {
    const drawerSource = readFileSync(
      join(process.cwd(), "src/components/help/help-drawer.tsx"),
      "utf8",
    )
    const beaconSource = readFileSync(
      join(process.cwd(), "src/components/help/contextual-help-beacon.tsx"),
      "utf8",
    )
    const closeSource = readFileSync(
      join(process.cwd(), "src/components/help/close-help-button.tsx"),
      "utf8",
    )
    const messageSource = readFileSync(
      join(process.cwd(), "src/components/ai/message.tsx"),
      "utf8",
    )

    expect(drawerSource).toContain("helpHrefWithReturnTo")
    expect(drawerSource).toContain("onClick={() => handleOpenChange(false)}")
    expect(drawerSource).toContain("setSelectedGuide")
    expect(drawerSource).toContain("<DrawerGuideArticle")
    expect(drawerSource).toContain("linkHrefTransform=")
    expect(drawerSource).toContain("{guide.content}")
    expect(drawerSource).toContain("Back to Help topics")
    expect(beaconSource).toContain("helpHrefWithReturnTo")
    expect(beaconSource).toContain("window.location.assign")
    expect(closeSource).toContain("window.close()")
    expect(closeSource).toContain("router.push(returnTo)")
    expect(closeSource).toContain("Close help")
    expect(messageSource).toContain('href?.startsWith("/dashboard/help")')
  })
})
