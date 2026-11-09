import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

const SRC = join(process.cwd(), "src")
const LOADER = "src/lib/native/capacitor-plugins.ts"

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

describe("Capacitor plugin loading", () => {
  // A bare import() of a plugin from a client component is compiled into
  // every page's server bundle too (with @capacitor/core inlined each time).
  it("loads plugins only through the browser-only loaders", () => {
    const offenders = sourceFiles(SRC)
      .map((path) => relative(process.cwd(), path))
      .filter((path) => path !== LOADER)
      .filter((path) => {
        const source = readFileSync(path, "utf8")
        // Type-only imports are erased at build time and are fine.
        return (
          /import\(\s*["']@(?:capacitor|capgo)\//.test(source) ||
          /^import (?!type )[^;]*?from\s+["']@(?:capacitor|capgo)\//m.test(source)
        )
      })
    expect(offenders).toEqual([])
  })

  it("rejects instead of importing during server rendering", async () => {
    const plugins = await import("@/lib/native/capacitor-plugins")
    // Vitest runs without a window, like server rendering.
    await expect(plugins.loadPreferencesPlugin()).rejects.toThrow("only in the browser")
  })
})
