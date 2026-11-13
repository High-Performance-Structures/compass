import Database from "better-sqlite3"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { applyMigrations } from "@/test/migrated-database"

import { drizzleOverSqlite } from "../../../../../__tests__/helpers/correspondence-core"

import { applyDailyLogFollowUps, checkDailyLogFollowUps, dailyLogFollowUpSetup } from "@/lib/daily-logs/log-followups-server"
import { EMPTY_DAILY_LOG_FOLLOW_UPS } from "@/lib/daily-logs/log-followups"
import { advanceSelectionStatus, advanceSelectionsForPurchaseOrder, statusesBefore } from "@/lib/domain/selections/status-advance"
import { PROJECT_SELECTION_STATUS_LABELS, PROJECT_SELECTION_STATUS_OPTIONS } from "@/lib/domain/selections/statuses"
import { SELECTION_STATUS_LABELS, selectionMatchesFilter } from "@/lib/selections/sheet"
import { loadSelectionSheet } from "@/lib/domain/selections/selection-sheet-read"

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
    applyMigrations((sql) => db.exec(sql))
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
      ('vanity', 'p1', 'Bath', 'Vanity', 'installed', '${NOW}', '${NOW}'),
      ('hood', 'p1', 'Kitchen', 'Range hood', 'owner_review', '${NOW}', '${NOW}'),
      ('mirror', 'p1', 'Bath', 'Mirror', 'deferred', '${NOW}', '${NOW}'),
      ('sconce', 'p1', 'Bath', 'Sconce', 'unavailable', '${NOW}', '${NOW}');
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

  it("writes the company's status names into new Activity text; metadata keeps the keys", async () => {
    sqlite.exec(`INSERT INTO organization_feature_settings (organization_id, feature_key, value, updated_at) VALUES ('org-1', 'selection-status-names', '{"names":{"owner_review":"Client review"}}', '${NOW}')`)
    const db = drizzleOverSqlite(sqlite)
    expect(await advanceSelectionStatus(db, { projectId: "p1", selectionIds: ["tile"], target: "owner_review", reason: { kind: "published" }, actor })).toEqual(["tile"])
    expect(statuses()).toMatchObject({ tile: "owner_review" })
    const activity = sqlite.prepare("SELECT summary, metadata FROM activity_events").all()
    expect(activity).toMatchObject([{ summary: "Backsplash moved from Needed to Client review: published to the owner." }])
    const [row] = activity
    const metadata: unknown = typeof row === "object" && row !== null ? JSON.parse(String(Reflect.get(row, "metadata"))) : null
    expect(metadata).toMatchObject({ from: "needed", to: "owner_review" })
  })

  it("moves a purchase order's selections to Ordered once the PO is sent, never back from Installed", async () => {
    const db = drizzleOverSqlite(sqlite)
    expect(await advanceSelectionsForPurchaseOrder(db, { projectId: "p1", purchaseOrderId: "po1", purchaseOrderNumber: "PO-001", status: "draft", actor })).toEqual([])
    expect(await advanceSelectionsForPurchaseOrder(db, { projectId: "p1", purchaseOrderId: "po1", purchaseOrderNumber: "PO-001", status: "sent", actor })).toEqual(["faucet"])
    expect(statuses()).toMatchObject({ faucet: "ordered", vanity: "installed" })
  })
})

describe("daily log: Selections installed", () => {
  const creator = { ...actor, avatarUrl: null, googleEmail: null, isActive: true, lastLoginAt: null, organizationId: "org-1", organizationName: "Org", organizationType: "internal", createdAt: NOW, updatedAt: NOW }

  it("offers every selection not installed yet (not deferred or unavailable), approved and ordered first", async () => {
    const db = drizzleOverSqlite(sqlite)
    const setup = await dailyLogFollowUpSetup(db, "org-1", "p1")
    expect(setup.installableSelections?.map((selection) => [selection.id, selection.status])).toEqual([
      ["faucet", "approved"],
      ["tile", "needed"],
      ["hood", "owner_review"],
    ])
  })

  it("moves ticked ones to Installed on save, with or without approval first, and logs each", async () => {
    const db = drizzleOverSqlite(sqlite)
    // A log queued on a phone keeps the same filtering.
    const queued = await checkDailyLogFollowUps(db, "org-1", "p1", "2026-11-09", { ...EMPTY_DAILY_LOG_FOLLOW_UPS, installedSelectionIds: ["faucet", "mirror"] }, true)
    expect(queued.ok && queued.followUps.installedSelectionIds).toEqual(["faucet"])

    const checked = await checkDailyLogFollowUps(db, "org-1", "p1", "2026-11-09", {
      ...EMPTY_DAILY_LOG_FOLLOW_UPS,
      installedSelectionIds: ["faucet", "hood", "vanity", "mirror", "elsewhere"],
    })
    if (!checked.ok) throw new Error(checked.error)
    // Already installed, deferred, or not on this job: dropped rather than failing the log.
    expect(checked.followUps.installedSelectionIds).toEqual(["faucet", "hood"])

    sqlite.prepare("INSERT INTO daily_logs (id, project_id, log_date, work_completed, created_at, updated_at) VALUES ('log1', 'p1', '2026-11-09', 'Set fixtures', ?, ?)").run(NOW, NOW)
    await applyDailyLogFollowUps(db, {
      organizationId: "org-1",
      projectId: "p1",
      dailyLogId: "log1",
      logDate: "2026-11-09",
      creator,
      workCompleted: "Set fixtures",
      lines: [],
      checked,
    })
    expect(statuses()).toMatchObject({ faucet: "installed", hood: "installed", tile: "needed", mirror: "deferred" })
    const activity = sqlite.prepare("SELECT entity_id, metadata FROM activity_events WHERE action = 'selection_status_advanced' ORDER BY entity_id").all()
    expect(activity).toEqual([
      { entity_id: "faucet", metadata: JSON.stringify({ from: "approved", to: "installed", reason: "daily_log", dailyLogId: "log1" }) },
      { entity_id: "hood", metadata: JSON.stringify({ from: "owner_review", to: "installed", reason: "daily_log", dailyLogId: "log1" }) },
    ])
    // The Selections sheet reads the same column: both show Installed there.
    const sheet = await loadSelectionSheet(db, "p1")
    expect(sheet.filter((row) => row.status === "installed").map((row) => row.id).toSorted()).toEqual(["faucet", "hood", "vanity"])
    expect(sheet.filter((row) => selectionMatchesFilter(row, "installed")).map((row) => row.id).toSorted()).toEqual(["faucet", "hood", "vanity"])
    // Installed ones leave the next log's checklist.
    expect((await dailyLogFollowUpSetup(db, "org-1", "p1")).installableSelections?.map((selection) => selection.id)).toEqual(["tile"])
  })
})
