import { join, relative } from "node:path"
import { beforeAll, describe, expect, it } from "vitest"

import { preloadSources, readSource, SOURCE_SCAN_TIMEOUT_MS, sourceFiles as sharedSourceFiles } from "@/test/source-tree"

const PRODUCT_UI_ROOTS = [
  join(process.cwd(), "src", "app", "dashboard"),
  join(process.cwd(), "src", "components"),
]

const SOURCE_OPTIONS = { include: /\.(?:css|ts|tsx)$/ }

function sourceFiles(root: string): readonly string[] {
  return sharedSourceFiles(root, SOURCE_OPTIONS)
}

// Read the tree once for this file, as setup (see @/test/source-tree).
beforeAll(() => {
  for (const root of PRODUCT_UI_ROOTS) preloadSources(root, SOURCE_OPTIONS)
}, SOURCE_SCAN_TIMEOUT_MS)

describe("product UI theme discipline", () => {
  it("keeps information containers within the global radius scale", () => {
    const violations = PRODUCT_UI_ROOTS.flatMap(sourceFiles).flatMap((path) => {
      const lines = readSource(path).split("\n")
      return lines.flatMap((line, index) =>
        /\brounded-(?:xl|2xl|3xl|4xl)\b/.test(line)
          ? [`${relative(process.cwd(), path)}:${index + 1}`]
          : [],
      )
    })

    expect(violations).toEqual([])
  })
})
