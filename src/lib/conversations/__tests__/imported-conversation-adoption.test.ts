import Database from "better-sqlite3"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it } from "vitest"

import { drizzleOverSqlite } from "../../../../__tests__/helpers/correspondence-core"
import { adoptImportedConversationsForContact } from "../imported-conversation-adoption"

/*
 * When a directory contact from imported (Buildertrend) threads is given
 * Compass access, they join those threads and their messages move onto their
 * account, silently. Checked against a database built from every migration.
 */

type Sqlite = InstanceType<typeof Database>

const NOW = "2026-11-01T00:00:00.000Z"
const ORG = "org-1"
const STAFF = "user-staff"
const OWNER = "user-owner"

function migrated(): Sqlite {
  const sqlite = new Database(":memory:")
  const dir = join(process.cwd(), "drizzle")
  for (const file of readdirSync(dir).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort()) {
    sqlite.exec(readFileSync(join(dir, file), "utf8").replaceAll("--> statement-breakpoint", ""))
  }
  sqlite.exec("PRAGMA foreign_keys = ON")
  return sqlite
}

function seedProject(sqlite: Sqlite, projectId: string, staffOnly: boolean): void {
  sqlite.exec(`
    INSERT INTO projects (id, name, organization_id, created_at, imported_conversations_staff_only) VALUES ('${projectId}', '${projectId}', '${ORG}', '${NOW}', ${staffOnly ? 1 : 0});
    INSERT INTO project_contacts (id, project_id, contact_type, source_system, display_name, created_at, updated_at) VALUES ('contact-${projectId}', '${projectId}', 'owner', 'buildertrend', 'Oscar Owner', '${NOW}', '${NOW}');
    INSERT INTO channels (id, name, type, organization_id, project_id, is_private, audience, created_by, sort_order, created_at, updated_at, source_system, source_thread_id)
      VALUES ('chan-${projectId}', 'Kitchen tile', 'text', '${ORG}', '${projectId}', 1, 'clients', '${STAFF}', 0, '${NOW}', '${NOW}', 'buildertrend', 'thread-${projectId}');
    INSERT INTO project_source_record_participants (id, organization_id, project_id, source_record_type, source_record_id, source_participant_id, participant_role, project_contact_id, identity_status, membership_status, review_status, active, created_at, updated_at)
      VALUES ('psrp-${projectId}', '${ORG}', '${projectId}', 'buildertrend_message_thread', 'thread-${projectId}', 'owner:3', 'owner', 'contact-${projectId}', 'matched', 'active', 'reviewed', 1, '${NOW}', '${NOW}');
    INSERT INTO messages (id, channel_id, user_id, content, is_pinned, reply_count, created_at, source_system, source_message_id, imported_sender_contact_id)
      VALUES ('msg-${projectId}', 'chan-${projectId}', '${STAFF}', 'Is the tile in?', 0, 0, '2025-10-03T22:12:00.000Z', 'buildertrend', 'bt-${projectId}', 'contact-${projectId}');
  `)
}

function rows(sqlite: Sqlite, query: string): readonly Record<string, unknown>[] {
  return sqlite.prepare(query).all().filter((row): row is Record<string, unknown> => row !== null && typeof row === "object")
}

describe("adoptImportedConversationsForContact", () => {
  let sqlite: Sqlite
  beforeEach(() => {
    sqlite = migrated()
    sqlite.exec(`
      INSERT INTO organizations (id, name, slug, type, is_active, created_at, updated_at) VALUES ('${ORG}', 'Org', 'org', 'internal', 1, '${NOW}', '${NOW}');
      INSERT INTO users (id, email, role, is_active, created_at, updated_at) VALUES ('${STAFF}', 'pm@example.com', 'project_manager', 1, '${NOW}', '${NOW}'), ('${OWNER}', 'owner@example.com', 'client', 1, '${NOW}', '${NOW}');
    `)
    seedProject(sqlite, "proj-open", false)
    seedProject(sqlite, "proj-hold", true)
  })

  it("joins the new account to its threads and moves its messages onto it, silently", async () => {
    const joined = await adoptImportedConversationsForContact({
      db: drizzleOverSqlite(sqlite), projectId: "proj-open", projectContactId: "contact-proj-open", userId: OWNER, audience: "owner", now: NOW,
    })
    expect(joined).toEqual(["chan-proj-open"])
    expect(rows(sqlite, `SELECT channel_id FROM channel_members WHERE user_id = '${OWNER}'`)).toEqual([{ channel_id: "chan-proj-open" }])
    expect(rows(sqlite, `SELECT unread_count FROM channel_read_state WHERE user_id = '${OWNER}'`)).toEqual([{ unread_count: 0 }])
    expect(rows(sqlite, `SELECT user_id, imported_sender_contact_id FROM messages WHERE id = 'msg-proj-open'`)).toEqual([{ user_id: OWNER, imported_sender_contact_id: null }])
    expect(rows(sqlite, "SELECT COUNT(*) AS n FROM notification_events")).toEqual([{ n: 0 }])
    // Running it again changes nothing.
    await adoptImportedConversationsForContact({
      db: drizzleOverSqlite(sqlite), projectId: "proj-open", projectContactId: "contact-proj-open", userId: OWNER, audience: "owner", now: NOW,
    })
    expect(rows(sqlite, `SELECT COUNT(*) AS n FROM channel_members WHERE user_id = '${OWNER}'`)).toEqual([{ n: 1 }])
  })

  it("adds nobody on a staff-only project", async () => {
    const joined = await adoptImportedConversationsForContact({
      db: drizzleOverSqlite(sqlite), projectId: "proj-hold", projectContactId: "contact-proj-hold", userId: OWNER, audience: "owner", now: NOW,
    })
    expect(joined).toEqual([])
    expect(rows(sqlite, `SELECT COUNT(*) AS n FROM channel_members WHERE user_id = '${OWNER}'`)).toEqual([{ n: 0 }])
    expect(rows(sqlite, `SELECT user_id FROM messages WHERE id = 'msg-proj-hold'`)).toEqual([{ user_id: STAFF }])
  })

  it("does not join an owner thread through a vendor invitation", async () => {
    const joined = await adoptImportedConversationsForContact({
      db: drizzleOverSqlite(sqlite), projectId: "proj-open", projectContactId: "contact-proj-open", userId: OWNER, audience: "sub_vendor", now: NOW,
    })
    expect(joined).toEqual([])
    expect(rows(sqlite, `SELECT COUNT(*) AS n FROM channel_members WHERE user_id = '${OWNER}'`)).toEqual([{ n: 0 }])
  })
})
