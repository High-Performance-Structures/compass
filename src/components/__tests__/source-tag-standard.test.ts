import { existsSync } from "node:fs"
import { join, relative } from "node:path"
import { beforeAll, describe, expect, it } from "vitest"

import { preloadSources, readSource, SOURCE_SCAN_TIMEOUT_MS, sourceFiles as sharedSourceFiles } from "@/test/source-tree"

/*
 * Enforces the imported-record source tag standard in
 * docs/development/ui-standards.md (owner-approved 2026-11-01): a record that
 * came from Buildertrend shows only the small muted "[BT]" from
 * <SourceTag source="buildertrend" /> (src/components/shared/source-tag.tsx).
 * Long labels such as "Imported from Buildertrend" or "Not verified from
 * Buildertrend" never appear on record displays.
 *
 * If this fails, render <SourceTag /> instead of adding to the allowlist. The
 * allowlist is only for import tools and instructions (features, not record
 * provenance); every entry carries its reason and how many matches it may hold.
 */

const ROOT = process.cwd()
const DIRS = ["src/components", "src/app"] as const

// "from buildertrend" as words, not SQL like "FROM buildertrend_records".
const LONG_SOURCE_LABEL = /(?:imported from|from) buildertrend(?![_\w])/gi

const SOURCE_OPTIONS = { skipDirectories: ["__tests__", "node_modules"], include: /^(?!.*\.test\.tsx?$).*\.(ts|tsx)$/ }

function sourceFiles(dir: string): readonly string[] {
  if (!existsSync(join(ROOT, dir))) return []
  return sharedSourceFiles(dir, SOURCE_OPTIONS)
}

// Read the tree once for this file, as setup (see @/test/source-tree).
beforeAll(() => {
  for (const dir of DIRS) if (existsSync(join(ROOT, dir))) preloadSources(dir, SOURCE_OPTIONS)
}, SOURCE_SCAN_TIMEOUT_MS)

const FILES = DIRS.flatMap((dir) => sourceFiles(dir)).map((path) => relative(ROOT, join(ROOT, path)))

type Allowed = { readonly count: number; readonly reason: string }

const LONG_LABEL_ALLOWLIST: Readonly<Record<string, Allowed>> = {
  "src/components/projects/project-estimate-buildertrend-import.tsx": {
    count: 1,
    reason: "import tool instruction: tells staff to export the estimate from Buildertrend as a spreadsheet",
  },
}

// Comments describe code, they are not user-facing text.
function isCommentLine(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")
}

function longLabelCount(path: string): number {
  return readSource(join(ROOT, path))
    .split("\n")
    .filter((line) => !isCommentLine(line))
    .reduce((sum, line) => sum + (line.match(LONG_SOURCE_LABEL) ?? []).length, 0)
}

describe("imported-record source tag standard", () => {
  it("uses <SourceTag /> instead of long Buildertrend provenance labels", () => {
    const offenders = FILES.flatMap((path) => {
      const count = longLabelCount(path)
      const allowed = LONG_LABEL_ALLOWLIST[path]?.count ?? 0
      return count > allowed ? [`${path} (${count} long label(s), ${allowed} allowed)`] : []
    })
    expect(
      offenders,
      'Show <SourceTag source="buildertrend" /> from @/components/shared/source-tag (docs/development/ui-standards.md).'
    ).toEqual([])
  })

  it("gives every allowlisted file a written reason", () => {
    const missing = Object.entries(LONG_LABEL_ALLOWLIST)
      .filter(([, entry]) => entry.reason.trim().length < 10)
      .map(([path]) => path)
    expect(missing).toEqual([])
  })

  it("keeps the allowlist current", () => {
    const stale = Object.entries(LONG_LABEL_ALLOWLIST)
      .filter(([path, entry]) => existsSync(join(ROOT, path)) && longLabelCount(path) < entry.count)
      .map(([path]) => path)
    expect(stale, "Lower or remove allowlist entries that no longer need them.").toEqual([])
  })
})
