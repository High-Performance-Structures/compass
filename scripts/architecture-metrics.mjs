// Measures the code against docs/development/architecture-standards.md.
// Shared by scripts/architecture-baseline.mjs (writes the baseline) and
// src/lib/__tests__/architecture-standard.test.ts (enforces it).
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const SOURCE_DIRS = ["src/app", "src/lib", "src/components", "src/hooks", "src/db"]
const MAX_FILE_LINES = 800

/** The only places these helpers may be defined. */
const SHARED_HELPER_HOMES = new Set([
  "src/lib/format.ts",
  "src/lib/utils.ts",
  "src/lib/shared/guards.ts",
  "src/lib/shared/env.ts",
  "src/lib/shared/text.ts",
])

const LOCAL_HELPER_NAMES = [
  "formatDate",
  "shortDate",
  "money",
  "formatMoney",
  "formatCents",
  "formatCurrency",
  "formatDollars",
  "isRecord",
  "cleanText",
  "envString",
  "environmentString",
  "safeFileName",
  "escapeHtml",
]

const LOCAL_HELPER = new RegExp(
  String.raw`(?:^|\n)\s*(?:export\s+)?(?:async\s+)?(?:function\s+(${LOCAL_HELPER_NAMES.join("|")})\b|const\s+(${LOCAL_HELPER_NAMES.join("|")})\s*=\s*(?:\(|async|function))`,
  "g"
)

function isSource(path) {
  return (
    /\.(ts|tsx)$/.test(path) &&
    !/\.test\.(ts|tsx)$/.test(path) &&
    !/\.generated\.ts$/.test(path) &&
    !/\.d\.ts$/.test(path)
  )
}

function walk(root, dir) {
  const absolute = join(root, dir)
  let entries
  try {
    entries = readdirSync(absolute)
  } catch {
    return []
  }
  return entries.flatMap((entry) => {
    if (entry === "__tests__" || entry === "node_modules") return []
    const path = join(dir, entry)
    if (statSync(join(root, path)).isDirectory()) return walk(root, path)
    return isSource(path) ? [relative(root, join(root, path))] : []
  })
}

function sorted(object) {
  return Object.fromEntries(Object.entries(object).sort(([a], [b]) => a.localeCompare(b)))
}

/** Every ratchet metric, keyed by rule. */
function schemaTables(root, files) {
  const names = new Set()
  // SQL table name -> exported Drizzle table, so raw-SQL writes count too.
  const bySqlName = new Map()
  for (const path of files) {
    if (!/^src\/db\/schema.*\.ts$/.test(path) && path !== "src/lib/sync/schema.ts") continue
    const text = readFileSync(join(root, path), "utf8")
    for (const match of text.matchAll(/export\s+const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*sqliteTable\(\s*["'`]([A-Za-z0-9_]+)["'`]/g)) {
      names.add(match[1])
      bySqlName.set(match[2], match[1])
    }
  }
  return { names, bySqlName }
}

// Uppercase SQL keywords only, followed by a real table name (checked
// against the schema), so prose like "update the project" never matches.
const RAW_SQL_WRITE = /\b(?:INSERT(?:\s+OR\s+[A-Z]+)?\s+INTO|DELETE\s+FROM|UPDATE(?:\s+OR\s+[A-Z]+)?)\s+[`"]?([a-z][a-z0-9_]*)[`"]?/g

export function computeArchitectureMetrics(root) {
  const files = SOURCE_DIRS.flatMap((dir) => walk(root, dir)).sort()
  const { names: tables, bySqlName } = schemaTables(root, files)
  const tableWriters = {}
  const largeFiles = {}
  const localHelpers = {}
  const envCasts = {}
  const libImportsApp = {}
  const actionImportsActions = {}
  const clientPages = {}
  const handRolledContext = {}

  for (const path of files) {
    const text = readFileSync(join(root, path), "utf8")

    // One writer per table: which files insert/update/delete each table.
    const addWriter = (table) => {
      const writers = (tableWriters[table] ??= [])
      if (!writers.includes(path)) writers.push(path)
    }
    for (const match of text.matchAll(/\.(?:insert|update|delete)\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/g)) {
      if (tables.has(match[1])) addWriter(match[1])
    }
    // Migrations and schema files define tables; they are not writers.
    if (!path.startsWith("src/db/")) {
      for (const match of text.matchAll(RAW_SQL_WRITE)) {
        const table = bySqlName.get(match[1])
        if (table) addWriter(table)
      }
    }

    if (path.startsWith("src/app/") || path.startsWith("src/lib/") || path.startsWith("src/components/")) {
      const lines = text.split("\n").length
      if (lines > MAX_FILE_LINES) largeFiles[path] = lines
    }

    if (!SHARED_HELPER_HOMES.has(path)) {
      const count = [...text.matchAll(LOCAL_HELPER)].length
      if (count > 0) localHelpers[path] = count
    }

    const casts = text.match(/as unknown as Record<string,\s*string(?:\s*\|\s*undefined)?>/g)?.length ?? 0
    if (casts > 0) envCasts[path] = casts

    if (path.startsWith("src/lib/")) {
      const imports = text.match(/from\s+["']@\/app\//g)?.length ?? 0
      if (imports > 0) libImportsApp[path] = imports
    }

    if (path.startsWith("src/app/actions/")) {
      const imports = text.match(/from\s+["']@\/app\/actions\//g)?.length ?? 0
      if (imports > 0) actionImportsActions[path] = imports
    }

    if (/(^|\/)page\.tsx$/.test(path) && /^\s*["']use client["']/.test(text)) {
      clientPages[path] = 1
    }

    if (path.startsWith("src/app/actions/") || path.startsWith("src/app/api/")) {
      const count = text.match(/getCloudflareContext\(\)/g)?.length ?? 0
      if (count > 0) handRolledContext[path] = count
    }
  }

  for (const writers of Object.values(tableWriters)) writers.sort()

  return {
    tableWriters: sorted(tableWriters),
    largeFiles: sorted(largeFiles),
    localHelpers: sorted(localHelpers),
    envCasts: sorted(envCasts),
    libImportsApp: sorted(libImportsApp),
    actionImportsActions: sorted(actionImportsActions),
    clientPages: sorted(clientPages),
    handRolledContext: sorted(handRolledContext),
  }
}

export const ARCHITECTURE_RULES = {
  tableWriters: "One writer per table, counting raw SQL as well as Drizzle writes: write through the owning domain module's store.ts (section 1).",
  largeFiles: `Files over ${MAX_FILE_LINES} lines may not grow, and new ones may not exceed it (section 7).`,
  localHelpers: "Use the shared money, date, guard, text and env helpers instead of a local copy (section 4).",
  envCasts: "Read environment values through src/lib/shared/env.ts, not `env as unknown as Record<string, string>` (section 4).",
  libImportsApp: "src/lib must not import from src/app; move the shared logic into src/lib (section 1).",
  actionImportsActions: "Server actions call domain modules, not other server action files (section 1).",
  clientPages: "page.tsx files are server components; load data on the server (section 6).",
  handRolledContext: "Start from the shared action context instead of calling getCloudflareContext() directly (section 2).",
}
