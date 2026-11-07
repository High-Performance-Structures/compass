import Database from "better-sqlite3"
import { randomUUID } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  saveOrganizationListSheetSetting,
  saveUserListSheetColumnPreference,
} from "@/lib/domain/settings/store"
import type { Db } from "@/lib/server/action-context"

/*
 * Replays every migration, as CI and wrangler do, then checks the 0295 list
 * sheet tables: one row per (organization, sheet) and (user, organization,
 * sheet), organization-scoped upserts, cascades, and the sort direction check.
 */

type Sqlite = InstanceType<typeof Database>

const MIGRATIONS_DIR = resolve(process.cwd(), "drizzle")

function replay(): Sqlite {
  const sqlite = new Database(":memory:")
  for (const file of readdirSync(MIGRATIONS_DIR).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort()) {
    sqlite.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8").replaceAll("--> statement-breakpoint", ""))
  }
  return sqlite
}

type ColumnInfo = { readonly name: string; readonly type: string; readonly notnull: number; readonly dflt_value: unknown }

function isColumnInfo(value: unknown): value is ColumnInfo {
  return typeof value === "object" && value !== null && "name" in value && "type" in value && "notnull" in value
}

/** A parent row with every required column filled, with foreign keys off for the filler. */
function insertParent(sqlite: Sqlite, table: "organizations" | "users"): string {
  const id = randomUUID()
  const values: Record<string, unknown> = { id }
  for (const column of sqlite.prepare(`PRAGMA table_info("${table}")`).all().filter(isColumnInfo)) {
    if (column.name === "id" || column.notnull === 0 || column.dflt_value !== null) continue
    values[column.name] = /INT|REAL|NUM/i.test(column.type) ? 0 : `${column.name}-${id}`
  }
  const names = Object.keys(values)
  sqlite.pragma("foreign_keys = OFF")
  sqlite
    .prepare(`INSERT INTO "${table}" (${names.map((name) => `"${name}"`).join(", ")}) VALUES (${names.map(() => "?").join(", ")})`)
    .run(...names.map((name) => values[name]))
  sqlite.pragma("foreign_keys = ON")
  return id
}

function rows(sqlite: Sqlite, sql: string, ...params: readonly string[]): readonly unknown[] {
  return sqlite.prepare(sql).all(...params)
}

describe("0295 list sheet settings", () => {
  let sqlite: Sqlite
  let db: Db
  let orgA: string
  let orgB: string
  let userA: string
  const now = "2026-11-05T00:00:00.000Z"

  beforeAll(() => {
    sqlite = replay()
    sqlite.pragma("foreign_keys = ON")
    // The store's Db type is D1's; the SQLite driver runs the same Drizzle queries.
    const sqliteDb: unknown = drizzle(sqlite)
    db = sqliteDb as Db
    orgA = insertParent(sqlite, "organizations")
    orgB = insertParent(sqlite, "organizations")
    userA = insertParent(sqlite, "users")
  }, 60_000)

  afterAll(() => sqlite.close())

  const company = (organizationId: string, columns: string, sortColumn: string | null) => ({
    organizationId,
    sheetKey: "purchase-orders.job",
    columns,
    sortColumn,
    sortDirection: sortColumn ? ("asc" as const) : null,
    startFilter: null,
    filterLabels: null,
    updatedBy: userA,
    now,
  })

  it("keeps each organization's layout separate and upserts only the caller's row", async () => {
    await saveOrganizationListSheetSetting(db, company(orgA, "[]", "dueDate"))
    await saveOrganizationListSheetSetting(db, company(orgB, "[]", "amount"))
    await saveOrganizationListSheetSetting(db, company(orgA, JSON.stringify([{ id: "number", visible: true }]), null))
    expect(rows(sqlite, "SELECT organization_id, sort_column, columns FROM organization_list_sheet_settings ORDER BY sort_column IS NULL, organization_id"))
      .toEqual(expect.arrayContaining([
        { organization_id: orgA, sort_column: null, columns: JSON.stringify([{ id: "number", visible: true }]) },
        { organization_id: orgB, sort_column: "amount", columns: "[]" },
      ]))
    expect(rows(sqlite, "SELECT id FROM organization_list_sheet_settings")).toHaveLength(2)
  })

  it("is unique on (organization, sheet) and checks the sort direction", () => {
    const insert = sqlite.prepare(
      "INSERT INTO organization_list_sheet_settings (id, organization_id, sheet_key, columns, sort_direction, created_at, updated_at) VALUES (?, ?, ?, '[]', ?, ?, ?)",
    )
    expect(() => insert.run(randomUUID(), orgA, "purchase-orders.job", null, now, now)).toThrow(/UNIQUE/)
    expect(() => insert.run(randomUUID(), orgA, "rfis.job", "sideways", now, now)).toThrow(/CHECK/)
    expect(() => insert.run(randomUUID(), "missing-org", "rfis.job", null, now, now)).toThrow(/FOREIGN KEY/)
  })

  it("keeps one personal row per (user, organization, sheet) and cascades with the user", async () => {
    const key = { userId: userA, organizationId: orgA, sheetKey: "todos.job" }
    await saveUserListSheetColumnPreference(db, { ...key, hiddenColumnIds: '["author"]', shownColumnIds: "[]", now })
    await saveUserListSheetColumnPreference(db, { ...key, hiddenColumnIds: '["priority"]', shownColumnIds: "[]", now })
    await saveUserListSheetColumnPreference(db, { ...key, organizationId: orgB, hiddenColumnIds: '["status"]', shownColumnIds: "[]", now })
    expect(rows(sqlite, "SELECT organization_id, hidden_column_ids FROM user_list_sheet_column_preferences WHERE user_id = ? ORDER BY hidden_column_ids", userA))
      .toEqual([
        { organization_id: orgA, hidden_column_ids: '["priority"]' },
        { organization_id: orgB, hidden_column_ids: '["status"]' },
      ])
    sqlite.prepare("DELETE FROM users WHERE id = ?").run(userA)
    expect(rows(sqlite, "SELECT id FROM user_list_sheet_column_preferences")).toHaveLength(0)
    expect(rows(sqlite, "SELECT updated_by FROM organization_list_sheet_settings")).toEqual([{ updated_by: null }, { updated_by: null }])
  })
})
