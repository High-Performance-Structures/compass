import { describe, expect, it } from "vitest"

import { migratedSqlite, type Sqlite } from "@/lib/daily-logs/__tests__/sqlite-d1"

/*
 * Replays every migration, then checks 0294's organization_record_statuses:
 * the defaults, the group CHECK (and no CHECK on the growing lists), one row per (organization, record type,
 * key), and that a company's rows go with the company.
 */

const STAMP = "2026-11-05T00:00:00.000Z"

function database(): Sqlite {
  const sqlite = migratedSqlite()
  sqlite.exec("PRAGMA foreign_keys = ON")
  sqlite.exec(`
    INSERT INTO organizations (id,name,slug,type,is_active,created_at,updated_at) VALUES
      ('org-a','Company A','company-a','internal',1,'${STAMP}','${STAMP}'),
      ('org-b','Company B','company-b','internal',1,'${STAMP}','${STAMP}');
  `)
  return sqlite
}

function insert(sqlite: Sqlite, id: string, organization: string, type: string, key: string, extra = ""): void {
  const [columns, values] = extra ? extra.split("=") : ["", ""]
  sqlite.exec(`
    INSERT INTO organization_record_statuses (id,organization_id,record_type,status_key,label,created_at,updated_at${columns ? `,${columns}` : ""})
    VALUES ('${id}','${organization}','${type}','${key}','${key}','${STAMP}','${STAMP}'${values ? `,${values}` : ""});
  `)
}

describe("migration 0294: organization_record_statuses", () => {
  it("stores a row with the defaults: gray, open, shown, visible, not built in", () => {
    const sqlite = database()
    insert(sqlite, "s1", "org-a", "purchase_order", "backordered")
    const [row] = sqlite.prepare("SELECT * FROM organization_record_statuses WHERE id = 's1'").all()
    expect(row).toMatchObject({ color: "gray", status_group: "open", sort_order: 0, show_as_button: 1, hidden: 0, built_in: 0 })
  })

  it("keeps one row per organization, record type and key", () => {
    const sqlite = database()
    insert(sqlite, "s1", "org-a", "purchase_order", "backordered")
    expect(() => insert(sqlite, "s2", "org-a", "purchase_order", "backordered")).toThrow(/UNIQUE/)
    // The same key is fine for another record type or another company.
    insert(sqlite, "s3", "org-a", "rfi", "backordered")
    insert(sqlite, "s4", "org-b", "purchase_order", "backordered")
  })

  it("checks only the group in SQL; record types and colors grow in the app", () => {
    const sqlite = database()
    expect(() => insert(sqlite, "s1", "org-a", "rfi", "y", "status_group='pending'")).toThrow(/CHECK/)
    insert(sqlite, "s2", "org-a", "todo", "z", "status_group='void'")
    // A record type or color added later needs no table rebuild.
    insert(sqlite, "s3", "org-a", "change_order", "x", "color='purple'")
    const [sql] = sqlite.prepare("SELECT sql FROM sqlite_master WHERE name = 'organization_record_statuses'").all()
    expect(String(sql?.sql)).not.toMatch(/CHECK \(`record_type`|CHECK \(`color`/)
  })

  it("requires a real organization and removes its rows with it", () => {
    const sqlite = database()
    expect(() => insert(sqlite, "s1", "missing-org", "rfi", "x")).toThrow(/FOREIGN KEY/)
    insert(sqlite, "s2", "org-b", "rfi", "x")
    sqlite.exec("DELETE FROM organizations WHERE id = 'org-b'")
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM organization_record_statuses").all()[0]?.n).toBe(0)
  })
})
