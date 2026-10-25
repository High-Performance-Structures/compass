import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

// docs/development/ui-standards.md "Staff dashboard priorities": the map and
// pipelines stay high on the dashboard, right after CHERISH stories and the
// counts strip, with nothing placed between them.
const source = readFileSync(
  resolve(process.cwd(), "src/components/dashboard/dashboard-launchpad.tsx"),
  "utf8"
)

function position(tag: string): number {
  const index = source.indexOf(`<${tag}`)
  expect(index, `${tag} is rendered on the dashboard`).toBeGreaterThan(-1)
  return index
}

describe("staff dashboard priorities", () => {
  it("shows CHERISH stories, the counts strip, then the map and pipelines, with nothing between", () => {
    const cherish = position("CherishStoryInvitation")
    const counts = position("DashboardCountsStrip")
    const portfolio = position("PortfolioSection")
    expect(cherish).toBeLessThan(counts)
    expect(counts).toBeLessThan(portfolio)

    const between = source
      .slice(source.indexOf(">", counts) + 1, portfolio)
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .trim()
    expect(between).toBe("")
  })

  it("keeps Today's plan, office priorities and the horizon below the map", () => {
    const portfolio = position("PortfolioSection")
    for (const tag of ["TodaysPlanCard", "OfficeTaskList", "Horizon\n", "QuickDock"]) {
      const index = source.indexOf(`<${tag}`)
      expect(index, `${tag.trim()} is rendered`).toBeGreaterThan(-1)
      expect(index, `${tag.trim()} comes after the map`).toBeGreaterThan(portfolio)
    }
  })
})
