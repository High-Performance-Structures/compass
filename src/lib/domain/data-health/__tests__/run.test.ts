import { describe, expect, it } from "vitest"

import { KNOWN_PRODUCTION_ONLY_SCHEMA } from "@/db/known-schema-differences"
import { declaredTableColumns } from "@/db/declared-schema"
import { migratedDb } from "@/lib/domain/__tests__/sqlite-d1"

import { driftFingerprint, isHealthy, reportForOrganization } from "../rules"
import { runDataHealthCheck } from "../run"

describe("known production-only leftovers", () => {
  it("lists only things neither the schema nor the migrations create", () => {
    const declared = declaredTableColumns()
    const { sqlite } = migratedDb()
    for (const item of KNOWN_PRODUCTION_ONLY_SCHEMA) {
      if (item.kind === "table") {
        expect(declared.has(item.table), item.table).toBe(false)
        expect(sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(item.table), item.table).toBeUndefined()
      } else {
        expect(declared.get(item.table) ?? [], `${item.table}.${item.column}`).not.toContain(item.column)
        const columns = sqlite.prepare(`SELECT name FROM pragma_table_info('${item.table}')`).all() as { name: string }[]
        expect(columns.map((column) => column.name), `${item.table}.${item.column}`).not.toContain(item.column)
      }
    }
  })
})

describe("runDataHealthCheck", () => {
  it("finds a freshly migrated database healthy (every check's SQL runs)", async () => {
    const { db } = migratedDb()
    const report = await runDataHealthCheck(db, new Date("2026-11-13T12:00:00Z"))
    expect(report.statusFindings).toEqual([])
    expect(report.schema).toMatchObject({ extraTables: [], extraColumns: [], missingTables: [], missingColumns: [] })
    // The migration-only leftovers are listed as known, not as drift.
    expect(report.schema.known).toContain("project_agreements")
    expect(report.statusChecks).toBeGreaterThan(25)
    expect(isHealthy(report)).toBe(true)
  })

  it("reports status values the machines don't allow, per company, and schema drift", async () => {
    const { sqlite, db } = migratedDb()
    sqlite.pragma("foreign_keys = OFF")
    const now = "2026-11-13T12:00:00Z"
    sqlite.exec(`INSERT INTO projects (id, name, organization_id, created_at) VALUES ('p1', 'Job', 'org-a', '${now}')`)
    // A change order in a status the machine doesn't declare.
    sqlite.exec(`INSERT INTO project_change_orders
      (id, project_id, change_order_number, title, scope, requester_type, requester_name, source_type, status, created_at, updated_at)
      VALUES ('co1', 'p1', 'CO-1', 'CO', 'Scope', 'staff', 'Staff', 'manual', 'approved', '${now}', '${now}')`)
    // A to-do in a status the company's list doesn't know, and one in a known spelling.
    sqlite.exec(`INSERT INTO project_operations (id, project_id, source_record_type, title, status, created_at, updated_at)
      VALUES ('t1', 'p1', 'todo', 'A', 'pending_review', '${now}', '${now}'), ('t2', 'p1', 'todo', 'B', 'Completed', '${now}', '${now}'),
      ('t3', 'gone', 'todo', 'Orphan', 'open', '${now}', '${now}')`)
    // (t3's project is gone: it is read against the built-in list, where "open" is fine.)
    // A Square webhook event belongs to no company.
    sqlite.exec(`INSERT INTO sage_square_webhook_events (event_id, event_type, square_created_at, status, received_at, updated_at)
      VALUES ('e1', 'payment.updated', '${now}', 'stuck', '${now}', '${now}')`)
    sqlite.exec("ALTER TABLE projects ADD COLUMN legacy_note TEXT")
    sqlite.exec("CREATE TABLE stray_table (id TEXT)")

    const report = await runDataHealthCheck(db)
    const found = report.statusFindings.map((finding) => `${finding.organizationId}:${finding.table}.${finding.column}=${finding.value}x${finding.rows}`)
    expect(found.sort()).toEqual([
      "null:sage_square_webhook_events.status=stuckx1",
      "org-a:project_change_orders.status=approvedx1",
      "org-a:project_operations.status=pending_reviewx1",
    ])
    expect(report.schema.extraColumns).toEqual(["projects.legacy_note"])
    expect(report.schema.extraTables).toEqual(["stray_table"])
    expect(isHealthy(report)).toBe(false)

    // Another company sees the shared finding and the schema, not org-a's rows.
    const other = reportForOrganization(report, "org-b")
    expect(other.statusFindings.map((finding) => finding.table)).toEqual(["sage_square_webhook_events"])
    expect(driftFingerprint(other)).not.toBe(driftFingerprint(report))
  })
})
