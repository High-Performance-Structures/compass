import Database from "better-sqlite3"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { drizzleOverSqlite } from "../../../../../__tests__/helpers/correspondence-core"

import { applyDailyLogFollowUps, checkDailyLogFollowUps, dailyLogFollowUpSetup } from "@/lib/daily-logs/log-followups-server"
import { EMPTY_DAILY_LOG_FOLLOW_UPS } from "@/lib/daily-logs/log-followups"
import { advanceSelectionStatus, advanceSelectionsForPurchaseOrder, statusesBefore } from "@/lib/domain/selections/status-advance"
import { PROJECT_SELECTION_STATUS_LABELS, PROJECT_SELECTION_STATUS_OPTIONS } from "@/lib/domain/selections/statuses"
import { SELECTION_STATUS_LABELS } from "@/lib/selections/sheet"

/*
 * Automatic selection status moves (forward only, logged to Activity) and
 * the daily log's "Selections installed" checklist, against a database built
 * from every migration.
 */

type Sqlite = InstanceType<typeof Database>
const NOW = "2026-11-09T12:00:00.000Z"
let sqlite: Sqlite
let migratedImage: Buffer | null = null
const actor = { id: "staff", email: "pm@example.com", displayName: "Pat PM", firstName: null, lastName: null, role: "project_manager" }

function migrated(): Sqlite {
  if (!migratedImage) {
    const db = new Database(":memory:")
    const dir = join(process.cwd(), "drizzle")
    for (const file of readdirSync(dir).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort()) {
      db.exec(readFileSync(join(dir, file), "utf8").replaceAll("--> statement-breakpoint", ""))
    }
    migratedImage = db.serialize()
    db.close()
  }
  const copy = new Database(migratedImage)
  copy.exec("PRAGMA foreign_keys = ON")
  return copy
}

beforeEach(() => {
  sqlite = migrated()
  sqlite.exec(`
    INSERT INTO organizations (id, name, slug, type, is_active, created_at, updated_at) VALUES ('org-1', 'Org', 'org', 'internal', 1, '${NOW}', '${NOW}');
    INSERT INTO users (id, email, display_name, role, is_active, created_at, updated_at) VALUES ('staff', 'pm@example.com', 'Pat PM', 'project_manager', 1, '${NOW}', '${NOW}');
    INSERT INTO projects (id, name, organization_id, created_at) VALUES ('p1', 'Job', 'org-1', '${NOW}');
    INSERT INTO project_finish_selections (id, project_id, room_name, name, status, created_at, updated_at) VALUES
      ('tile', 'p1', 'Kitchen', 'Backsplash', 'needed', '${NOW}', '${NOW}'),
      ('faucet', 'p1', 'Kitchen', 'Faucet', 'approved', '${NOW}', '${NOW}'),
      ('vanity', 'p1', 'Bath', 'Vanity', 'installed', '${NOW}', '${NOW}');
    INSERT INTO project_operations (id, project_id, source_system, source_record_type, source_record_number, title, status, created_at, updated_at)
      VALUES ('po1', 'p1', 'compass', 'purchase_order', 'PO-001', 'Fixtures', 'draft', '${NOW}', '${NOW}');
    INSERT INTO project_selection_procurement_links (id, project_id, selection_id, operation_id, specification_json, created_at) VALUES
      ('l1', 'p1', 'faucet', 'po1', '{}', '${NOW}'),
      ('l2', 'p1', 'vanity', 'po1', '{}', '${NOW}');
  `)
})
afterEach(() => sqlite.close())

function statuses(): Record<string, string> {
  return Object.fromEntries(
    sqlite
      .prepare("SELECT id, status FROM project_finish_selections")
      .all()
      .flatMap((row) => (typeof row === "object" && row !== null ? [[String(Reflect.get(row, "id")), String(Reflect.get(row, "status"))]] : [])),
  )
}

describe("selection status labels", () => {
  it("uses one label list everywhere, with owner_review as With owner", () => {
    expect(PROJECT_SELECTION_STATUS_LABELS.owner_review).toBe("With owner")
    expect(SELECTION_STATUS_LABELS).toBe(PROJECT_SELECTION_STATUS_LABELS)
    expect(PROJECT_SELECTION_STATUS_OPTIONS.find((option) => option.value === "owner_review")?.label).toBe("With owner")
  })
})

describe("automatic status moves", () => {
  it("only moves forward", () => {
    expect(statusesBefore("owner_review")).toEqual(["needed", "proposed"])
    expect(statusesBefore("ordered")).not.toContain("installed")
    expect(statusesBefore("installed")).not.toContain("deferred")
  })

  it("publishing moves a selection to With owner and logs it; a later status stays", async () => {
    const db = drizzleOverSqlite(sqlite)
    expect(await advanceSelectionStatus(db, { projectId: "p1", selectionIds: ["tile", "faucet"], target: "owner_review", reason: { kind: "published" }, actor })).toEqual(["tile"])
    expect(statuses()).toMatchObject({ tile: "owner_review", faucet: "approved" })
    const activity = sqlite.prepare("SELECT entity_id, action, summary FROM activity_events").all()
    expect(activity).toEqual([{ entity_id: "tile", action: "selection_status_advanced", summary: "Backsplash moved from Needed to With owner: published to the owner." }])
  })

  it("moves a purchase order's selections to Ordered once the PO is sent, never back from Installed", async () => {
    const db = drizzleOverSqlite(sqlite)
    expect(await advanceSelectionsForPurchaseOrder(db, { projectId: "p1", purchaseOrderId: "po1", purchaseOrderNumber: "PO-001", status: "draft", actor })).toEqual([])
    expect(await advanceSelectionsForPurchaseOrder(db, { projectId: "p1", purchaseOrderId: "po1", purchaseOrderNumber: "PO-001", status: "sent", actor })).toEqual(["faucet"])
    expect(statuses()).toMatchObject({ faucet: "ordered", vanity: "installed" })
  })
})

describe("daily log: Selections installed", () => {
  it("offers approved and ordered selections, and moves ticked ones to Installed on save", async () => {
    const db = drizzleOverSqlite(sqlite)
    const setup = await dailyLogFollowUpSetup(db, "org-1", "p1")
    expect(setup.installableSelections?.map((selection) => selection.id)).toEqual(["faucet"])
    // Field Mode phones show the status beside each one.
    expect(["approved", "ordered"]).toContain(setup.installableSelections?.[0]?.status)
    // A log queued on a phone keeps the same filtering.
    const queued = await checkDailyLogFollowUps(db, "org-1", "p1", "2026-11-09", { ...EMPTY_DAILY_LOG_FOLLOW_UPS, installedSelectionIds: ["faucet", "tile"] }, true)
    expect(queued.ok && queued.followUps.installedSelectionIds).toEqual(["faucet"])

    const checked = await checkDailyLogFollowUps(db, "org-1", "p1", "2026-11-09", { ...EMPTY_DAILY_LOG_FOLLOW_UPS, installedSelectionIds: ["faucet", "tile", "elsewhere"] })
    if (!checked.ok) throw new Error(checked.error)
    expect(checked.followUps.installedSelectionIds).toEqual(["faucet"])

    sqlite.prepare("INSERT INTO daily_logs (id, project_id, log_date, work_completed, created_at, updated_at) VALUES ('log1', 'p1', '2026-11-09', 'Set fixtures', ?, ?)").run(NOW, NOW)
    await applyDailyLogFollowUps(db, {
      organizationId: "org-1",
      projectId: "p1",
      dailyLogId: "log1",
      logDate: "2026-11-09",
      creator: { ...actor, avatarUrl: null, googleEmail: null, isActive: true, lastLoginAt: null, organizationId: "org-1", organizationName: "Org", organizationType: "internal", createdAt: NOW, updatedAt: NOW },
      workCompleted: "Set fixtures",
      lines: [],
      checked,
    })
    expect(statuses()).toMatchObject({ faucet: "installed" })
    const activity = sqlite.prepare("SELECT entity_id, metadata FROM activity_events WHERE action = 'selection_status_advanced'").all()
    expect(activity).toEqual([{ entity_id: "faucet", metadata: JSON.stringify({ from: "approved", to: "installed", reason: "daily_log", dailyLogId: "log1" }) }])
  })
})
