import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { DatabaseSync } from "node:sqlite"
import { describe, expect, it } from "vitest"

type Manifest = {
  readonly schemaVersion: 1
  readonly reviewDecision: "owner_visible"
  readonly projectId: string
  readonly buildertrendJobId: string
  readonly reviewedAt: string
  readonly reviewedBy: string
  readonly sourceMessageIds: readonly string[]
}

const scriptPath = resolve(
  process.cwd(),
  "scripts/build-buildertrend-owner-history-promotion.mjs"
)

function reviewManifest(
  overrides: Partial<Manifest> = {}
): Manifest {
  return {
    schemaVersion: 1,
    reviewDecision: "owner_visible",
    projectId: "project-a",
    buildertrendJobId: "job-a",
    reviewedAt: "2026-07-30T18:00:00.000Z",
    reviewedBy: "privacy-reviewer@example.com",
    sourceMessageIds: ["bt-message-job-a-reviewed-1"],
    ...overrides,
  }
}

async function generateSql(manifest: Manifest): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "compass-bt-promotion-"))
  const manifestPath = join(directory, "review.json")
  const outputPath = join(directory, "promotion.sql")
  await writeFile(manifestPath, JSON.stringify(manifest), "utf8")

  const result = spawnSync(
    process.execPath,
    [scriptPath, outputPath, manifestPath],
    { encoding: "utf8" }
  )
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout)
  }
  return readFile(outputPath, "utf8")
}

function createPromotionDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:")
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE channels (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      project_id TEXT,
      audience TEXT NOT NULL
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      thread_id TEXT,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      content_html TEXT,
      edited_at TEXT,
      deleted_at TEXT,
      deleted_by TEXT,
      is_pinned INTEGER NOT NULL DEFAULT 0,
      reply_count INTEGER NOT NULL DEFAULT 0,
      last_reply_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL
    );
    CREATE TABLE channel_read_state (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      unread_count INTEGER NOT NULL
    );
  `)
  return db
}

function insertMessage(
  db: DatabaseSync,
  input: {
    readonly id: string
    readonly channelId: string
    readonly content: string
  }
): void {
  db.prepare(
    `INSERT INTO messages (
      id, channel_id, user_id, content, content_html, created_at
    ) VALUES (?, ?, 'archive-user', ?, NULL, '2026-07-01T00:00:00.000Z')`
  ).run(input.id, input.channelId, input.content)
}

describe("Buildertrend owner-history promotion", () => {
  it("promotes reviewed IDs only and removes earlier ambiguous promotions", async () => {
    const db = createPromotionDb()
    db.exec(`
      INSERT INTO channels VALUES
        ('bt-message-archive-job-a', 'org-a', 'project-a', 'organization'),
        ('project-owner-project-a', 'org-a', 'project-a', 'clients');
      INSERT INTO notifications VALUES ('existing-notice', 'owner-a');
      INSERT INTO channel_read_state VALUES
        ('existing-read', 'owner-a', 'project-owner-project-a', 2);
    `)
    insertMessage(db, {
      id: "bt-message-job-a-reviewed-1",
      channelId: "bt-message-archive-job-a",
      content: "Reviewed owner history",
    })
    insertMessage(db, {
      id: "bt-message-job-a-ambiguous-2",
      channelId: "bt-message-archive-job-a",
      content: "An owner name appearing here is not authorization",
    })
    insertMessage(db, {
      id: "bt-owner-history-job-a-ambiguous-2",
      channelId: "project-owner-project-a",
      content: "Previously promoted by unsafe text matching",
    })

    db.exec(await generateSql(reviewManifest()))

    const ownerMessages = db
      .prepare(
        "SELECT id, content FROM messages WHERE channel_id = ? ORDER BY id"
      )
      .all("project-owner-project-a")
    expect(ownerMessages).toEqual([
      {
        id: "bt-owner-history-job-a-reviewed-1",
        content: "Reviewed owner history",
      },
    ])
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM notifications").get()
    ).toEqual({ count: 1 })
    expect(
      db.prepare("SELECT unread_count FROM channel_read_state").get()
    ).toEqual({ unread_count: 2 })
  })

  it("fails closed when either channel is outside the reviewed project", async () => {
    const scenarios = [
      {
        archiveProjectId: "project-b",
        ownerProjectId: "project-a",
        archiveAudience: "organization",
      },
      {
        archiveProjectId: "project-a",
        ownerProjectId: "project-b",
        archiveAudience: "organization",
      },
      {
        archiveProjectId: "project-a",
        ownerProjectId: "project-a",
        archiveAudience: "clients",
      },
    ]

    for (const scenario of scenarios) {
      const db = createPromotionDb()
      db.prepare("INSERT INTO channels VALUES (?, ?, ?, ?)").run(
        "bt-message-archive-job-a",
        "org-a",
        scenario.archiveProjectId,
        scenario.archiveAudience
      )
      db.prepare("INSERT INTO channels VALUES (?, ?, ?, ?)").run(
        "project-owner-project-a",
        "org-a",
        scenario.ownerProjectId,
        "clients"
      )
      insertMessage(db, {
        id: "bt-message-job-a-reviewed-1",
        channelId: "bt-message-archive-job-a",
        content: "Must stay quarantined",
      })

      db.exec(await generateSql(reviewManifest()))

      expect(
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM messages WHERE channel_id = ?"
          )
          .get("project-owner-project-a")
      ).toEqual({ count: 0 })
      db.close()
    }
  })

  it("does not overwrite an ID collision in another channel", async () => {
    const db = createPromotionDb()
    db.exec(`
      INSERT INTO channels VALUES
        ('bt-message-archive-job-a', 'org-a', 'project-a', 'organization'),
        ('project-owner-project-a', 'org-a', 'project-a', 'clients'),
        ('unrelated-channel', 'org-b', 'project-b', 'organization');
    `)
    insertMessage(db, {
      id: "bt-message-job-a-reviewed-1",
      channelId: "bt-message-archive-job-a",
      content: "Reviewed source",
    })
    insertMessage(db, {
      id: "bt-owner-history-job-a-reviewed-1",
      channelId: "unrelated-channel",
      content: "Unrelated content",
    })

    db.exec(await generateSql(reviewManifest()))

    expect(
      db
        .prepare("SELECT channel_id, content FROM messages WHERE id = ?")
        .get("bt-owner-history-job-a-reviewed-1")
    ).toEqual({
      channel_id: "unrelated-channel",
      content: "Unrelated content",
    })
  })

  it("accepts an empty reviewed set to quarantine every historical row", async () => {
    const db = createPromotionDb()
    db.exec(`
      INSERT INTO channels VALUES
        ('bt-message-archive-job-a', 'org-a', 'project-a', 'organization'),
        ('project-owner-project-a', 'org-a', 'project-a', 'clients');
    `)
    insertMessage(db, {
      id: "bt-message-job-a-ambiguous-1",
      channelId: "bt-message-archive-job-a",
      content: "Archive only",
    })
    insertMessage(db, {
      id: "bt-owner-history-job-a-ambiguous-1",
      channelId: "project-owner-project-a",
      content: "Previously promoted",
    })

    db.exec(
      await generateSql(reviewManifest({ sourceMessageIds: [] }))
    )

    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM messages WHERE channel_id = ?"
        )
        .get("project-owner-project-a")
    ).toEqual({ count: 0 })
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM messages WHERE channel_id = ?"
        )
        .get("bt-message-archive-job-a")
    ).toEqual({ count: 1 })
  })

  it("rejects source IDs that do not belong to the reviewed Buildertrend job", async () => {
    await expect(
      generateSql(
        reviewManifest({
          sourceMessageIds: ["bt-message-job-b-message-1"],
        })
      )
    ).rejects.toThrow("must identify a message from Buildertrend job job-a")
  })

  it("rejects the retired free-text participant invocation", async () => {
    const result = spawnSync(
      process.execPath,
      [
        scriptPath,
        "promotion.sql",
        "project-a",
        "job-a",
        "owner-name",
      ],
      { encoding: "utf8" }
    )

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("<review-manifest.json>")
  })

  it("generates no text matching or notification/unread mutations", async () => {
    const sql = await generateSql(reviewManifest())

    expect(sql).not.toMatch(/source\.content\).*LIKE/i)
    expect(sql).not.toMatch(/INSERT INTO (?:notifications|message_mentions)/i)
    expect(sql).not.toMatch(/UPDATE channel_read_state/i)
    expect(sql).toContain("'bt-message-job-a-reviewed-1'")
    expect(sql).toContain("archive_channel.audience = 'organization'")
    expect(sql).toContain("target_channel.project_id = 'project-a'")
    expect(sql).toContain(
      "target_channel.organization_id = archive_channel.organization_id"
    )
  })
})
