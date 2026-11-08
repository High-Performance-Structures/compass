import { readFileSync } from "node:fs"
import { getTableColumns, getTableName } from "drizzle-orm"
import type { SQLiteTable } from "drizzle-orm/sqlite-core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { context, openCorrespondenceTestDatabase, type CorrespondenceTestDatabase } from "../../../../__tests__/helpers/correspondence-core"
import { dailyLogPhotoAliases, dailyLogPhotos, ownerProjectUpdates, projects } from "@/db/schema"
import { socialPostMedia } from "@/db/schema-social"
import { deleteProjectPhotos } from "../project-photos"
const mocks = vi.hoisted(() => ({ auth: vi.fn(), trash: vi.fn() }))
let database: CorrespondenceTestDatabase
vi.mock("server-only", () => ({}))
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.auth, getCurrentUser: mocks.auth }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: async () => ({ env: { DB: database.d1 } }) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/google/organization-drive", () => ({
  getOrganizationDriveContext: async () => ({ client: { trashFile: mocks.trash }, userEmail: "staff@example.test" }),
}))

function completeColumns(table: SQLiteTable): void {
  const name = getTableName(table)
  database.sqlite.exec(`CREATE TABLE IF NOT EXISTS "${name}" (id TEXT PRIMARY KEY)`)
  const present = new Set(database.sqlite.prepare(`PRAGMA table_info("${name}")`).all().flatMap((row) =>
    typeof row === "object" && row !== null && "name" in row && typeof row.name === "string" ? [row.name] : []))
  for (const column of Object.values(getTableColumns(table))) {
    if (!present.has(column.name)) database.sqlite.exec(`ALTER TABLE "${name}" ADD COLUMN "${column.name}" ${column.getSQLType()}`)
  }
}
function photo(id: string, driveFileId: string, projectId = "project-a"): string {
  return `INSERT INTO daily_log_photos(id,project_id,source_system,source_external_id,file_name,mime_type,drive_file_id,owner_visible,sub_vendor_visible,public_shareable,created_at,updated_at) VALUES('${id}','${projectId}','buildertrend','bt-${id}','${id}.jpg','image/jpeg','${driveFileId}',0,0,0,'2026-11-08','2026-11-08');`
}
const ids = (): unknown => database.sqlite.prepare("SELECT id FROM daily_log_photos ORDER BY id").all().map((row) => (row as { id: string }).id)

beforeEach(() => {
  vi.resetAllMocks()
  database = openCorrespondenceTestDatabase()
  for (const table of [projects, dailyLogPhotos, dailyLogPhotoAliases, ownerProjectUpdates, socialPostMedia]) completeColumns(table)
  database.sqlite.exec(readFileSync("drizzle/0074_activity_events.sql", "utf8"))
  database.sqlite.exec(
    photo("keep", "file-keep") + photo("gone", "file-gone") + photo("copy", "file-copy") +
    photo("shared-a", "file-shared") + photo("shared-b", "file-shared") + photo("in-update", "file-update") + photo("posted", "file-posted") +
    photo("other", "file-other", "project-other") +
    "INSERT INTO daily_log_photo_aliases(id,source_photo_id,canonical_photo_id,project_id,content_sha256,content_size_bytes,created_at) VALUES('copy','copy','gone','project-a','" + "a".repeat(64) + "',10,'2026-11-08');" +
    `INSERT INTO owner_project_updates(id,project_id,title,update_date,summary,status,selected_photo_ids,created_at,updated_at) VALUES('update','project-a','Week 4','2026-11-01','','sent','["in-update"]','2026-11-01','2026-11-01');` +
    "INSERT INTO social_post_media(id,post_id,photo_id,created_at) VALUES('media','post','posted','2026-11-01');"
  )
  mocks.auth.mockResolvedValue(context(database, "staff-a", "project-a").user)
  mocks.trash.mockResolvedValue({})
})
afterEach(() => database.close())

describe("bulk photo delete", () => {
  it("deletes the selected photos with their hidden copies and trashes unused Drive files", async () => {
    const result = await deleteProjectPhotos("project-a", ["gone", "shared-a", "in-update", "posted", "other"])
    expect(result).toEqual({ success: true, deletedIds: ["gone", "shared-a"], deletedCount: 2, keptInUse: 2, driveTrashFailed: 0 })
    expect(ids()).toEqual(["in-update", "keep", "other", "posted", "shared-b"])
    expect(database.sqlite.prepare("SELECT count(*) AS n FROM daily_log_photo_aliases").get()).toEqual({ n: 0 })
    // file-shared still backs shared-b, so only the deleted photo's and its copy's files go.
    expect(mocks.trash.mock.calls.map((call) => call[1]).sort()).toEqual(["file-copy", "file-gone"])
    const event = database.sqlite.prepare("SELECT action, metadata FROM activity_events").get() as { action: string; metadata: string }
    expect(event.action).toBe("photos.deleted")
    expect(JSON.parse(event.metadata)).toMatchObject({ selectedCount: 2, hiddenCopies: 1, sourceRecords: ["buildertrend:bt-gone", "buildertrend:bt-shared-a", "buildertrend:bt-copy"] })
  })

  it("refuses on a project whose records are on hold", async () => {
    database.sqlite.exec("UPDATE projects SET imported_conversations_staff_only=1 WHERE id='project-a'")
    const result = await deleteProjectPhotos("project-a", ["gone"])
    expect(result).toEqual({ success: false, error: "This project's records are on hold, so its photos can't be deleted." })
    expect(ids()).toContain("gone")
    expect(mocks.trash).not.toHaveBeenCalled()
  })

  it("still deletes the photos when Drive refuses, and says so", async () => {
    mocks.trash.mockRejectedValue(new Error("403"))
    const result = await deleteProjectPhotos("project-a", ["keep"])
    expect(result).toMatchObject({ success: true, deletedCount: 1, driveTrashFailed: 1 })
    expect(ids()).not.toContain("keep")
  })
})
