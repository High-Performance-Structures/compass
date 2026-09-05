import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import Database from "better-sqlite3"
import test from "node:test"

import { buildBuildertrendCorrespondencePublication } from "./build-buildertrend-correspondence-publication.mjs"

const migration = readFileSync(resolve(process.cwd(), "drizzle/0151_project_correspondence.sql"), "utf8").replaceAll("--> statement-breakpoint", "")
const hash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

function openDatabase() {
  const database = new Database(":memory:")
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE organizations (id TEXT PRIMARY KEY NOT NULL);
    CREATE TABLE users (id TEXT PRIMARY KEY NOT NULL, email TEXT NOT NULL, display_name TEXT, is_active INTEGER NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE projects (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT, name TEXT NOT NULL);
    CREATE TABLE organization_members (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, joined_at TEXT NOT NULL);
    CREATE TABLE project_members (id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, assigned_at TEXT NOT NULL);
  `)
  database.exec(migration)
  database.exec(`
    INSERT INTO organizations VALUES ('org-a');
    INSERT INTO users VALUES ('staff-a','staff-a@example.test','Staff A',1,'admin','2026-09-05','2026-09-05'),('owner-a','owner-a@example.test','Owner A',1,'client','2026-09-05','2026-09-05');
    INSERT INTO projects (id,organization_id,name) VALUES ('project-a','org-a','Project A');
    INSERT INTO organization_members VALUES ('om-staff','org-a','staff-a','admin','2026-09-05'),('om-owner','org-a','owner-a','client','2026-09-05');
    INSERT INTO project_members VALUES ('pm-staff','project-a','staff-a','staff','2026-09-05'),('pm-owner','project-a','owner-a','owner','2026-09-05');
  `)
  return database
}

function manifest(overrides = {}) {
  return {
    schemaVersion: "buildertrend-correspondence-publication-manifest/v1",
    publicationId: "publication-a-20260905",
    organizationId: "org-a",
    sourceAccountId: "bt-account-a",
    reviewed: {
      reviewerId: "reviewer-a",
      reviewedAt: "2026-09-05T12:00:00.000Z",
      referenceHash: hash,
      identityEntitlementsProven: true,
      quoteReview: "complete",
    },
    project: { projectId: "project-a", sourceProjectId: "bt-job-a", mappingStatus: "proven" },
    conversations: [{
      sourceThreadId: "bt-thread-a",
      subject: "Schedule",
      createdAt: "2026-09-01T12:00:00.000Z",
      participants: [
        { userId: "staff-a", name: "Staff A", email: "staff-a@example.test", role: "staff", identityStatus: "proven", projectEntitlementStatus: "proven" },
        { userId: "owner-a", name: "Owner A", email: "owner-a@example.test", role: "owner", identityStatus: "proven", projectEntitlementStatus: "proven" },
      ],
      messages: [{
        sourceMessageId: "bt-message-a",
        sourceThreadId: "bt-thread-a",
        exactBody: "Buildertrend exact body",
        authorName: "Former Buildertrend Sender",
        authorUserId: null,
        senderStatus: "proven",
        sentAt: "2026-09-01T12:01:00.000Z",
        grants: [
          { userId: "staff-a", name: "Staff A", kind: "to", evidenceStatus: "proven" },
          { userId: "owner-a", name: "Owner A", kind: "cc", evidenceStatus: "proven" },
        ],
        attachments: [{ sourceAttachmentId: "bt-file-a", ownerUserId: "staff-a", name: "plan.pdf", contentType: "application/pdf", size: 12, driveFileId: "driveFileA", byteVerification: "verified", sourceSha256: hash }],
      }],
    }],
    ...overrides,
  }
}

test("builds and replays a silent exact publication against the local 0150 schema", () => {
  const database = openDatabase()
  try {
    const packageResult = buildBuildertrendCorrespondencePublication(manifest())
    assert.equal(packageResult.reconciliation.status, "REHEARSAL_ONLY")
    assert.equal(packageResult.reconciliation.notificationsWritten, false)
    assert.equal(packageResult.reconciliation.openedAtWritten, false)
    assert.match(packageResult.sql, /source='buildertrend'/)
    assert.match(packageResult.sql, /baseline=1/)
    assert.doesNotMatch(packageResult.sql, /correspondence_outbox/)
    database.exec(packageResult.sql)
    database.exec(packageResult.sql)
    assert.deepEqual(database.prepare("SELECT COUNT(*) AS count FROM correspondence_messages").get(), { count: 1 })
    assert.deepEqual(database.prepare("SELECT COUNT(*) AS count FROM correspondence_recipients WHERE baseline=1 AND opened_at IS NULL").get(), { count: 2 })
    assert.deepEqual(database.prepare("SELECT COUNT(*) AS count FROM correspondence_attachments WHERE drive_file_id='driveFileA'").get(), { count: 1 })
    assert.deepEqual(database.prepare("SELECT COUNT(*) AS count FROM correspondence_outbox").get(), { count: 0 })
  } finally {
    database.close()
  }
})

test("refuses a changed body or grant set after an exact publication", () => {
  const database = openDatabase()
  try {
    const first = buildBuildertrendCorrespondencePublication(manifest())
    database.exec(first.sql)
    const changedBody = buildBuildertrendCorrespondencePublication({
      ...manifest(),
      conversations: [{ ...manifest().conversations[0], messages: [{ ...manifest().conversations[0].messages[0], exactBody: "Changed body" }] }],
    })
    assert.throws(() => database.exec(changedBody.sql), /CHECK constraint failed|correspondence_write_guards/)
    database.exec("ROLLBACK")
    const changedGrants = buildBuildertrendCorrespondencePublication({
      ...manifest(),
      conversations: [{ ...manifest().conversations[0], messages: [{ ...manifest().conversations[0].messages[0], grants: [manifest().conversations[0].messages[0].grants[0]] }] }],
    })
    assert.throws(() => database.exec(changedGrants.sql), /CHECK constraint failed|correspondence_write_guards/)
    assert.deepEqual(database.prepare("SELECT body FROM correspondence_messages").get(), { body: "Buildertrend exact body" })
  } finally {
    database.close()
  }
})

test("fails closed when live project or participant assertions do not match the manifest", () => {
  const database = openDatabase()
  try {
    const missingUser = buildBuildertrendCorrespondencePublication({
      ...manifest(),
      conversations: [{ ...manifest().conversations[0], participants: [{ ...manifest().conversations[0].participants[0], email: "wrong@example.test" }, manifest().conversations[0].participants[1]] }],
    })
    assert.throws(() => database.exec(missingUser.sql), /CHECK constraint failed|correspondence_write_guards/)
    assert.deepEqual(database.prepare("SELECT COUNT(*) AS count FROM correspondence_messages").get(), { count: 0 })
  } finally {
    database.close()
  }
})

test("rejects excerpt, unproven identity, Bcc, and unrestricted attachment evidence", () => {
  const base = manifest()
  const message = base.conversations[0].messages[0]
  assert.throws(() => buildBuildertrendCorrespondencePublication({ ...base, conversations: [{ ...base.conversations[0], messages: [{ ...message, excerpt: "register text" }] }] }), /excerpt\/page text/)
  assert.throws(() => buildBuildertrendCorrespondencePublication({ ...base, conversations: [{ ...base.conversations[0], messages: [{ ...message, senderStatus: "uncertain" }] }] }), /sender evidence must be proven/)
  assert.throws(() => buildBuildertrendCorrespondencePublication({ ...base, conversations: [{ ...base.conversations[0], messages: [{ ...message, grants: [{ ...message.grants[0], kind: "bcc" }] }] }] }), /Bcc/)
  assert.throws(() => buildBuildertrendCorrespondencePublication({ ...base, conversations: [{ ...base.conversations[0], messages: [{ ...message, attachments: [{ ...message.attachments[0], driveFileId: "https://drive.google.com/file" }] }] }] }), /restricted Drive file ID/)
})

test("normalizes explicit source timezones and refuses date-only timestamps", () => {
  const value = manifest({
    reviewed: { ...manifest().reviewed, reviewedAt: "2026-09-05T06:00:00-06:00" },
    conversations: [{ ...manifest().conversations[0], createdAt: "2026-09-05T06:00:00-06:00", messages: [{ ...manifest().conversations[0].messages[0], sentAt: "2026-09-05T06:01:00-06:00" }] }],
  })
  const packageResult = buildBuildertrendCorrespondencePublication(value)
  assert.equal(packageResult.reconciliation.reviewedAt, "2026-09-05T12:00:00.000Z")
  assert.match(packageResult.sql, /2026-09-05T12:01:00\.000Z/)
  assert.throws(() => buildBuildertrendCorrespondencePublication({ ...value, reviewed: { ...value.reviewed, reviewedAt: "2026-09-05" } }), /ISO-8601 timestamp/)
})

test("rollback withdraws imported rows while preserving a later native reply", () => {
  const database = openDatabase()
  try {
    const packageResult = buildBuildertrendCorrespondencePublication(manifest())
    database.exec(packageResult.sql)
    const conversationId = database.prepare("SELECT id FROM project_correspondence").get().id
    database.prepare("INSERT INTO correspondence_messages (id,conversation_id,author_user_id,author_name,source,source_key,body,sent_at,request_hash) VALUES (?,?,?,?,?,?,?,?,?)").run("native-reply", conversationId, "staff-a", "Staff A", "compass", null, "Legitimate new reply", "2026-09-05T13:00:00.000Z", "native-request")
    database.prepare("INSERT INTO correspondence_recipients (id,message_id,user_id,name,kind,opened_at,baseline) VALUES (?,?,?,?,?,?,?)").run("native-grant", "native-reply", "owner-a", "Owner A", "to", null, 0)
    database.exec(packageResult.rollbackSql)
    assert.deepEqual(database.prepare("SELECT COUNT(*) AS count FROM correspondence_messages WHERE source='buildertrend'").get(), { count: 0 })
    assert.deepEqual(database.prepare("SELECT body FROM correspondence_messages WHERE id='native-reply'").get(), { body: "Legitimate new reply" })
    assert.deepEqual(database.prepare("SELECT COUNT(*) AS count FROM correspondence_attachments").get(), { count: 0 })
  } finally {
    database.close()
  }
})

test("rollback leaves an imported row whose body or request hash was changed", () => {
  const database = openDatabase()
  try {
    const packageResult = buildBuildertrendCorrespondencePublication(manifest())
    database.exec(packageResult.sql)
    database.prepare("UPDATE correspondence_messages SET body='reviewed correction' WHERE source='buildertrend'").run()
    database.exec(packageResult.rollbackSql)
    assert.deepEqual(database.prepare("SELECT body FROM correspondence_messages WHERE source='buildertrend'").get(), { body: "reviewed correction" })
  } finally {
    database.close()
  }
})
