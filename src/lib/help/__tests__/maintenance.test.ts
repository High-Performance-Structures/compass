import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { describe, expect, it } from "vitest"
import { validateHelpRoute } from "../../../../scripts/generate-help-resources.mjs"
import { HELP_GUIDES } from "@/lib/help"
import type { HelpGuide } from "@/lib/help/types"
import {
  auditHelpMaintenance,
  MONITORED_HELP_WORKFLOW_ROUTES,
} from "@/lib/help/maintenance"

const REPOSITORY_ROOT = join(process.cwd())
const APP_ROOT = join(REPOSITORY_ROOT, "src/app")
const SOURCE_ROOT = join(REPOSITORY_ROOT, "src")

function filesBelow(directory: string, filename?: string): readonly string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...filesBelow(path, filename))
    if (entry.isFile() && (!filename || entry.name === filename)) files.push(path)
  }
  return files
}

function applicationRoutes(): readonly string[] {
  return ["dashboard", "preview"].flatMap((root) =>
    filesBelow(join(APP_ROOT, root), "page.tsx").map((path) => {
      const directory = relative(APP_ROOT, dirname(path)).replaceAll("\\", "/")
      return `/${directory}`
    })
  )
}

function contextualTopicIds(): readonly string[] {
  const topicIds = new Set<string>()
  const topicPattern =
    /(?:helpTopicId|topicId)\s*=\s*(?:["']([^"']+)["']|\{([\s\S]*?)\})/g
  const expressionStringPattern = /["']([^"']+)["']/g
  for (const path of filesBelow(SOURCE_ROOT)) {
    if (!/\.(?:ts|tsx)$/.test(path)) continue
    const source = readFileSync(path, "utf8")
    if (!source.includes("ContextualHelp")) continue
    for (const match of source.matchAll(topicPattern)) {
      const literalTopicId = match[1]
      if (literalTopicId) topicIds.add(literalTopicId)
      const expression = match[2]
      if (!expression) continue
      for (const expressionMatch of expression.matchAll(expressionStringPattern)) {
        const expressionTopicId = expressionMatch[1]
        if (expressionTopicId) topicIds.add(expressionTopicId)
      }
    }
  }
  return Array.from(topicIds)
}

describe("help maintenance", () => {
  it("accepts canonical dashboard and preview guide routes", () => {
    expect(validateHelpRoute("/dashboard/projects/[id]/schedule")).toBe(
      "/dashboard/projects/[id]/schedule"
    )
    expect(
      validateHelpRoute(
        "/preview/projects/[id]/owner/updates/[updateId]"
      )
    ).toBe("/preview/projects/[id]/owner/updates/[updateId]")
  })

  it.each([
    "/preview/../package.json",
    "/preview/projects//owner",
    "/preview/projects/[id]/owner/",
    "/preview/projects/[id]/owner?mode=all",
    "/preview-other/projects/[id]",
    "/api/projects/[id]",
  ])("rejects non-canonical or unsupported guide route %s", (route) => {
    expect(() => validateHelpRoute(route)).toThrow()
  })

  it("keeps registered sources, routes, monitored workflows, and beacons valid", () => {
    for (const guide of HELP_GUIDES) {
      expect(existsSync(join(REPOSITORY_ROOT, guide.sourcePath))).toBe(true)
    }

    const topicIds = contextualTopicIds()
    expect(topicIds).toEqual(
      expect.arrayContaining(["offline.prepare", "offline.sync"])
    )

    const issues = auditHelpMaintenance({
      applicationRoutes: applicationRoutes(),
      contextualTopicIds: topicIds,
    })

    expect(issues).toEqual([])
  })

  it("reports stale content and an invalid contextual topic", () => {
    const guide = HELP_GUIDES[0]
    expect(guide).toBeDefined()
    if (!guide) return
    const staleGuide: HelpGuide = { ...guide, lastReviewed: "2025-01-01" }

    const issues = auditHelpMaintenance({
      guides: [staleGuide],
      contextualTopicIds: ["missing.topic"],
      monitoredRoutes: [],
      now: new Date("2026-09-06T00:00:00.000Z"),
      maximumReviewAgeDays: 180,
    })

    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["stale-review", "unknown-context-topic"])
    )
  })

  it("rejects calendar dates that JavaScript would otherwise roll forward", () => {
    const guide = HELP_GUIDES[0]
    expect(guide).toBeDefined()
    if (!guide) return

    const issues = auditHelpMaintenance({
      guides: [{ ...guide, lastReviewed: "2026-02-30" }],
      monitoredRoutes: [],
      now: new Date("2026-09-06T00:00:00.000Z"),
    })

    expect(issues.some((issue) => issue.code === "invalid-review-date")).toBe(
      true
    )
  })

  it("requires every monitored consequential workflow to remain inventoried", () => {
    expect(MONITORED_HELP_WORKFLOW_ROUTES.length).toBeGreaterThanOrEqual(10)
  })
})
