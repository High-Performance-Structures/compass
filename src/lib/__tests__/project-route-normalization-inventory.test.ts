import { describe, expect, it } from "vitest"

import { readSource, sourceFiles } from "@/test/source-tree"

const routeRoots = [
  "src/app/dashboard/projects/[id]",
  "src/app/preview/projects/[id]",
  "src/app/print/projects/[id]",
  "src/app/api/projects/[id]",
  "src/app/api/field/projects/[projectId]",
] as const

function routeFiles(root: string): readonly string[] {
  return sourceFiles(root, { include: /(?:page|route|layout)\.(?:tsx|ts)$/ })
}

describe("project route ID normalization inventory", () => {
  it("normalizes every project page, API, print, and preview boundary", () => {
    const files = routeRoots.flatMap(routeFiles).sort()
    expect(files).toHaveLength(102)

    const missing = files.filter((file) => {
      const source = readSource(file)
      return (
        !source.includes('from "@/lib/project-route-id"') ||
        !(source.includes("decodeProjectRouteId(") ||
          source.includes("resolveProjectRouteId(") ||
          source.includes("requireProjectRouteId("))
      )
    })

    expect(missing).toEqual([])
  })
})
