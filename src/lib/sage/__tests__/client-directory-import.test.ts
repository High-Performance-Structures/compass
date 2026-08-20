import { describe, expect, it } from "vitest"

import {
  buildSageClientDirectoryImportSql,
  stableSageClientDirectory,
} from "@/lib/sage/client-directory-import"

type TestStatement = {
  readonly all: () => readonly unknown[]
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

describe("Sage client directory import", () => {
  it("excludes conflicting Sage numbers", () => {
    expect(
      stableSageClientDirectory([
        { clientNumber: "100", name: "Stable Client" },
        { clientNumber: "100", name: "Stable Client" },
        { clientNumber: "101", name: "First Name" },
        { clientNumber: "101", name: "Different Name" },
      ])
    ).toEqual({
      clients: [{ clientNumber: "100", name: "Stable Client" }],
      conflictingClientNumbers: ["101"],
    })
  })

  it("links exact Buildertrend contacts to Sage and retains both identities", async () => {
    const database = await createDatabase()
    database.exec(`
      CREATE TABLE customers (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, company TEXT, email TEXT,
        phone TEXT, address TEXT, notes TEXT, netsuite_id TEXT,
        sage_client_id TEXT, sage_client_number TEXT,
        sage_client_status_id INTEGER, buildertrend_contact_id TEXT,
        relationship_type TEXT NOT NULL DEFAULT 'client',
        organization_id TEXT, created_at TEXT NOT NULL, updated_at TEXT
      );
      CREATE UNIQUE INDEX customers_org_sage_client_number_unique
        ON customers (organization_id, sage_client_number);
      INSERT INTO customers (
        id, name, phone,
        buildertrend_contact_id, organization_id, created_at
      ) VALUES (
        'buildertrend-existing', 'Shared Client', '555-0100',
        'bt-shared', 'org-a', '2026-01-01'
      );
    `)

    database.exec(
      buildSageClientDirectoryImportSql({
        organizationId: "org-a",
        records: [
          { clientNumber: "100", name: "Shared Client" },
          { clientNumber: "101", name: "Sage Only" },
        ],
      })
    )

    expect(
      database
        .prepare(
          `SELECT name, sage_client_number AS sageNumber,
                  buildertrend_contact_id AS buildertrendContactId
           FROM customers ORDER BY name`
        )
        .all()
    ).toEqual([
      {
        name: "Sage Only",
        sageNumber: "101",
        buildertrendContactId: null,
      },
      {
        name: "Shared Client",
        sageNumber: "100",
        buildertrendContactId: "bt-shared",
      },
    ])
    database.close()
  })
})
