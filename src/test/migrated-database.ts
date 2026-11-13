/**
 * Test helper: an in-memory SQLite database with production's schema, built
 * by replaying every migration in drizzle/ in order, as CI's schema check and
 * D1 do. Prefer this to hand-written CREATE TABLE fixtures: those drift from
 * production (missing unique indexes, foreign keys, defaults and triggers),
 * so a test can pass against a table that production would reject.
 *
 * Replaying ~300 migrations takes a second or two, so the result is built
 * once per test file (Vitest gives each file its own worker process) and
 * every call returns a fresh, independent copy of it.
 */
import Database from "better-sqlite3"
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

type Sqlite = InstanceType<typeof Database>

const MIGRATION_FILE = /^\d{4}_.*\.sql$/

let scripts: readonly string[] | null = null
let template: Buffer | null = null

/** Each migration's SQL, in order, with drizzle's statement markers removed. */
function migrationScripts(): readonly string[] {
  if (!scripts) {
    const dir = join(process.cwd(), "drizzle")
    scripts = readdirSync(dir)
      .filter((name) => MIGRATION_FILE.test(name))
      .sort()
      .map((name) => readFileSync(join(dir, name), "utf8").replaceAll("--> statement-breakpoint", ""))
  }
  return scripts
}

/** Replays every migration through `exec` (for SQLite drivers other than better-sqlite3). */
export function applyMigrations(exec: (sql: string) => void): void {
  for (const script of migrationScripts()) exec(script)
}

function migratedTemplate(): Buffer {
  if (!template) {
    const built = new Database(":memory:")
    applyMigrations((sql) => built.exec(sql))
    template = built.serialize()
    built.close()
  }
  return template
}

/** A fresh better-sqlite3 database with every migration applied. */
export function migratedDatabase(): Sqlite {
  // A database opened from a buffer is a private copy; writes never reach the template.
  return new Database(migratedTemplate())
}

let fileDirectory: string | null = null
let templateFile: string | null = null
let fileCount = 0

/**
 * The path of a fresh database file with every migration applied, for
 * drivers that cannot open a serialized buffer (node:sqlite). Each call
 * copies the template file; the copies are removed when the worker exits.
 */
export function migratedDatabaseFile(): string {
  if (!fileDirectory || !templateFile) {
    const directory = mkdtempSync(join(tmpdir(), "compass-migrated-"))
    process.once("exit", () => rmSync(directory, { recursive: true, force: true }))
    templateFile = join(directory, "template.db")
    writeFileSync(templateFile, migratedTemplate())
    fileDirectory = directory
  }
  fileCount += 1
  const path = join(fileDirectory, `copy-${fileCount}.db`)
  copyFileSync(templateFile, path)
  return path
}

let placeholderCount = 0

/** What insertRow needs from a driver: better-sqlite3 and node:sqlite both fit. */
type RowWriter = {
  readonly prepare: (sql: string) => {
    readonly all: (...values: never[]) => readonly unknown[]
    readonly run: (...values: (string | number | null)[]) => unknown
  }
}

type ColumnInfo = { readonly name: string; readonly type: string; readonly notnull: number; readonly dflt_value: unknown }

function isColumnInfo(value: unknown): value is ColumnInfo {
  return typeof value === "object" && value !== null && "name" in value && "type" in value && "notnull" in value
}

/**
 * Columns whose value carries meaning (a role, a status, a type or kind, an
 * is_* flag). insertRow never invents these: a placeholder would quietly put
 * a row into a state no test chose. Name them in the test.
 */
const MEANINGFUL_COLUMN = /^(?:role|status|type|kind|is_.+)$|_(?:role|status|type|kind)$/

/**
 * Inserts one row, filling every other required column the test did not name
 * (NOT NULL without a default) with a placeholder: a unique
 * `<table>.<column>.<n>` for text (so unique indexes never collide), 0 for
 * numbers. Tests name only the columns they care about, and the row still
 * passes production's NOT NULL rules, unique indexes, foreign keys and
 * triggers. Throws when a required meaningful column (see above) or a column
 * of an unexpected type is left out.
 */
export function insertRow(
  sqlite: RowWriter,
  table: string,
  values: Readonly<Record<string, string | number | null>>,
): void {
  const filled: Record<string, string | number | null> = {}
  for (const column of sqlite.prepare(`PRAGMA table_info("${table}")`).all()) {
    if (!isColumnInfo(column)) continue
    if (column.name in values || !column.notnull || column.dflt_value !== null) continue
    if (MEANINGFUL_COLUMN.test(column.name)) {
      throw new Error(`insertRow: set ${table}.${column.name} yourself; it is required and carries meaning`)
    }
    placeholderCount += 1
    if (/^(?:INTEGER|INT|REAL|NUMERIC)$/i.test(column.type)) filled[column.name] = 0
    else if (/^TEXT$/i.test(column.type)) filled[column.name] = `${table}.${column.name}.${placeholderCount}`
    else throw new Error(`insertRow: set ${table}.${column.name} yourself; no placeholder for type ${column.type || "(none)"}`)
  }
  const row = { ...filled, ...values }
  const names = Object.keys(row)
  if (names.length === 0) throw new Error(`insertRow: no columns for ${table}`)
  sqlite
    .prepare(`INSERT INTO "${table}" (${names.map((name) => `"${name}"`).join(", ")}) VALUES (${names.map(() => "?").join(", ")})`)
    .run(...names.map((name) => row[name]))
}
