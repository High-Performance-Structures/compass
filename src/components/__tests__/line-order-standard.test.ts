import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

/*
 * Enforces "Line item order" in docs/development/ui-standards.md
 * (owner-approved 2026-11-06): rows inside one record reorder with the one
 * shared control in src/components/ui/sortable-rows.tsx (a slim grip with
 * small up/down arrows beside it). No screen builds its own drag code, and
 * every line editor with an "Add line" button uses it.
 *
 * If this fails, use SortableRows / SortableRow / ReorderHandle instead of
 * adding to an allowlist. Each allowlist entry carries its reason.
 */

const ROOT = process.cwd()
const SHARED_CONTROL = "src/components/ui/sortable-rows.tsx"

/** Line editors whose "Add line" does not add a row to a reorderable list. */
const ADD_LINE_EXCEPTIONS: Readonly<Record<string, string>> = {
  // Adds one estimate item through a form; the items reorder in
  // project-estimate-line-order.tsx, which uses the shared control.
  "src/components/projects/estimate-workspace/estimate-line-editor.tsx": "single-line form",
  // Adds one template line through a form; the lines reorder in
  // estimate-template-line-order.tsx, which uses the shared control.
  "src/components/templates/estimate-template-editor.tsx": "single-line form",
}

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

describe("line order standard", () => {
  it("keeps drag-and-drop code in the shared control", () => {
    const offenders = files
      .filter((file) => file.path !== SHARED_CONTROL && /from "@dnd-kit\//.test(file.text))
      .map((file) => file.path)
    expect(offenders, "Reorder rows with src/components/ui/sortable-rows.tsx.").toEqual([])
  })

  it("gives every line editor with an Add line button the shared reorder control", () => {
    const missing = files
      .filter((file) => file.path.endsWith(".tsx") && />\s*Add (?:line|row|Line Item|Line)\b/.test(file.text))
      .filter((file) => !(file.path in ADD_LINE_EXCEPTIONS))
      .filter((file) => !/\bSortableRows\b/.test(file.text))
      .map((file) => file.path)
    expect(missing, "Wrap the rows in SortableRows with a ReorderHandle in each row's first cell.").toEqual([])
  })

  it("keeps each exception pointing at a real file", () => {
    const paths = new Set(files.map((file) => file.path))
    expect(Object.keys(ADD_LINE_EXCEPTIONS).filter((path) => !paths.has(path))).toEqual([])
  })
})
