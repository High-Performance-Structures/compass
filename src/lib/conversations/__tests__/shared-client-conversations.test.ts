import Database from "better-sqlite3"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it } from "vitest"

import { drizzleOverSqlite } from "../../../../__tests__/helpers/correspondence-core"
import { removeLostJobConversationAccess, shareClientConversations } from "../shared-client-conversations"

/*
 * Clients on the same job share its client conversations: a co-owner joins
 * the threads and emails that came through the other client. Vendors, other
 * jobs, staff-only jobs and inactive accounts are left alone. Checked against
 * a database built from every migration, with D1's 100-parameter limit.
 */

type Sqlite = InstanceType<typeof Database>

const NOW = "2026-11-13T00:00:00.000Z"
const ORG = "org-1"

function migrated(): Sqlite {
  const sqlite = new Database(":memory:")
  const dir = join(process.cwd(), "drizzle")
  for (const file of readdirSync(dir).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort()) {
    sqlite.exec(readFileSync(join(dir, file), "utf8").replaceAll("--> statement-breakpoint", ""))
  }
  sqlite.exec("PRAGMA foreign_keys = ON")
  return sqlite
}

function channel(sqlite: Sqlite, id: string, projectId: string, audience: string, imported: boolean, archived = false): void {
  sqlite.exec(`
    INSERT INTO channels (id, name, type, organization_id, project_id, is_private, audience, created_by, sort_order, created_at, updated_at, archived_at, source_system, source_thread_id)
      VALUES ('${id}', '${id}', 'text', '${ORG}', '${projectId}', 1, '${audience}', 'staff', 0, '${NOW}', '${NOW}', ${archived ? `'${NOW}'` : "NULL"}, ${imported ? "'buildertrend'" : "NULL"}, ${imported ? `'thread-${id}'` : "NULL"});
  `)
}

function member(sqlite: Sqlite, channelId: string, userId: string): void {
  sqlite.exec(`INSERT INTO channel_members (id, channel_id, user_id, role, notify_level, joined_at) VALUES ('m-${channelId}-${userId}', '${channelId}', '${userId}', 'member', 'all', '${NOW}')`)
}

function memberships(sqlite: Sqlite, userId: string): readonly string[] {
  return sqlite
    .prepare(`SELECT channel_id AS id FROM channel_members WHERE user_id = ? ORDER BY channel_id`)
    .all(userId)
    .flatMap((row) => (row !== null && typeof row === "object" && "id" in row && typeof row.id === "string" ? [row.id] : []))
}

function count(sqlite: Sqlite, query: string): number {
  const row = sqlite.prepare(query).get()
  return row !== null && typeof row === "object" && "n" in row && typeof row.n === "number" ? row.n : -1
}

describe("shareClientConversations", () => {
  let sqlite: Sqlite
  beforeEach(() => {
    sqlite = migrated()
    sqlite.exec(`
      INSERT INTO organizations (id, name, slug, type, is_active, created_at, updated_at) VALUES ('${ORG}', 'Org', 'org', 'internal', 1, '${NOW}', '${NOW}');
      INSERT INTO users (id, email, role, is_active, created_at, updated_at) VALUES
        ('staff', 'pm@example.com', 'project_manager', 1, '${NOW}', '${NOW}'),
        ('alan', 'alan@example.com', 'client', 1, '${NOW}', '${NOW}'),
        ('deb', 'deb@example.com', 'client', 1, '${NOW}', '${NOW}'),
        ('gone', 'gone@example.com', 'client', 0, '${NOW}', '${NOW}'),
        ('sub', 'sub@example.com', 'subcontractor', 1, '${NOW}', '${NOW}'),
        ('other', 'other@example.com', 'client', 1, '${NOW}', '${NOW}');
      INSERT INTO projects (id, name, organization_id, created_at, imported_conversations_staff_only) VALUES
        ('job', 'Loeffler', '${ORG}', '${NOW}', 0), ('hold', 'Hold', '${ORG}', '${NOW}', 1), ('elsewhere', 'Elsewhere', '${ORG}', '${NOW}', 0);
      INSERT INTO project_members (id, project_id, user_id, role, assigned_at) VALUES
        ('pm1', 'job', 'alan', 'client', '${NOW}'), ('pm2', 'job', 'deb', 'client', '${NOW}'), ('pm3', 'job', 'gone', 'client', '${NOW}'),
        ('pm4', 'job', 'sub', 'subcontractor', '${NOW}'), ('pm5', 'job', 'staff', 'manager', '${NOW}'),
        ('pm6', 'hold', 'alan', 'client', '${NOW}'), ('pm7', 'hold', 'deb', 'client', '${NOW}'),
        ('pm8', 'elsewhere', 'other', 'client', '${NOW}');
    `)
    // ~160 Buildertrend threads that only Alan was part of, as on the Loeffler job.
    for (let index = 0; index < 160; index += 1) {
      channel(sqlite, `bt-${String(index).padStart(3, "0")}`, "job", "clients", true)
      member(sqlite, `bt-${String(index).padStart(3, "0")}`, "alan")
    }
    channel(sqlite, "email-from-alan", "job", "clients", false)
    member(sqlite, "email-from-alan", "alan")
    channel(sqlite, "archived", "job", "clients", true, true)
    channel(sqlite, "vendor-thread", "job", "sub_vendors", true)
    channel(sqlite, "staff-thread", "job", "staff", true)
    channel(sqlite, "hold-thread", "hold", "clients", true)
    member(sqlite, "hold-thread", "alan")
    channel(sqlite, "elsewhere-thread", "elsewhere", "clients", true)
  })

  it("joins a co-owner to every client conversation on the job, quietly", async () => {
    const added = await shareClientConversations({ db: drizzleOverSqlite(sqlite, { bindLimit: 100 }), organizationId: ORG, projectId: "job", now: NOW })

    expect(added).toBe(161)
    expect(memberships(sqlite, "deb")).toHaveLength(161)
    expect(memberships(sqlite, "deb")).toContain("email-from-alan")
    expect(memberships(sqlite, "deb")).not.toContain("archived")
    expect(count(sqlite, "SELECT COUNT(*) AS n FROM channel_read_state WHERE user_id = 'deb' AND unread_count = 0")).toBe(161)
    expect(count(sqlite, "SELECT COUNT(*) AS n FROM notification_events")).toBe(0)
    // Vendors, inactive accounts, staff and other jobs are untouched.
    expect(memberships(sqlite, "sub")).toEqual([])
    expect(memberships(sqlite, "gone")).toEqual([])
    expect(memberships(sqlite, "staff")).toEqual([])
    expect(memberships(sqlite, "other")).toEqual([])

    // Running it again adds nothing.
    expect(await shareClientConversations({ db: drizzleOverSqlite(sqlite, { bindLimit: 100 }), organizationId: ORG, projectId: "job", now: NOW })).toBe(0)
  })

  it("keeps imported threads on a staff-only job closed to the other client", async () => {
    await shareClientConversations({ db: drizzleOverSqlite(sqlite, { bindLimit: 100 }), organizationId: ORG, projectId: null, now: NOW })
    expect(memberships(sqlite, "deb")).not.toContain("hold-thread")
    expect(memberships(sqlite, "deb")).toHaveLength(161)
    expect(memberships(sqlite, "other")).toEqual(["elsewhere-thread"])
  })

  it("does nothing when the company turns sharing off", async () => {
    sqlite.exec(`INSERT INTO organization_feature_settings (organization_id, feature_key, value, updated_at) VALUES ('${ORG}', 'client-conversations', '{"shareAmongClients":false}', '${NOW}')`)
    expect(await shareClientConversations({ db: drizzleOverSqlite(sqlite), organizationId: ORG, projectId: null, now: NOW })).toBe(0)
    expect(memberships(sqlite, "deb")).toEqual([])
  })

  it("takes a removed client out of every client conversation on that job only", async () => {
    await shareClientConversations({ db: drizzleOverSqlite(sqlite, { bindLimit: 100 }), organizationId: ORG, projectId: null, now: NOW })
    member(sqlite, "vendor-thread", "sub")
    member(sqlite, "vendor-thread", "staff")
    member(sqlite, "bt-000", "staff")
    // Staff remove Deborah from the job; her membership row is gone.
    sqlite.exec("DELETE FROM project_members WHERE project_id = 'job' AND user_id = 'deb'")

    const removed = await removeLostJobConversationAccess({
      db: drizzleOverSqlite(sqlite, { bindLimit: 100 }), organizationId: ORG, projectId: "job", userIds: ["deb", "alan", "sub", "staff"],
    })

    expect(removed).toBe(161)
    expect(memberships(sqlite, "deb")).toEqual([])
    expect(count(sqlite, "SELECT COUNT(*) AS n FROM channel_read_state WHERE user_id = 'deb'")).toBe(0)
    // Alan and the vendor are still on the job; staff are never removed; the other job is untouched.
    expect(memberships(sqlite, "alan")).toHaveLength(162)
    expect(memberships(sqlite, "sub")).toEqual(["vendor-thread"])
    expect(memberships(sqlite, "staff")).toEqual(["bt-000", "vendor-thread"])
  })

  it("takes an archived person out of every job's conversations", async () => {
    sqlite.exec("DELETE FROM project_members WHERE user_id = 'alan'")
    const removed = await removeLostJobConversationAccess({ db: drizzleOverSqlite(sqlite), organizationId: ORG, projectId: null, userIds: ["alan"] })
    expect(removed).toBe(162)
    expect(memberships(sqlite, "alan")).toEqual([])
  })
})
