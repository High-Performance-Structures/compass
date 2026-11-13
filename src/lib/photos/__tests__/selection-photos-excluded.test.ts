import Database from "better-sqlite3"
import { and, count, eq } from "drizzle-orm"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { applyMigrations } from "@/test/migrated-database"

import { drizzleOverSqlite } from "../../../../__tests__/helpers/correspondence-core"

import { dailyLogPhotos } from "@/db/schema"
import type { AuthUser } from "@/lib/auth"
import { loadOwnerUpdateAttachmentRows } from "@/lib/domain/field/owner-update-rows"
import { loadAttachablePhotos, loadChoicePanels } from "@/lib/domain/selections/choices-read"
import { dailyLogPhotoCollectionEligibility, notSelectionPhoto } from "@/lib/photos/collection-eligibility"
import { GALLERY_PHOTO_KINDS, SELECTION_PHOTO_KIND } from "@/lib/photos/review"

/*
 * Selection photos (finish and fixture choices, photo_kind 'selection') live
 * in Selections only. They are often owner-visible so owners see them inside
 * Selections, so every other photo surface filters them by kind. Runs against
 * a database built from every migration.
 */

const mocks = vi.hoisted(() => ({ projectContext: vi.fn(), revalidatePath: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("@/lib/server/action-context", () => ({ projectContext: mocks.projectContext }))
vi.mock("@/lib/activity-log", () => ({ recordActivityEvent: vi.fn() }))
vi.mock("@/lib/google/organization-drive", () => ({ getOrganizationDriveContext: vi.fn() }))

import { getProjectPhotoLibrary, updateProjectPhotoPermissions } from "@/app/actions/project-photos"

type Sqlite = InstanceType<typeof Database>
const NOW = "2026-11-10T12:00:00.000Z"
let sqlite: Sqlite
let migratedImage: Buffer | null = null

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

const staff: AuthUser = {
  id: "staff",
  email: "pm@example.com",
  firstName: null,
  lastName: null,
  displayName: "Pat PM",
  avatarUrl: null,
  role: "project_manager",
  googleEmail: null,
  organizationId: "org-1",
  organizationName: "Org",
  organizationType: "internal",
  isActive: true,
  lastLoginAt: null,
  createdAt: NOW,
  updatedAt: NOW,
}

function photo(id: string, kind: string): string {
  // Approved, owner-, vendor- and public-visible image with Drive bytes: only the kind differs.
  return `('${id}', 'p1', 'log-1', 'buildertrend', '${id}.jpg', 'image/jpeg', 'drive-${id}', 'uploaded', 'approved', 1, 1, 1, '${kind}', '${NOW}', '${NOW}')`
}

beforeEach(() => {
  vi.clearAllMocks()
  sqlite = migrated()
  sqlite.exec(`
    INSERT INTO organizations (id, name, slug, type, is_active, created_at, updated_at) VALUES ('org-1', 'Org', 'org', 'internal', 1, '${NOW}', '${NOW}');
    INSERT INTO users (id, email, display_name, role, is_active, created_at, updated_at) VALUES ('staff', 'pm@example.com', 'Pat PM', 'project_manager', 1, '${NOW}', '${NOW}');
    INSERT INTO projects (id, name, organization_id, created_at) VALUES ('p1', 'Job', 'org-1', '${NOW}');
    INSERT INTO daily_logs (id, project_id, log_date, work_completed, created_at, updated_at) VALUES ('log-1', 'p1', '2026-11-09', 'Framing', '${NOW}', '${NOW}');
    INSERT INTO daily_log_photos (id, project_id, daily_log_id, source_system, file_name, mime_type, drive_file_id, upload_status, review_status, owner_visible, sub_vendor_visible, public_shareable, photo_kind, created_at, updated_at) VALUES
      ${photo("framing", "progress")},
      ${photo("leak", "issue")},
      ${photo("vanity", SELECTION_PHOTO_KIND)},
      ${photo("faucet", SELECTION_PHOTO_KIND)};
    INSERT INTO project_finish_selections (id, project_id, room_name, name, category, status, created_at, updated_at)
      VALUES ('bath-vanity', 'p1', 'Bath', 'Vanity', 'Cabinets', 'needed', '${NOW}', '${NOW}');
    INSERT INTO project_selection_choices (id, project_id, selection_id, title, created_at, updated_at)
      VALUES ('oak', 'p1', 'bath-vanity', 'Oak vanity', '${NOW}', '${NOW}');
    INSERT INTO project_selection_photos (id, project_id, selection_id, choice_id, photo_id, sort_order, created_at) VALUES
      ('link-1', 'p1', 'bath-vanity', 'oak', 'vanity', 0, '${NOW}'),
      ('link-2', 'p1', 'bath-vanity', NULL, 'faucet', 1, '${NOW}');
  `)
  mocks.projectContext.mockResolvedValue({ success: true, data: { db: drizzleOverSqlite(sqlite), user: staff } })
})
afterEach(() => {
  sqlite.close()
})

describe("selection photos stay in Selections", () => {
  it("leaves them out of the project Photos gallery and its counts", async () => {
    const library = await getProjectPhotoLibrary("p1")
    expect(library.photos.map((row) => row.id).sort()).toEqual(["framing", "leak"])
    expect(library.photos).toHaveLength(2)
  })

  it("leaves owner-visible selection photos out of the owner portal and its counts", async () => {
    const db = drizzleOverSqlite(sqlite)
    // The owner portal's photo filter: approved, owner-visible, collection-eligible.
    const ownerWhere = and(
      eq(dailyLogPhotos.projectId, "p1"),
      eq(dailyLogPhotos.reviewStatus, "approved"),
      eq(dailyLogPhotos.ownerVisible, true),
      dailyLogPhotoCollectionEligibility(),
    )
    const rows = await db.select({ id: dailyLogPhotos.id }).from(dailyLogPhotos).where(ownerWhere)
    expect(rows.map((row) => row.id).sort()).toEqual(["framing", "leak"])
    const [counted] = await db
      .select({ total: count() })
      .from(dailyLogPhotos)
      .where(and(eq(dailyLogPhotos.dailyLogId, "log-1"), notSelectionPhoto()))
    expect(counted?.total).toBe(2)
  })

  it("leaves them out of the client-update photo picker, even when an older update picked one", async () => {
    const rows = await loadOwnerUpdateAttachmentRows(drizzleOverSqlite(sqlite), {
      viewer: staff,
      projectId: "p1",
      updateId: "update-1",
      selectedPhotoIds: ["vanity", "framing"],
      internalViewer: true,
    })
    expect(rows.map((row) => row.id).sort()).toEqual(["framing", "leak"])
  })

  it("still shows them in Selections, owner visibility included", async () => {
    const db = drizzleOverSqlite(sqlite)
    for (const audience of ["staff", "owner"] as const) {
      const [panel] = await loadChoicePanels(db, "p1", ["bath-vanity"], audience, "staff")
      expect(panel?.choices.find((choice) => choice.id === "oak")?.photos.map((row) => row.photoId)).toEqual(["vanity"])
      expect(panel?.selectionPhotos.map((row) => row.photoId)).toEqual(["faucet"])
    }
    sqlite.exec("UPDATE daily_log_photos SET owner_visible = 0 WHERE id = 'faucet'")
    const [ownerPanel] = await loadChoicePanels(db, "p1", ["bath-vanity"], "owner", "staff")
    expect(ownerPanel?.selectionPhotos).toEqual([])
    const attachable = await loadAttachablePhotos(db, "p1")
    expect(attachable.map((row) => row.id).sort()).toEqual(["faucet", "framing", "leak", "vanity"])
  })

  it("never offers or saves the Selection type from Photos", async () => {
    expect(GALLERY_PHOTO_KINDS.map((kind) => kind.value)).not.toContain(SELECTION_PHOTO_KIND)
    const result = await updateProjectPhotoPermissions("p1", {
      photoIds: ["framing"],
      reviewStatus: "approved",
      ownerVisible: true,
      subVendorVisible: false,
      publicShareable: false,
      photoKind: SELECTION_PHOTO_KIND,
    })
    expect(result).toEqual({ success: false, error: "Selection photos are in Selections. Pick another photo type." })
    const kind = sqlite.prepare("SELECT photo_kind FROM daily_log_photos WHERE id = 'framing'").get()
    expect(kind).toEqual({ photo_kind: "progress" })
  })
})

describe("every photo collection outside Selections filters by kind", () => {
  // Each of these reads photos for a gallery, portal, client update, dashboard,
  // field list, count or public post. They must use the shared predicate.
  const readers = [
    "src/app/actions/project-photos.ts",
    "src/app/actions/project-audience-preview.ts",
    "src/app/actions/dashboard-overview.ts",
    "src/app/actions/office-alerts.ts",
    "src/app/actions/social-posts.ts",
    "src/app/api/social/media/[photoId]/route.ts",
    "src/lib/domain/field/daily-log-workspace.ts",
    "src/lib/domain/field/field-summary.ts",
    "src/lib/domain/field/owner-update-drafts.ts",
    "src/lib/domain/field/owner-update-rows.ts",
    "src/lib/project-timeline/server.ts",
  ]
  it.each(readers)("%s", (file) => {
    const source = readFileSync(resolve(process.cwd(), file), "utf8")
    expect(source).toMatch(/dailyLogPhotoCollectionEligibility\(\)|notSelectionPhoto\(\)/)
  })
})
