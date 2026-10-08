import { readFileSync } from "node:fs"
import { join } from "node:path"

import Database from "better-sqlite3"
import { describe, expect, it } from "vitest"

describe("0172 GCSSC phase client review migration", () => {
  it("repairs only pending GCSSC phase handoffs and preserves the source payload", () => {
    const db = new Database(":memory:")
    db.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        organization_id TEXT,
        project_number TEXT,
        client_name TEXT,
        updated_at TEXT
      );
      CREATE TABLE project_operations (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        source_system TEXT NOT NULL,
        source_record_type TEXT NOT NULL,
        source_record_id TEXT,
        company_name TEXT,
        description TEXT,
        status TEXT NOT NULL,
        sage_write_status TEXT,
        sage_payload_json TEXT,
        sync_status TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE project_profile_audit_events (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        actor_user_id TEXT,
        event_type TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        before_json TEXT,
        after_json TEXT,
        created_at TEXT NOT NULL
      );
    `)

    db.prepare(
      "INSERT INTO projects VALUES (?, 'org-1', ?, ?, '2026-09-21T00:00:00.000Z')",
    ).run("base", "O-31-2067", "TCSS / GCSSC")
    const insertProject = db.prepare(
      "INSERT INTO projects VALUES (?, 'org-1', ?, ?, '2026-09-21T00:00:00.000Z')",
    )
    const insertOperation = db.prepare(`
      INSERT INTO project_operations VALUES (
        ?, ?, 'google_project_manager', 'sage_project_handoff', ?, ?,
        'Original description', 'needs_review', 'needs_review', ?, ?,
        '2026-09-21T00:00:00.000Z'
      )
    `)

    for (let phase = 1; phase <= 5; phase += 1) {
      const projectId = `phase-${phase}`
      const projectNumber = `O-31-2067-${phase}`
      insertProject.run(projectId, projectNumber, "Phil Chase")
      insertOperation.run(
        `operation-${phase}`,
        projectId,
        projectNumber,
        "Phil Chase",
        JSON.stringify({ clientName: "Phil Chase" }),
        "pending_sage",
      )
    }

    insertProject.run("other-phase", "O-99-999-1", "Other Contact")
    insertOperation.run(
      "other-operation",
      "other-phase",
      "O-99-999-1",
      "Other Contact",
      JSON.stringify({ clientName: "Other Contact" }),
      "pending_sage",
    )
    insertProject.run("queued-phase", "O-31-2067-6", "Phil Chase")
    insertOperation.run(
      "queued-operation",
      "queued-phase",
      "O-31-2067-1",
      "Phil Chase",
      JSON.stringify({ clientName: "Phil Chase" }),
      "queued_sage",
    )

    const migration = readFileSync(
      join(process.cwd(), "drizzle/0172_gcssc_phase_client_review.sql"),
      "utf8",
    )
    db.exec(migration)

    const repairedProjects = db
      .prepare(
        "SELECT project_number, client_name FROM projects WHERE project_number GLOB 'O-31-2067-[1-5]' ORDER BY project_number",
      )
      .all()
    expect(repairedProjects).toEqual(
      Array.from({ length: 5 }, (_, index) => ({
        project_number: `O-31-2067-${index + 1}`,
        client_name: "TCSS / GCSSC",
      })),
    )

    const repairedOperations = db
      .prepare(`
        SELECT company_name, sage_write_status, sync_status, sage_payload_json
        FROM project_operations
        WHERE id GLOB 'operation-[1-5]'
        ORDER BY id
      `)
      .all()
    expect(repairedOperations).toHaveLength(5)
    for (const operation of repairedOperations) {
      expect(operation).toEqual({
        company_name: "TCSS / GCSSC",
        sage_write_status: "not_ready",
        sync_status: "needs_review",
        sage_payload_json: JSON.stringify({ clientName: "Phil Chase" }),
      })
    }

    expect(
      db.prepare("SELECT client_name FROM projects WHERE id = 'other-phase'").get(),
    ).toEqual({ client_name: "Other Contact" })
    expect(
      db.prepare(
        "SELECT company_name, sync_status FROM project_operations WHERE id = 'queued-operation'",
      ).get(),
    ).toEqual({ company_name: "Phil Chase", sync_status: "queued_sage" })
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM project_profile_audit_events").get(),
    ).toEqual({ count: 10 })

    db.exec(migration)
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM project_profile_audit_events").get(),
    ).toEqual({ count: 10 })
    db.close()
  })
})
