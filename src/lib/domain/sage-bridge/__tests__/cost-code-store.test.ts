import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { getDb } from "@/db"
import { rowsOf, sqliteWith } from "@/lib/domain/__tests__/recording-d1"
import { sageCostCodeSyncBatches } from "@/lib/domain/sage-bridge/cost-code-store"
import { planSageCostCodeSync, type SageCostCodeRecord } from "@/lib/domain/sage-bridge/cost-code-sync-rules"

// @ts-expect-error Statements are only built here and run on SQLite.
const db = getDb({})
const now = "2026-11-10T18:00:00.000Z"

function run(sqlite: ReturnType<typeof sqliteWith>, batches: ReturnType<typeof sageCostCodeSyncBatches>): void {
  for (const batch of batches) {
    for (const statement of batch) {
      const { sql, params } = statement.toSQL()
      sqlite.prepare(sql).run(...params)
    }
  }
}

describe("Sage cost code store", () => {
  it("applies a plan in small batches, keeping ids and never deleting", () => {
    const sqlite = sqliteWith(readFileSync(join(process.cwd(), "drizzle/0045_sage_cost_codes.sql"), "utf8").replaceAll("--> statement-breakpoint", ""))
    sqlite
      .prepare(`INSERT INTO sage_cost_codes (id, source_system, source_record_number, code, description, display_label, division_code,
        division_description, division_display_label, active, sync_status, created_at, updated_at)
        VALUES (?, 'sage_xlsx', ?, ?, ?, ?, '09', 'Finishes', '09 00 00 Finishes', 1, 'synced_local_export', ?, ?)`)
      .run("sage-cost-code-09-29-00", "09 29 00", "09 29 00", "Gypsum Board", "09 29 00 Gypsum Board", now, now)
    sqlite
      .prepare(`INSERT INTO sage_cost_codes (id, source_system, source_record_number, code, description, display_label, division_code,
        division_description, division_display_label, active, sync_status, created_at, updated_at)
        VALUES (?, 'sage_xlsx', ?, ?, ?, ?, '09', 'Finishes', '09 00 00 Finishes', 1, 'synced_local_export', ?, ?)`)
      .run("sage-cost-code-09-60-00", "09 60 00", "09 60 00", "Flooring", "09 60 00 Flooring", now, now)

    // Enough new codes to need several insert statements and batches.
    const records: SageCostCodeRecord[] = [
      { recordNumber: "9290000", name: "09 29 00 - Gypsum Board" },
      ...Array.from({ length: 400 }, (_, index) => ({ recordNumber: String(9300100 + index), name: `Item ${index}` })),
    ]
    const existing = sqlite.prepare("SELECT * FROM sage_cost_codes").all()
    const planned = planSageCostCodeSync({
      records,
      existing: existing.map((row) => {
        if (typeof row !== "object" || row === null) throw new Error("row")
        const value = (key: string): string => String(Reflect.get(row, key) ?? "")
        return {
          id: value("id"), sourceSystem: value("source_system"), sourceRecordId: null, sourceRecordNumber: value("source_record_number"),
          code: value("code"), description: value("description"), displayLabel: value("display_label"), divisionCode: value("division_code"),
          divisionDescription: value("division_description"), divisionDisplayLabel: value("division_display_label"),
          active: Reflect.get(row, "active") === 1, syncStatus: value("sync_status"),
        }
      }),
    })
    if (!planned.success) throw new Error(planned.error)
    const batches = sageCostCodeSyncBatches(db, planned.plan, now)
    expect(batches.length).toBeGreaterThan(1)
    expect(batches.every((batch) => batch.length <= 50)).toBe(true)
    run(sqlite, batches)

    const rows = rowsOf(sqlite, "sage_cost_codes")
    expect(rows).toHaveLength(402)
    expect(rows).toContainEqual(expect.objectContaining({
      id: "sage-cost-code-09-29-00", source_system: "sage", source_record_id: "9290000", code: "09 29 00", active: 1, sync_status: "synced", last_synced_at: now,
    }))
    expect(rows).toContainEqual(expect.objectContaining({ id: "sage-cost-code-09-60-00", active: 0, sync_status: "not_in_sage" }))
    expect(rows).toContainEqual(expect.objectContaining({ id: "sage-cost-code-r9300115", code: "09 30 01.15", description: "Item 15", active: 1 }))
  })
})
