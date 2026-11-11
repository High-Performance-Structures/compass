import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

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

function files(directory: string): string[] {
  return fs.readdirSync(path.join(ROOT, directory), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(directory, entry.name)
    if (entry.isDirectory()) return entry.name === "__tests__" || entry.name === "node_modules" ? [] : files(relative)
    return /\.(ts|tsx|mjs|js|sql)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [relative] : []
  })
}

describe("excluded duplicates need a survivor", () => {
  it("no code outside the merge names the excluded_duplicate status", () => {
    const offenders = [...files("src"), ...files("scripts")]
      .filter((file) => !ALLOWED.has(file) && fs.readFileSync(path.join(ROOT, file), "utf8").includes("excluded_duplicate"))
    expect(offenders).toEqual([])
  })
})
