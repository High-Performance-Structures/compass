import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

import { LIST_SHEETS } from "@/lib/domain/settings/list-sheet-registry"

/*
 * ui-standards.md "Record lists": every sheet on the shared record table
 * registers a sheetId, so its columns follow company and personal settings.
 */

const ROOT = process.cwd()
const HOOK_HOMES = new Set(["src/components/record-table.tsx", "src/components/use-server-record-table.ts"])

function sourceFiles(dir: string): readonly string[] {
  return readdirSync(dir).flatMap((entry) => {
    if (entry === "__tests__" || entry === "node_modules") return []
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(entry) ? [path] : []
  })
}

const files = [...sourceFiles(join(ROOT, "src/components")), ...sourceFiles(join(ROOT, "src/app"))]
  .map((path) => ({ path: relative(ROOT, path), text: readFileSync(path, "utf8") }))
  .filter((file) => !HOOK_HOMES.has(file.path))

describe("list sheet standard", () => {
  it("passes a sheetId to every shared record table", () => {
    const missing = files.flatMap((file) => {
      const calls = file.text.match(/\buse(?:Server)?RecordTable\(/g)?.length ?? 0
      const sheets = file.text.match(/\bsheetId:/g)?.length ?? 0
      return calls > sheets ? [`${file.path}: ${calls} table(s), ${sheets} sheetId(s)`] : []
    })
    expect(missing, "Register the sheet in src/lib/domain/settings/list-sheet-registry.ts and pass its sheetId.").toEqual([])
  })

  it("uses only registered sheet ids", () => {
    const registered = new Set(LIST_SHEETS.map((sheet) => sheet.id))
    const unknown = files.flatMap((file) =>
      [...file.text.matchAll(/\bsheetId:\s*([^\n,}]+)/g)].flatMap((match) =>
        // Literals compared against (`audience === "staff" ? ...`) are not sheet ids.
        [...(match[1] ?? "").matchAll(/"([^"]*)"/g)]
          .filter((literal) => !/[=!]==\s*$/.test((match[1] ?? "").slice(0, literal.index)))
          .map((literal) => literal[1] ?? "")
          .filter((id) => !registered.has(id))
          .map((id) => `${file.path}: ${id}`),
      ),
    )
    expect(unknown).toEqual([])
  })
})
