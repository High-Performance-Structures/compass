import { join, relative } from "node:path"
import { beforeAll, describe, expect, it } from "vitest"

import { preloadSources, readSource, SOURCE_SCAN_TIMEOUT_MS, sourceFiles as sharedSourceFiles } from "@/test/source-tree"

const SRC = join(process.cwd(), "src")
const LOADER = "src/lib/native/capacitor-plugins.ts"

const SOURCE_OPTIONS = { skipDirectories: ["__tests__"], include: /\.(ts|tsx)$/ }

function sourceFiles(directory: string): readonly string[] {
  return sharedSourceFiles(directory, SOURCE_OPTIONS)
}

// Read the tree once for this file, as setup (see @/test/source-tree).
beforeAll(() => preloadSources("src", SOURCE_OPTIONS), SOURCE_SCAN_TIMEOUT_MS)

describe("Capacitor plugin loading", () => {
  // A bare import() of a plugin from a client component is compiled into
  // every page's server bundle too (with @capacitor/core inlined each time).
  it("loads plugins only through the browser-only loaders", () => {
    const offenders = sourceFiles(SRC)
      .map((path) => relative(process.cwd(), path))
      .filter((path) => path !== LOADER)
      .filter((path) => {
        const source = readSource(path)
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
