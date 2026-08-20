import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const migration = readFileSync(
  resolve(process.cwd(), "drizzle/0119_buildertrend_client_directory.sql"),
  "utf8"
).replaceAll("--> statement-breakpoint", "")

type TestStatement = {
  readonly all: () => readonly unknown[]
  readonly get: () => unknown
}

type TestDatabase = {
  readonly exec: (sql: string) => unknown
  readonly prepare: (sql: string) => TestStatement
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

async function createDatabase(): Promise<TestDatabase> {
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

describe("Buildertrend client contact directory migration", () => {
  it("promotes stable identities without granting access or guessing conflicts", async () => {
    const database = await createDatabase()
    database.exec(`
      CREATE TABLE customers (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, company TEXT, email TEXT,
        phone TEXT, address TEXT, notes TEXT, netsuite_id TEXT,
        sage_client_id TEXT, sage_client_number TEXT,
        sage_client_status_id INTEGER, organization_id TEXT,
        created_at TEXT NOT NULL, updated_at TEXT
      );
      CREATE TABLE projects (
        id TEXT PRIMARY KEY, organization_id TEXT NOT NULL
      );
      CREATE TABLE project_contacts (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, contact_type TEXT NOT NULL,
        source_entity_type TEXT NOT NULL, source_entity_id TEXT,
        display_name TEXT NOT NULL, email TEXT, phone TEXT, active INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE buildertrend_staging_access_candidates (
        id TEXT PRIMARY KEY, organization_id TEXT, project_id TEXT,
        buildertrend_contact_id TEXT, buildertrend_access_role TEXT,
        contact_name TEXT, email TEXT, phone TEXT,
        proposed_contact_type TEXT, created_at TEXT, updated_at TEXT
      );

      INSERT INTO projects VALUES ('project-a', 'org-a'), ('project-b', 'org-a');
      INSERT INTO customers (
        id, name, phone, sage_client_id, sage_client_number,
        organization_id, created_at
      ) VALUES (
        'existing', 'Existing Client', NULL, 'sage-existing', '2899',
        'org-a', '2026-01-01'
      );
      INSERT INTO project_contacts VALUES (
        'project-owner', 'project-a', 'owner', 'manual', NULL,
        'Stable Lead', NULL, '555-0101', 1, '2026-01-01'
      );
      INSERT INTO buildertrend_staging_access_candidates VALUES
        ('stable-a', 'org-a', 'project-a', 'bt-stable', 'lead_contact',
         'Stable Lead', NULL, '555-0101', 'owner', '2026-01-01', '2026-02-01'),
        ('stable-b', 'org-a', 'project-b', 'bt-stable', 'lead_contact',
         'Stable Lead', NULL, '555-0101', 'owner', '2026-01-02', '2026-02-02'),
        ('conflict-a', 'org-a', 'project-a', 'bt-conflict', 'client_contact',
         'First Name', NULL, '555-0102', 'owner', '2026-01-01', '2026-02-01'),
        ('conflict-b', 'org-a', 'project-b', 'bt-conflict', 'client_contact',
         'Different Name', NULL, '555-0102', 'owner', '2026-01-01', '2026-02-01'),
        ('existing-a', 'org-a', 'project-a', 'bt-existing', 'client_contact',
         'Existing Client', NULL, '555-0100', 'owner', '2026-01-01', '2026-02-01');
    `)

    database.exec(migration)

    const imported = database
      .prepare(
        "SELECT name, phone, sage_client_number AS sageNumber, buildertrend_contact_id AS buildertrendContactId, relationship_type AS relationshipType FROM customers ORDER BY name"
      )
      .all()
    expect(imported).toEqual([
      {
        name: "Existing Client",
        phone: "555-0100",
        sageNumber: "2899",
        buildertrendContactId: "bt-existing",
        relationshipType: "client",
      },
      {
        name: "Stable Lead",
        phone: "555-0101",
        sageNumber: null,
        buildertrendContactId: "bt-stable",
        relationshipType: "lead",
      },
    ])
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM customers")
        .get()
    ).toEqual({ count: 2 })
    expect(
      database
        .prepare(
          "SELECT source_entity_type AS sourceType, source_entity_id AS sourceId FROM project_contacts WHERE id = 'project-owner'"
        )
        .get()
    ).toMatchObject({
      sourceType: "customer",
      sourceId: expect.stringContaining("bt-stable"),
    })

    database.close()
  })
})
