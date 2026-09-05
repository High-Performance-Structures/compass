import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const routeRoots = [
  "src/app/dashboard/projects/[id]",
  "src/app/preview/projects/[id]",
  "src/app/print/projects/[id]",
  "src/app/api/projects/[id]",
  "src/app/api/field/projects/[projectId]",
] as const

function routeFiles(root: string): readonly string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name)
    if (entry.isDirectory()) return routeFiles(path)
    return /(?:page|route|layout)\.(?:tsx|ts)$/.test(entry.name) ? [path] : []
  })
}

describe("project route ID normalization inventory", () => {
  it("normalizes every project page, API, print, and preview boundary", () => {
    const files = routeRoots.flatMap(routeFiles).sort()
    expect(files).toHaveLength(76)

    const missing = files.filter((file) => {
      const source = readFileSync(file, "utf8")
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
