import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

import {
  projectEstimateRfqBidImportLines,
  projectEstimateRfqBidImports,
  projectRfqBidApprovals,
} from "@/db/schema-rfqs"

type TestStatement = {
  readonly get: (...params: unknown[]) => unknown
}

type TestDatabase = {
  readonly exec: (sql: string) => void
  readonly prepare: (sql: string) => TestStatement
  readonly close: () => void
}

type TestDatabaseConstructor = new (filename: string) => TestDatabase

type TestDatabaseModule = {
  readonly Database: TestDatabaseConstructor
}

function isTestDatabaseModule(value: unknown): value is TestDatabaseModule {
  return (
    value !== null &&
    typeof value === "object" &&
    "Database" in value &&
    typeof value.Database === "function"
  )
}

function isTestDatabaseConstructor(
  value: unknown
): value is TestDatabaseConstructor {
  return typeof value === "function"
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

  const betterSqliteSpecifier = "better-sqlite3"
  const sqliteModule: unknown = await import(betterSqliteSpecifier)
  if (
    sqliteModule === null ||
    typeof sqliteModule !== "object" ||
    !("default" in sqliteModule) ||
    !isTestDatabaseConstructor(sqliteModule.default)
  ) {
    throw new Error("better-sqlite3 did not provide a Database constructor")
  }
  return new sqliteModule.default(":memory:")
}

describe("RFQ bid approval and estimate import persistence", () => {
  it("stores immutable approval and line-level estimate provenance", () => {
    expect(projectRfqBidApprovals.amountCents.name).toBe("amount_cents")
    expect(projectRfqBidApprovals.responseSnapshotJson.name).toBe(
      "response_snapshot_json"
    )
    expect(projectEstimateRfqBidImports.approvalId.name).toBe("approval_id")
    expect(projectEstimateRfqBidImportLines.estimateLineId.name).toBe(
      "estimate_line_id"
    )
  })

  it("prevents duplicate approvals and duplicate imports", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle/0147_rfq_bid_approval_import.sql"),
      "utf8"
    )
    expect(migration).toContain("project_rfq_bid_approvals_rfq_uq")
    expect(migration).toContain("project_estimate_rfq_bid_imports_approval_uq")
    expect(migration).toContain("ON DELETE restrict")
  })

  it("retains provenance when an editable imported estimate line is deleted", async () => {
    const database = await openDatabase()
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle/0147_rfq_bid_approval_import.sql"),
      "utf8"
    )

    try {
      database.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE projects (id text PRIMARY KEY NOT NULL);
        CREATE TABLE project_operations (id text PRIMARY KEY NOT NULL);
        CREATE TABLE users (id text PRIMARY KEY NOT NULL);
        CREATE TABLE project_estimates (id text PRIMARY KEY NOT NULL);
        CREATE TABLE project_estimate_lines (id text PRIMARY KEY NOT NULL);
      `)
      database.exec(migration)
      database.exec(`
        INSERT INTO projects (id) VALUES ('project-1');
        INSERT INTO project_operations (id) VALUES ('rfq-1');
        INSERT INTO project_estimates (id) VALUES ('estimate-1');
        INSERT INTO project_estimate_lines (id) VALUES ('line-1');
        INSERT INTO project_rfq_bid_approvals (
          id, project_id, rfq_operation_id, amount_cents,
          response_snapshot_json, responder_name, response_submitted_at,
          approved_by_name, approved_at, created_at
        ) VALUES (
          'approval-1', 'project-1', 'rfq-1', 12500,
          '{}', 'Vendor', '2026-09-02T12:00:00.000Z',
          'Estimator', '2026-09-02T12:10:00.000Z', '2026-09-02T12:10:00.000Z'
        );
        INSERT INTO project_estimate_rfq_bid_imports (
          id, project_id, approval_id, estimate_id, imported_amount_cents,
          imported_by_name, imported_at, created_at
        ) VALUES (
          'import-1', 'project-1', 'approval-1', 'estimate-1', 12500,
          'Estimator', '2026-09-02T12:15:00.000Z', '2026-09-02T12:15:00.000Z'
        );
        INSERT INTO project_estimate_rfq_bid_import_lines (
          id, import_id, estimate_line_id, rfq_line_number,
          description_snapshot, amount_cents, created_at
        ) VALUES (
          'provenance-1', 'import-1', 'line-1', 1,
          'Reviewed scope', 12500, '2026-09-02T12:15:00.000Z'
        );
        DELETE FROM project_estimate_lines WHERE id = 'line-1';
      `)

      expect(
        database
          .prepare(
            "SELECT estimate_line_id FROM project_estimate_rfq_bid_import_lines WHERE id = ?"
          )
          .get("provenance-1")
      ).toMatchObject({ estimate_line_id: null })
    } finally {
      database.close()
    }
  })
})
