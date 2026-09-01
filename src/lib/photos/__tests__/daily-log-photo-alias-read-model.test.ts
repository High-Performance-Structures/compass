import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

type SqlRow = Readonly<Record<string, string | number | null>>

type Statement = {
  readonly all: (...values: unknown[]) => unknown
  readonly get: (...values: unknown[]) => unknown
  readonly run: (...values: unknown[]) => unknown
}

type TestDatabase = {
  readonly exec: (sql: string) => void
  readonly prepare: (sql: string) => Statement
  readonly close: () => void
}

type TestDatabaseModule = {
  readonly Database: new (filename: string) => TestDatabase
}

function isTestDatabaseModule(value: unknown): value is TestDatabaseModule {
  return (
    value !== null &&
    typeof value === "object" &&
    "Database" in value &&
    typeof value.Database === "function"
  )
}

async function openDatabase(): Promise<TestDatabase> {
  if ("Bun" in globalThis) {
    const bunSqliteSpecifier = "bun:sqlite"
    const sqliteModule: unknown = await import(bunSqliteSpecifier)
    if (!isTestDatabaseModule(sqliteModule)) {
      throw new Error("bun:sqlite did not provide a Database constructor")
    }
    return new sqliteModule.Database(":memory:")
  }

  const { default: Database } = await import("better-sqlite3")
  return new Database(":memory:")
}

const migration = readFileSync(
  resolve(process.cwd(), "drizzle/0144_daily_log_photo_aliases.sql"),
  "utf8",
)

const projectId = "fixture-project"
const canonicalCount = 487
const aliasCount = 230
const sameContextAliasCount = 157
const crossContextAliasCount = 73
const reviewCanonicalCount = 40
const reviewAliasCount = 218
const ancillaryRowCount = 4
const ownerWorkflowDemotionAlias = 150
const reviewAliasReplacement = 218
const sha256 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

function isSqlRow(value: unknown): value is SqlRow {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function sqlRow(value: unknown): SqlRow | undefined {
  if (value === undefined) return undefined
  if (!isSqlRow(value)) throw new Error("Expected a SQL row")
  return value
}

function sqlRows(value: unknown): readonly SqlRow[] {
  if (!Array.isArray(value)) throw new Error("Expected SQL rows")
  if (value.some((row) => !isSqlRow(row))) {
    throw new Error("Expected SQL row objects")
  }
  return value
}

function rowNumber(row: SqlRow | undefined, key: string): number {
  const value = row?.[key]
  if (typeof value !== "number") {
    throw new Error(`Expected numeric ${key}`)
  }
  return value
}

function createFixture(database: TestDatabase): void {
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE projects (id TEXT PRIMARY KEY NOT NULL);
    CREATE TABLE daily_logs (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT
    );
    CREATE TABLE daily_log_photos (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
      daily_log_id TEXT,
      file_name TEXT NOT NULL,
      drive_file_id TEXT,
      mime_type TEXT,
      thumbnail_url TEXT,
      review_status TEXT NOT NULL,
      owner_visible INTEGER NOT NULL,
      sub_vendor_visible INTEGER NOT NULL,
      public_shareable INTEGER NOT NULL
    );
    INSERT INTO projects (id) VALUES ('${projectId}');
  `)
  database.exec(migration)

  const insertLog = database.prepare(
    "INSERT INTO daily_logs (id, project_id) VALUES (?, ?)",
  )
  for (let index = 0; index < 10; index += 1) {
    insertLog.run(`log-${index}`, projectId)
  }

  const insertPhoto = database.prepare(
    "INSERT INTO daily_log_photos (id, project_id, daily_log_id, file_name, drive_file_id, mime_type, thumbnail_url, review_status, owner_visible, sub_vendor_visible, public_shareable) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
  for (let index = 0; index < canonicalCount; index += 1) {
    const dailyLogId = index === 0 ? null : `log-${index % 10}`
    const reviewStatus = index < reviewCanonicalCount ? "needs_review" : "approved"
    insertPhoto.run(
      `canonical-${index}`,
      projectId,
      dailyLogId,
      `canonical-${index}.jpg`,
      `drive-canonical-${index}`,
      "image/jpeg",
      null,
      reviewStatus,
      1,
      1,
      1,
    )
  }
  for (let index = 0; index < aliasCount; index += 1) {
    const canonicalIndex = index
    const canonicalDailyLogId =
      canonicalIndex === 0 ? null : `log-${canonicalIndex % 10}`
    const dailyLogId =
      index < sameContextAliasCount
        ? canonicalDailyLogId
        : canonicalDailyLogId === null
          ? "log-cross-context"
          : `log-${(canonicalIndex + 1) % 10}`
    const reviewStatus =
      index < reviewAliasCount
        ? index === ownerWorkflowDemotionAlias
          ? "approved"
          : "needs_review"
        : index === reviewAliasReplacement
          ? "needs_review"
          : "approved"
    insertPhoto.run(
      `alias-${index}`,
      projectId,
      dailyLogId,
      `alias-${index}.jpg`,
      `drive-alias-${index}`,
      "image/jpeg",
      null,
      reviewStatus,
      1,
      1,
      1,
    )
  }

  insertPhoto.run(
    "ancillary-zip",
    projectId,
    "log-1",
    "daily-log-photos.zip",
    "drive-ancillary-zip",
    "application/zip",
    null,
    "verified",
    0,
    0,
    0,
  )
  insertPhoto.run(
    "ancillary-folder",
    projectId,
    "log-2",
    "progress photos folder",
    "drive-ancillary-folder",
    "application/vnd.google-apps.folder",
    null,
    "approved",
    1,
    0,
    0,
  )
  insertPhoto.run(
    "ancillary-staged",
    projectId,
    null,
    "staged-photo.jpg",
    null,
    "image/jpeg",
    null,
    "needs_review",
    0,
    0,
    0,
  )
  insertPhoto.run(
    "ancillary-pdf",
    projectId,
    "log-3",
    "owner-update-document.pdf",
    "drive-ancillary-pdf",
    "application/pdf",
    null,
    "approved",
    0,
    0,
    0,
  )

  const insertAlias = database.prepare(
    "INSERT INTO daily_log_photo_aliases (source_photo_id, canonical_photo_id, project_id, content_sha256, content_size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
  for (let index = 0; index < aliasCount; index += 1) {
    insertAlias.run(
      `alias-${index}`,
      `canonical-${index}`,
      projectId,
      String(index).padStart(64, "0"),
      index + 1,
      "2026-08-31T00:00:00.000Z",
    )
  }
}

function count(database: TestDatabase, query: string): number {
  return rowNumber(sqlRow(database.prepare(query).get()), "value")
}

function aggregatePhotoIds(database: TestDatabase): ReadonlySet<string> {
  const rows = sqlRows(database.prepare(`
    SELECT p.id
    FROM daily_log_photos AS p
    WHERE p.project_id IS '${projectId}'
      AND p.mime_type LIKE 'image/%'
      AND (p.drive_file_id IS NOT NULL OR p.thumbnail_url IS NOT NULL)
      AND NOT EXISTS (
        SELECT 1
        FROM daily_log_photo_aliases AS alias
        JOIN daily_log_photos AS canonical
          ON canonical.id IS alias.canonical_photo_id
        WHERE alias.source_photo_id IS p.id
          AND alias.project_id IS p.project_id
          AND canonical.project_id IS p.project_id
          AND canonical.mime_type LIKE 'image/%'
          AND (
            canonical.drive_file_id IS NOT NULL
            OR canonical.thumbnail_url IS NOT NULL
          )
      )
  `).all())
  return new Set(
    rows.flatMap((row) => {
      const value = row.id
      return typeof value === "string" ? [value] : []
    }),
  )
}

function thumbnailAwareAggregatePhotoIds(
  database: TestDatabase,
): ReadonlySet<string> {
  const rows = sqlRows(database.prepare(`
    SELECT p.id
    FROM daily_log_photos AS p
    WHERE p.project_id IS '${projectId}'
      AND (p.thumbnail_url IS NOT NULL OR p.mime_type LIKE 'image/%')
      AND (p.drive_file_id IS NOT NULL OR p.thumbnail_url IS NOT NULL)
      AND NOT EXISTS (
        SELECT 1
        FROM daily_log_photo_aliases AS alias
        JOIN daily_log_photos AS canonical
          ON canonical.id IS alias.canonical_photo_id
        WHERE alias.source_photo_id IS p.id
          AND alias.project_id IS p.project_id
          AND canonical.project_id IS p.project_id
          AND (canonical.thumbnail_url IS NOT NULL OR canonical.mime_type LIKE 'image/%')
          AND (canonical.drive_file_id IS NOT NULL OR canonical.thumbnail_url IS NOT NULL)
      )
  `).all())
  return new Set(
    rows.flatMap((row) => {
      const value = row.id
      return typeof value === "string" ? [value] : []
    }),
  )
}

function audiencePhotoIds(
  database: TestDatabase,
  audience: "owner" | "sub_vendor",
): ReadonlySet<string> {
  const sourceVisibility =
    audience === "owner"
      ? "p.owner_visible IS 1 OR p.public_shareable IS 1"
      : "p.sub_vendor_visible IS 1 OR p.public_shareable IS 1"
  const canonicalVisibility =
    audience === "owner"
      ? "canonical.owner_visible IS 1 OR canonical.public_shareable IS 1"
      : "canonical.sub_vendor_visible IS 1 OR canonical.public_shareable IS 1"
  const rows = sqlRows(database.prepare(`
    SELECT p.id
    FROM daily_log_photos AS p
    WHERE p.project_id IS '${projectId}'
      AND p.mime_type LIKE 'image/%'
      AND (p.drive_file_id IS NOT NULL OR p.thumbnail_url IS NOT NULL)
      AND p.review_status IS 'approved'
      AND (${sourceVisibility})
      AND NOT EXISTS (
        SELECT 1
        FROM daily_log_photo_aliases AS alias
        JOIN daily_log_photos AS canonical
          ON canonical.id IS alias.canonical_photo_id
        WHERE alias.source_photo_id IS p.id
          AND alias.project_id IS p.project_id
          AND canonical.project_id IS p.project_id
          AND canonical.mime_type LIKE 'image/%'
          AND (
            canonical.drive_file_id IS NOT NULL
            OR canonical.thumbnail_url IS NOT NULL
          )
          AND canonical.review_status IS 'approved'
          AND (${canonicalVisibility})
      )
  `).all())
  return new Set(
    rows.flatMap((row) => {
      const value = row.id
      return typeof value === "string" ? [value] : []
    }),
  )
}

function ownerWorkflowPhotoIds(database: TestDatabase): ReadonlySet<string> {
  const rows = sqlRows(database
    .prepare(`
      SELECT p.id
      FROM daily_log_photos AS p
      WHERE p.project_id IS '${projectId}'
        AND p.mime_type LIKE 'image/%'
        AND (p.drive_file_id IS NOT NULL OR p.thumbnail_url IS NOT NULL)
        AND p.review_status IS 'approved'
        AND p.owner_visible IS 1
        AND NOT EXISTS (
          SELECT 1
          FROM daily_log_photo_aliases AS alias
          JOIN daily_log_photos AS canonical
            ON canonical.id IS alias.canonical_photo_id
          WHERE alias.source_photo_id IS p.id
            AND alias.project_id IS p.project_id
            AND canonical.project_id IS p.project_id
            AND canonical.mime_type LIKE 'image/%'
            AND (
              canonical.drive_file_id IS NOT NULL
              OR canonical.thumbnail_url IS NOT NULL
            )
            AND p.daily_log_id IS canonical.daily_log_id
            AND canonical.review_status IS 'approved'
            AND canonical.owner_visible IS 1
        )
    `)
    .all())
  return new Set(
    rows.flatMap((row) => {
      const value = row.id
      return typeof value === "string" ? [value] : []
    }),
  )
}

function socialPhotoIds(database: TestDatabase): ReadonlySet<string> {
  const rows = sqlRows(database
    .prepare(`
      SELECT p.id
      FROM daily_log_photos AS p
      WHERE p.project_id IS '${projectId}'
        AND p.mime_type LIKE 'image/%'
        AND (p.drive_file_id IS NOT NULL OR p.thumbnail_url IS NOT NULL)
        AND p.review_status IS 'approved'
        AND p.public_shareable IS 1
        AND NOT EXISTS (
          SELECT 1
          FROM daily_log_photo_aliases AS alias
          JOIN daily_log_photos AS canonical
            ON canonical.id IS alias.canonical_photo_id
          WHERE alias.source_photo_id IS p.id
          AND alias.project_id IS p.project_id
          AND canonical.project_id IS p.project_id
          AND canonical.mime_type LIKE 'image/%'
          AND (
            canonical.drive_file_id IS NOT NULL
            OR canonical.thumbnail_url IS NOT NULL
          )
          AND canonical.review_status IS 'approved'
            AND canonical.public_shareable IS 1
        )
    `)
    .all())
  return new Set(
    rows.flatMap((row) => {
      const value = row.id
      return typeof value === "string" ? [value] : []
    }),
  )
}

function ownerUpdateAttachmentIds(
  database: TestDatabase,
  selectedPhotoIds: readonly string[] = [],
): ReadonlySet<string> {
  const placeholders = selectedPhotoIds.map(() => "?").join(", ")
  const selectedClause =
    selectedPhotoIds.length > 0
      ? `p.id IN (${placeholders}) OR `
      : ""
  const rows = sqlRows(
    database
      .prepare(`
        SELECT p.id
        FROM daily_log_photos AS p
        WHERE p.project_id IS ?
          AND (
            ${selectedClause}
            p.mime_type IS NULL
            OR p.mime_type NOT LIKE 'image/%'
            OR (
              (p.thumbnail_url IS NOT NULL OR p.mime_type LIKE 'image/%')
              AND (p.drive_file_id IS NOT NULL OR p.thumbnail_url IS NOT NULL)
              AND NOT EXISTS (
                SELECT 1
                FROM daily_log_photo_aliases AS alias
                JOIN daily_log_photos AS canonical
                  ON canonical.id IS alias.canonical_photo_id
                WHERE alias.source_photo_id IS p.id
                  AND alias.project_id IS p.project_id
                  AND canonical.project_id IS p.project_id
                  AND (
                    canonical.thumbnail_url IS NOT NULL
                    OR canonical.mime_type LIKE 'image/%'
                  )
                  AND (
                    canonical.drive_file_id IS NOT NULL
                    OR canonical.thumbnail_url IS NOT NULL
                  )
                  AND p.daily_log_id IS canonical.daily_log_id
                  AND canonical.review_status IS 'approved'
                  AND canonical.owner_visible IS 1
              )
            )
          )
      `)
      .all(projectId, ...selectedPhotoIds),
  )
  return new Set(
    rows.flatMap((row) => {
      const value = row.id
      return typeof value === "string" ? [value] : []
    }),
  )
}

function createScopeFixture(database: TestDatabase): void {
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE projects (id TEXT PRIMARY KEY NOT NULL);
    CREATE TABLE daily_log_photos (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
      file_name TEXT NOT NULL
    );
    INSERT INTO projects (id) VALUES ('project-1'), ('project-2');
    INSERT INTO daily_log_photos (id, project_id, file_name)
      VALUES ('photo-1', 'project-1', 'one.jpg');
    INSERT INTO daily_log_photos (id, project_id, file_name)
      VALUES ('photo-2', 'project-1', 'two.jpg');
    INSERT INTO daily_log_photos (id, project_id, file_name)
      VALUES ('photo-3', 'project-2', 'three.jpg');
  `)
  database.exec(migration)
}

describe("daily-log photo alias read model", () => {
  it("keeps certified identity and review-alert counts exact", async () => {
    const database = await openDatabase()
    try {
      createFixture(database)

      expect(
        count(
          database,
          `SELECT COUNT(*) AS value FROM daily_log_photos WHERE project_id IS '${projectId}'`,
        ),
      ).toBe(canonicalCount + aliasCount + ancillaryRowCount)
      expect(
        count(
          database,
          `SELECT COUNT(DISTINCT drive_file_id) AS value FROM daily_log_photos WHERE project_id IS '${projectId}'`,
        ),
      ).toBe(canonicalCount + aliasCount + ancillaryRowCount - 1)
      expect(
        count(
          database,
          `SELECT COUNT(*) AS value
           FROM daily_log_photos AS p
           WHERE p.project_id IS '${projectId}'
             AND p.mime_type LIKE 'image/%'
             AND (p.drive_file_id IS NOT NULL OR p.thumbnail_url IS NOT NULL)`,
        ),
      ).toBe(canonicalCount + aliasCount)
      expect(
        count(
          database,
          `SELECT COUNT(*) AS value
           FROM daily_log_photos AS p
           WHERE p.project_id IS '${projectId}'
             AND p.mime_type LIKE 'image/%'
             AND (p.drive_file_id IS NOT NULL OR p.thumbnail_url IS NOT NULL)
             AND NOT EXISTS (
               SELECT 1
               FROM daily_log_photo_aliases AS alias
               WHERE alias.source_photo_id IS p.id
                 AND alias.project_id IS p.project_id
             )`,
        ),
      ).toBe(canonicalCount)
      expect(
        count(
          database,
          `SELECT COUNT(*) AS value
           FROM daily_log_photos AS p
           WHERE p.project_id IS '${projectId}'
             AND p.review_status IS 'needs_review'`,
        ),
      ).toBe(reviewCanonicalCount + reviewAliasCount + 1)
      expect(
        count(
          database,
          `SELECT COUNT(*) AS value
           FROM daily_log_photos AS p
           WHERE p.project_id IS '${projectId}'
             AND p.review_status IS 'needs_review'
             AND p.mime_type LIKE 'image/%'
             AND (p.drive_file_id IS NOT NULL OR p.thumbnail_url IS NOT NULL)
             AND NOT EXISTS (
               SELECT 1
               FROM daily_log_photo_aliases AS alias
               WHERE alias.source_photo_id IS p.id
                 AND alias.project_id IS p.project_id
             )`,
        ),
      ).toBe(reviewCanonicalCount)
      expect(
        count(
          database,
          `SELECT COUNT(*) AS value
           FROM daily_log_photos AS p
           WHERE p.project_id IS '${projectId}'
             AND p.mime_type LIKE 'image/%'
             AND (p.drive_file_id IS NOT NULL OR p.thumbnail_url IS NOT NULL)
             AND NOT EXISTS (
               SELECT 1
               FROM daily_log_photo_aliases AS alias
               JOIN daily_log_photos AS canonical
                 ON canonical.id IS alias.canonical_photo_id
               WHERE alias.source_photo_id IS p.id
                 AND alias.project_id IS p.project_id
                 AND canonical.project_id IS p.project_id
                 AND p.daily_log_id IS canonical.daily_log_id
             )`,
        ),
      ).toBe(canonicalCount + crossContextAliasCount)
      expect(
        count(
          database,
          `SELECT COUNT(*) AS value
           FROM daily_log_photo_aliases AS alias
           JOIN daily_log_photos AS source
             ON source.id IS alias.source_photo_id
           JOIN daily_log_photos AS canonical
             ON canonical.id IS alias.canonical_photo_id
           WHERE alias.project_id IS '${projectId}'
             AND source.project_id IS alias.project_id
             AND canonical.project_id IS alias.project_id
             AND source.daily_log_id IS NOT canonical.daily_log_id`,
        ),
      ).toBe(crossContextAliasCount)
    } finally {
      database.close()
    }
  })

  it("retains an eligible source when its canonical is demoted for that audience", async () => {
    const database = await openDatabase()
    try {
      createFixture(database)

      const ownerBefore = audiencePhotoIds(database, "owner")
      const subVendorBefore = audiencePhotoIds(database, "sub_vendor")
      expect(ownerBefore.has("alias-219")).toBe(false)
      expect(subVendorBefore.has("alias-219")).toBe(false)

      database
        .prepare(
          "UPDATE daily_log_photos SET owner_visible = 0, public_shareable = 0 WHERE id = ?",
        )
        .run("canonical-219")

      const ownerAfter = audiencePhotoIds(database, "owner")
      const subVendorAfterOwnerDemotion = audiencePhotoIds(
        database,
        "sub_vendor",
      )
      expect(ownerAfter.has("alias-219")).toBe(true)
      expect(subVendorAfterOwnerDemotion.has("alias-219")).toBe(false)

      database
        .prepare(
          "UPDATE daily_log_photos SET sub_vendor_visible = 0 WHERE id = ?",
        )
        .run("canonical-219")
      expect(audiencePhotoIds(database, "sub_vendor").has("alias-219")).toBe(
        true,
      )
      expect(
        count(
          database,
          "SELECT COUNT(*) AS value FROM daily_log_photos WHERE id IS 'alias-219'",
        ),
      ).toBe(1)
    } finally {
      database.close()
    }
  })

  it("retains an eligible source when its canonical loses renderable media", async () => {
    const database = await openDatabase()
    try {
      createFixture(database)

      expect(aggregatePhotoIds(database).has("alias-219")).toBe(false)
      database
        .prepare(
          "UPDATE daily_log_photos SET drive_file_id = NULL, thumbnail_url = NULL WHERE id = ?",
        )
        .run("canonical-219")

      expect(aggregatePhotoIds(database).has("alias-219")).toBe(true)
      expect(audiencePhotoIds(database, "owner").has("alias-219")).toBe(true)
      expect(socialPhotoIds(database).has("alias-219")).toBe(true)
    } finally {
      database.close()
    }
  })

  it("treats a thumbnail-only canonical as renderable for alias suppression", async () => {
    const database = await openDatabase()
    try {
      createFixture(database)

      database
        .prepare(
          "UPDATE daily_log_photos SET mime_type = NULL, thumbnail_url = ? WHERE id = ?",
        )
        .run("/thumbnail/canonical-0", "canonical-0")

      const photoIds = thumbnailAwareAggregatePhotoIds(database)
      expect(photoIds.has("canonical-0")).toBe(true)
      expect(photoIds.has("alias-0")).toBe(false)
    } finally {
      database.close()
    }
  })

  it("keeps owner workflow sources when a same-context canonical is demoted", async () => {
    const database = await openDatabase()
    try {
      createFixture(database)

      expect(ownerWorkflowPhotoIds(database).has("alias-150")).toBe(false)
      database
        .prepare(
          "UPDATE daily_log_photos SET owner_visible = 0 WHERE id = ?",
        )
        .run("canonical-150")
      expect(ownerWorkflowPhotoIds(database).has("alias-150")).toBe(true)

      database
        .prepare(
          "UPDATE daily_log_photos SET owner_visible = 1, review_status = ? WHERE id = ?",
        )
        .run("needs_review", "canonical-150")
      expect(ownerWorkflowPhotoIds(database).has("alias-150")).toBe(true)
    } finally {
      database.close()
    }
  })

  it("retains a public source when its social canonical is demoted", async () => {
    const database = await openDatabase()
    try {
      createFixture(database)

      expect(socialPhotoIds(database).has("alias-219")).toBe(false)
      database
        .prepare(
          "UPDATE daily_log_photos SET public_shareable = 0 WHERE id = ?",
        )
        .run("canonical-219")
      expect(socialPhotoIds(database).has("alias-219")).toBe(true)

      database
        .prepare(
          "UPDATE daily_log_photos SET public_shareable = 1, review_status = ? WHERE id = ?",
        )
        .run("needs_review", "canonical-219")
      expect(socialPhotoIds(database).has("alias-219")).toBe(true)
    } finally {
      database.close()
    }
  })

  it("keeps ordinary documents selectable while deduping owner-update photos", async () => {
    const database = await openDatabase()
    try {
      createFixture(database)

      const attachments = ownerUpdateAttachmentIds(database)
      expect(attachments.has("ancillary-zip")).toBe(true)
      expect(attachments.has("ancillary-folder")).toBe(true)
      expect(attachments.has("ancillary-pdf")).toBe(true)
      expect(attachments.has("ancillary-staged")).toBe(false)
      expect(attachments.has("alias-150")).toBe(false)
      expect(attachments.has("canonical-150")).toBe(true)

      const selected = ownerUpdateAttachmentIds(database, ["alias-150"])
      expect(selected.has("alias-150")).toBe(true)
    } finally {
      database.close()
    }
  })

  it("rejects cross-project alias inserts, updates, and photo moves", async () => {
    const database = await openDatabase()
    try {
      createScopeFixture(database)
      const insertAlias = database.prepare(
        "INSERT INTO daily_log_photo_aliases (source_photo_id, canonical_photo_id, project_id, content_sha256, content_size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      const createdAt = "2026-08-31T00:00:00.000Z"
      expect(() =>
        insertAlias.run(
          "photo-1",
          "photo-2",
          "project-1",
          sha256,
          1,
          createdAt,
        ),
      ).not.toThrow()
      expect(() =>
        insertAlias.run(
          "photo-1",
          "photo-2",
          "project-2",
          sha256,
          1,
          createdAt,
        ),
      ).toThrow()
      expect(() =>
        insertAlias.run(
          "photo-1",
          "photo-3",
          "project-1",
          sha256,
          1,
          createdAt,
        ),
      ).toThrow()
      expect(() =>
        insertAlias.run(
          "photo-3",
          "photo-1",
          "project-1",
          sha256,
          1,
          createdAt,
        ),
      ).toThrow()
      expect(() =>
        database
          .prepare(
            "UPDATE daily_log_photo_aliases SET canonical_photo_id = ? WHERE source_photo_id = ?",
          )
          .run("photo-3", "photo-1"),
      ).toThrow()
      expect(() =>
        database
          .prepare(
            "UPDATE daily_log_photo_aliases SET source_photo_id = ? WHERE source_photo_id = ?",
          )
          .run("photo-3", "photo-1"),
      ).toThrow()
      expect(() =>
        database
          .prepare(
            "UPDATE daily_log_photo_aliases SET project_id = ? WHERE source_photo_id = ?",
          )
          .run("project-2", "photo-1"),
      ).toThrow()
      expect(() =>
        database
          .prepare("UPDATE daily_log_photos SET project_id = ? WHERE id = ?")
          .run("project-2", "photo-1"),
      ).toThrow()
      expect(() =>
        database
          .prepare("UPDATE daily_log_photos SET project_id = ? WHERE id = ?")
          .run("project-2", "photo-2"),
      ).toThrow()
    } finally {
      database.close()
    }
  })
})
