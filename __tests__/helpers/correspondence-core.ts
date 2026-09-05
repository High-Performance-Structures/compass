import Database from "better-sqlite3"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { getDb } from "@/db"
import type { CorrespondenceContext } from "@/lib/correspondence/access"

type Sqlite = InstanceType<typeof Database>

type D1Result = {
  readonly results: readonly unknown[]
  readonly success: true
  readonly meta: {
    readonly duration: number
    readonly changes: number
    readonly last_row_id: number
    readonly rows_read: number
    readonly rows_written: number
  }
}

type FailureController = {
  failNextMatching: (needle: string) => void
  setBindLimit: (limit: number | null) => void
  setBeforeBatchHook: (hook: ((sqlite: Sqlite) => void) | null) => void
}

type TestD1 = {
  readonly prepare: (query: string) => TestStatement
  readonly batch: (statements: readonly TestStatement[]) => Promise<readonly D1Result[]>
  readonly exec: (query: string) => Promise<D1Result>
  readonly withSession: () => TestD1
  readonly dump: () => Promise<ArrayBuffer>
}

type TestStatement = {
  readonly bind: (...values: readonly unknown[]) => TestStatement
  readonly all: () => Promise<{ readonly results: readonly unknown[] }>
  readonly first: () => Promise<unknown | null>
  readonly raw: () => Promise<readonly unknown[]>
  readonly run: () => Promise<D1Result>
}

function sqliteValue(value: unknown): string | number | Uint8Array | null {
  if (typeof value === "string" || typeof value === "number" || value instanceof Uint8Array || value === null) return value
  if (typeof value === "boolean") return value ? 1 : 0
  return String(value)
}

function createD1(sqlite: Sqlite, controller: FailureController): TestD1 {
  let bindLimit: number | null = null
  let beforeBatchHook: ((sqlite: Sqlite) => void) | null = null

  function statementFor(query: string, values: readonly unknown[] = []): TestStatement {
    const execute = (): ReturnType<Sqlite["prepare"]> => sqlite.prepare(query)
    const shouldFail = (): void => {
      const normalized = query.toLowerCase()
      const needle = failureNeedle
      if (needle !== null && normalized.includes(needle.toLowerCase())) {
        failureNeedle = null
        throw new Error("simulated D1 batch failure")
      }
    }
    const statement: TestStatement = {
      bind: (...nextValues) => {
        if (bindLimit !== null && nextValues.length > bindLimit) throw new Error(`simulated D1 bind limit (${nextValues.length} > ${bindLimit})`)
        return statementFor(query, nextValues)
      },
      all: async () => {
        shouldFail()
        return { results: execute().all(...values.map(sqliteValue)) }
      },
      first: async () => {
        shouldFail()
        return execute().get(...values.map(sqliteValue)) ?? null
      },
      raw: async () => {
        shouldFail()
        return execute().raw(true).all(...values.map(sqliteValue))
      },
      run: async () => {
        shouldFail()
        const result = execute().run(...values.map(sqliteValue))
        return {
          results: [],
          success: true,
          meta: {
            duration: 0,
            changes: Number(result.changes),
            last_row_id: Number(result.lastInsertRowid),
            rows_read: 0,
            rows_written: Number(result.changes),
          },
        }
      },
    }
    return statement
  }

  let failureNeedle: string | null = null
  controller.failNextMatching = (needle) => {
    failureNeedle = needle
  }
  controller.setBindLimit = (limit) => {
    bindLimit = limit
  }
  controller.setBeforeBatchHook = (hook) => {
    beforeBatchHook = hook
  }
  const adapter: TestD1 = {
    prepare: (query) => statementFor(query),
    batch: async (statements) => {
      beforeBatchHook?.(sqlite)
      sqlite.exec("SAVEPOINT correspondence_test_batch")
      try {
        const results: D1Result[] = []
        for (const statement of statements) results.push(await statement.run())
        sqlite.exec("RELEASE SAVEPOINT correspondence_test_batch")
        return results
      } catch (error) {
        sqlite.exec("ROLLBACK TO SAVEPOINT correspondence_test_batch")
        sqlite.exec("RELEASE SAVEPOINT correspondence_test_batch")
        throw error
      }
    },
    exec: async (query) => {
      sqlite.exec(query)
      return { results: [], success: true, meta: { duration: 0, changes: 0, last_row_id: 0, rows_read: 0, rows_written: 0 } }
    },
    withSession: () => adapter,
    dump: async () => new ArrayBuffer(0),
  }
  return adapter
}

function createBaseSchema(sqlite: Sqlite): void {
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE organizations (
      id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, slug TEXT NOT NULL,
      type TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT '2026-09-05T12:00:00.000Z',
      updated_at TEXT NOT NULL DEFAULT '2026-09-05T12:00:00.000Z'
    );
    CREATE TABLE users (
      id TEXT PRIMARY KEY NOT NULL, email TEXT NOT NULL, first_name TEXT,
      last_name TEXT, display_name TEXT, role TEXT NOT NULL, is_active INTEGER NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE projects (
      id TEXT PRIMARY KEY NOT NULL, organization_id TEXT, name TEXT NOT NULL,
      project_number TEXT, FOREIGN KEY (organization_id) REFERENCES organizations(id)
    );
    CREATE TABLE organization_members (
      id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL,
      user_id TEXT NOT NULL, role TEXT NOT NULL, joined_at TEXT NOT NULL
    );
    CREATE TABLE project_members (
      id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL,
      user_id TEXT NOT NULL, role TEXT NOT NULL, assigned_at TEXT NOT NULL
    );
    CREATE TABLE project_contacts (
      id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL, contact_type TEXT NOT NULL,
      source_entity_type TEXT, source_entity_id TEXT, display_name TEXT NOT NULL,
      email TEXT, role TEXT, trade TEXT, csi_division TEXT, csi_division_name TEXT,
      phone TEXT, company_name TEXT, primary_contact INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1, owner_portal_visible INTEGER NOT NULL DEFAULT 0,
      sub_vendor_portal_visible INTEGER NOT NULL DEFAULT 0, internal_visible INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
  `)
  const migration = readFileSync(resolve(process.cwd(), "drizzle/0151_project_correspondence.sql"), "utf8")
  sqlite.exec(migration.replaceAll("--> statement-breakpoint", ""))
}

function seedBase(sqlite: Sqlite): void {
  const now = "2026-09-05T12:00:00.000Z"
  sqlite.exec(`
    INSERT INTO organizations (id,name,slug,type) VALUES ('org-a','A','org-a','internal'),('org-b','B','org-b','client');
    INSERT INTO users (id,email,first_name,last_name,display_name,role,is_active,created_at,updated_at) VALUES
      ('staff-a','staff-a@example.test','Staff','A','Staff A','admin',1,'${now}','${now}'),
      ('owner-a','owner-a@example.test','Owner','A','Owner A','client',1,'${now}','${now}'),
      ('staff-b','staff-b@example.test','Staff','B','Staff B','admin',1,'${now}','${now}'),
      ('owner-b','owner-b@example.test','Owner','B','Owner B','client',1,'${now}','${now}'),
      ('revoked-a','revoked-a@example.test','Revoked','A','Revoked A','admin',1,'${now}','${now}');
    INSERT INTO projects (id,organization_id,name,project_number) VALUES
      ('project-a','org-a','Project A','A-1'),('project-b','org-a','Project B','A-2'),('project-other','org-b','Other','B-1');
    INSERT INTO organization_members (id,organization_id,user_id,role,joined_at) VALUES
      ('om-staff-a','org-a','staff-a','admin','${now}'),('om-owner-a','org-a','owner-a','client','${now}'),
      ('om-staff-b','org-b','staff-b','admin','${now}'),('om-owner-b','org-b','owner-b','client','${now}'),
      ('om-revoked-a','org-a','revoked-a','admin','${now}');
    INSERT INTO project_members (id,project_id,user_id,role,assigned_at) VALUES
      ('pm-staff-a','project-a','staff-a','staff','${now}'),('pm-owner-a','project-a','owner-a','owner','${now}'),
      ('pm-staff-b','project-other','staff-b','staff','${now}'),('pm-owner-b','project-other','owner-b','owner','${now}'),
      ('pm-revoked-a','project-a','revoked-a','staff','${now}');
  `)
}

export type CorrespondenceTestDatabase = {
  readonly sqlite: Sqlite
  readonly d1: TestD1
  readonly db: ReturnType<typeof getDb>
  readonly failures: FailureController
  readonly close: () => void
}

export function openCorrespondenceTestDatabase(): CorrespondenceTestDatabase {
  const sqlite = new Database(":memory:")
  const failures: FailureController = { failNextMatching: () => {}, setBindLimit: () => {}, setBeforeBatchHook: () => {} }
  createBaseSchema(sqlite)
  seedBase(sqlite)
  const d1 = createD1(sqlite, failures)
  // @ts-expect-error The SQLite adapter implements the D1 methods exercised by this integration test.
  const db = getDb(d1)
  return { sqlite, d1, db, failures, close: () => sqlite.close() }
}

function user(id: string, email: string, role: string, organizationId: string): CorrespondenceContext["user"] {
  return {
    id, email, firstName: null, lastName: null, displayName: id, avatarUrl: null,
    role, googleEmail: null, isActive: true, lastLoginAt: null, organizationId,
    organizationName: organizationId, organizationType: "internal", createdAt: "2026-09-05T12:00:00.000Z", updatedAt: "2026-09-05T12:00:00.000Z",
  }
}

export function context(database: CorrespondenceTestDatabase, userId: "staff-a" | "owner-a" | "staff-b" | "owner-b" | "revoked-a", projectId: "project-a" | "project-b" | "project-other", organizationId: "org-a" | "org-b" = projectId === "project-other" ? "org-b" : "org-a"): CorrespondenceContext {
  const isOwner = userId === "owner-a" || userId === "owner-b"
  const staff = userId === "staff-a" || userId === "staff-b" || userId === "revoked-a"
  return {
    db: database.db,
    env: {},
    user: user(userId, `${userId}@example.test`, isOwner ? "client" : "admin", organizationId),
    projectId,
    organizationId,
    projectName: projectId,
    workspace: staff ? "staff" : "owner",
  }
}

export function insertConversation(sqlite: Sqlite, values: { readonly id: string; readonly projectId: string; readonly organizationId?: string; readonly subject?: string; readonly participantVersion?: number }): void {
  sqlite.prepare("INSERT INTO project_correspondence (id,organization_id,project_id,subject,participant_version,created_at) VALUES (?,?,?,?,?,?)").run(
    values.id, values.organizationId ?? "org-a", values.projectId, values.subject ?? values.id, values.participantVersion ?? 1, "2026-09-05T12:00:00.000Z",
  )
}

export function insertParticipant(sqlite: Sqlite, values: { readonly id: string; readonly conversationId: string; readonly userId: string; readonly role: "staff" | "owner" }): void {
  sqlite.prepare("INSERT INTO correspondence_participants (id,conversation_id,user_id,name,email,role) VALUES (?,?,?,?,?,?)").run(values.id, values.conversationId, values.userId, values.userId, `${values.userId}@example.test`, values.role)
}

export function insertMessage(sqlite: Sqlite, values: { readonly id: string; readonly conversationId: string; readonly authorUserId: string; readonly authorName?: string; readonly body: string; readonly sentAt?: string; readonly requestHash?: string; readonly source?: "compass" | "buildertrend" }): number {
  const result = sqlite.prepare("INSERT INTO correspondence_messages (id,conversation_id,author_user_id,author_name,source,body,sent_at,request_hash) VALUES (?,?,?,?,?,?,?,?)").run(
    values.id, values.conversationId, values.authorUserId, values.authorName ?? values.authorUserId, values.source ?? "buildertrend", values.body, values.sentAt ?? "2026-09-05T12:00:00.000Z", values.requestHash ?? values.id,
  )
  return Number(result.lastInsertRowid)
}

export function insertGrant(sqlite: Sqlite, values: { readonly id: string; readonly messageId: string; readonly userId: string; readonly kind?: "author" | "to" | "cc"; readonly baseline?: boolean }): void {
  sqlite.prepare("INSERT INTO correspondence_recipients (id,message_id,user_id,name,kind,baseline) VALUES (?,?,?,?,?,?)").run(values.id, values.messageId, values.userId, values.userId, values.kind ?? "to", values.baseline ? 1 : 0)
}

export function insertAttachment(sqlite: Sqlite, values: { readonly id: string; readonly projectId?: string; readonly ownerUserId?: string; readonly driveFileId?: string | null; readonly messageId?: string | null; readonly retiredAt?: string | null }): void {
  sqlite.prepare("INSERT INTO correspondence_attachments (id,organization_id,project_id,owner_user_id,message_id,name,content_type,size,drive_file_id,created_at,retired_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(
    values.id, "org-a", values.projectId ?? "project-a", values.ownerUserId ?? "staff-a", values.messageId ?? null, `${values.id}.txt`, "text/plain", 12, values.driveFileId === undefined ? "drive-file" : values.driveFileId, "2026-09-05T12:00:00.000Z", values.retiredAt ?? null,
  )
}
