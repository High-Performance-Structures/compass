import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

const PRODUCT_UI_ROOTS = [
  join(process.cwd(), "src", "app", "dashboard"),
  join(process.cwd(), "src", "components"),
]

function sourceFiles(root: string): readonly string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(?:css|ts|tsx)$/.test(entry.name) ? [path] : []
  })
}

describe("product UI theme discipline", () => {
  it("keeps information containers within the global radius scale", () => {
    const violations = PRODUCT_UI_ROOTS.flatMap(sourceFiles).flatMap((path) => {
      const lines = readFileSync(path, "utf8").split("\n")
      return lines.flatMap((line, index) =>
        /\brounded-(?:xl|2xl|3xl|4xl)\b/.test(line)
          ? [`${relative(process.cwd(), path)}:${index + 1}`]
          : [],
      )
    })

    expect(violations).toEqual([])
  })
})
