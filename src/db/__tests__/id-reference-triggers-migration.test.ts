import Database from "better-sqlite3"
import { randomUUID } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { ID_REFERENCE_TRIGGERS, idReferenceKey, type IdReferenceTrigger } from "../id-integrity"

/*
 * Replays every migration, then checks each 0281 validation trigger on a
 * real copy of its table: a missing parent aborts, a real parent passes,
 * NULL passes, and a row whose parent was deleted later can still be
 * updated as long as the update does not set the guarded column again.
 */

type Sqlite = InstanceType<typeof Database>

const MIGRATIONS_DIR = resolve(process.cwd(), "drizzle")

function replay(): Sqlite {
  const sqlite = new Database(":memory:")
  for (const file of readdirSync(MIGRATIONS_DIR).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort()) {
    sqlite.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8").replaceAll("--> statement-breakpoint", ""))
  }
  // Isolate the 0281 triggers: no foreign keys or CHECKs on the filler rows.
  sqlite.pragma("foreign_keys = OFF")
  sqlite.pragma("ignore_check_constraints = ON")
  return sqlite
}

type ColumnInfo = { readonly name: string; readonly type: string; readonly notnull: number; readonly dflt_value: unknown; readonly pk: number }

function isColumnInfo(value: unknown): value is ColumnInfo {
  return typeof value === "object" && value !== null && "name" in value && "type" in value && "notnull" in value
}

function columns(sqlite: Sqlite, table: string): readonly ColumnInfo[] {
  return sqlite.prepare(`PRAGMA table_info("${table}")`).all().filter(isColumnInfo)
}

function triggerFor(table: string, column: string): IdReferenceTrigger | undefined {
  return ID_REFERENCE_TRIGGERS.find((entry) => entry.table === table && entry.column === column)
}

/** Inserts a row with every required column filled; returns its id. */
function insertRow(sqlite: Sqlite, table: string, overrides: Readonly<Record<string, unknown>> = {}): string {
  const id = randomUUID()
  const values: Record<string, unknown> = {}
  for (const column of columns(sqlite, table)) {
    if (column.name in overrides) {
      values[column.name] = overrides[column.name]
      continue
    }
    if (column.name === "id") {
      values.id = id
      continue
    }
    if (column.notnull === 0 || column.dflt_value !== null) continue
    const guarded = triggerFor(table, column.name)
    if (guarded) {
      values[column.name] = guarded.parent === table ? id : insertRow(sqlite, guarded.parent)
      continue
    }
    values[column.name] = /INT|REAL|NUM/i.test(column.type) ? 0 : randomUUID()
  }
  const names = Object.keys(values)
  sqlite
    .prepare(`INSERT INTO "${table}" (${names.map((name) => `"${name}"`).join(", ")}) VALUES (${names.map(() => "?").join(", ")})`)
    .run(...names.map((name) => values[name]))
  return id
}

/** Tables whose own triggers forbid every UPDATE (insert-only audit rows). */
const IMMUTABLE_TABLES: ReadonlySet<string> = new Set(["contact_account_link_events"])

function rowKey(sqlite: Sqlite, table: string): string {
  return columns(sqlite, table).some((column) => column.name === "id") ? "id" : "rowid"
}

describe("0281 id reference triggers", () => {
  let sqlite: Sqlite

  beforeAll(() => {
    sqlite = replay()
  }, 60_000)

  afterAll(() => sqlite.close())

  it.each(ID_REFERENCE_TRIGGERS.map((entry) => [idReferenceKey(entry), entry] as const))(
    "%s rejects a missing parent and accepts a real one",
    (_key, entry) => {
      const message = `${entry.table}.${entry.column} must reference an existing ${entry.parent}`
      const scope = entry.onlyWhen ? { audience_scope: "user" } : {}
      expect(() => insertRow(sqlite, entry.table, { ...scope, [entry.column]: "missing-parent" })).toThrow(message)

      const parentId = insertRow(sqlite, entry.parent)
      const childId = insertRow(sqlite, entry.table, { ...scope, [entry.column]: parentId })
      const nullable = columns(sqlite, entry.table).find((column) => column.name === entry.column)?.notnull === 0
      if (nullable) {
        expect(() => insertRow(sqlite, entry.table, { ...scope, [entry.column]: null })).not.toThrow()
      }
      if (IMMUTABLE_TABLES.has(entry.table)) return

      const key = rowKey(sqlite, entry.table)
      const where = key === "id" ? `id = '${childId}'` : `"${entry.column}" = '${parentId}'`
      expect(() => sqlite.prepare(`UPDATE "${entry.table}" SET "${entry.column}" = 'missing-parent' WHERE ${where}`).run()).toThrow(message)

      // A parent deleted later leaves an orphan the trigger never sees ...
      sqlite.prepare(`DELETE FROM "${entry.parent}" WHERE id = ?`).run(parentId)
      const other = columns(sqlite, entry.table).find(
        (column) => column.name !== entry.column && column.name !== "id" && column.pk === 0 && !triggerFor(entry.table, column.name),
      )
      if (other && key === "id") {
        expect(() => sqlite.prepare(`UPDATE "${entry.table}" SET "${other.name}" = "${other.name}" WHERE id = ?`).run(childId)).not.toThrow()
        // ... but re-setting the guarded column to the same orphaned value aborts.
        expect(() =>
          sqlite.prepare(`UPDATE "${entry.table}" SET "${entry.column}" = "${entry.column}" WHERE id = ?`).run(childId),
        ).toThrow(message)
      }
    },
  )

  it("checks cherish pulse audiences only for user-scoped responses", () => {
    expect(() =>
      insertRow(sqlite, "cherish_pulse_responses", { audience_scope: "team", audience_reference_id: "not-a-user" }),
    ).not.toThrow()
  })

  it("keeps 0281 additive", () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, "0281_id_reference_triggers.sql"), "utf8")
    const statements = sql
      .split("--> statement-breakpoint")
      .map((statement) => statement.replace(/^\s*--.*$/gm, "").trim())
      .filter((statement) => statement !== "")
    expect(statements.filter((statement) => statement.startsWith("CREATE TRIGGER")).length).toBe(ID_REFERENCE_TRIGGERS.length * 2)
    expect(
      statements.filter(
        (statement) =>
          !/^CREATE INDEX IF NOT EXISTS `\w+` ON `\w+` \(`\w+`\);$/.test(statement) &&
          !/^CREATE TRIGGER IF NOT EXISTS `\w+`\nBEFORE (INSERT|UPDATE OF `\w+`) ON `\w+`\nWHEN [^;]+\nBEGIN\n {2}SELECT RAISE\(ABORT, '[^']+'\);\nEND;$/.test(statement),
      ),
    ).toEqual([])
    expect(() => sqlite.exec(sql.replaceAll("--> statement-breakpoint", ""))).not.toThrow()
  })
})
