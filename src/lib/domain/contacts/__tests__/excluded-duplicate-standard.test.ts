import path from "node:path"

import { beforeAll, describe, expect, it } from "vitest"

import { preloadSources, readSource, SOURCE_SCAN_TIMEOUT_MS, sourceFiles } from "@/test/source-tree"

/*
 * A vendor is never marked a duplicate without naming the vendor that
 * survives it: duplicates go through the merge (contact-duplicates.ts), which
 * sets the survivor pointer, moves every reference and carries contact
 * details. Older rows still marked excluded_duplicate may only be read, as the
 * merge's source; no code may write that status again.
 */

const ROOT = process.cwd()
const ALLOWED = new Set([
  // Accepts an old excluded duplicate as the record to archive into its survivor.
  "src/app/actions/contact-duplicates.ts",
])

const SCAN = { skipDirectories: ["__tests__", "node_modules"], include: /^(?!.*\.test\.).*\.(ts|tsx|mjs|js|sql)$/ }

function files(directory: string): readonly string[] {
  return sourceFiles(directory, SCAN)
}

// Read both trees once for this file, as setup (see @/test/source-tree).
beforeAll(() => {
  for (const dir of ["src", "scripts"]) preloadSources(dir, SCAN)
}, SOURCE_SCAN_TIMEOUT_MS)

describe("excluded duplicates need a survivor", () => {
  it("no code outside the merge names the excluded_duplicate status", () => {
    const offenders = [...files("src"), ...files("scripts")]
      .filter((file) => !ALLOWED.has(file) && readSource(path.join(ROOT, file)).includes("excluded_duplicate"))
    expect(offenders).toEqual([])
  })
})
