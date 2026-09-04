import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

import { projectChangeOrders } from "@/db/schema"

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

async function openDatabase(): Promise<TestDatabase> {
  const bunSqliteSpecifier = "bun:sqlite"
  const sqliteModule: unknown = await import(bunSqliteSpecifier)
  if (!isTestDatabaseModule(sqliteModule)) {
    throw new Error("bun:sqlite did not provide a Database constructor")
  }
  return new sqliteModule.Database(":memory:")
}

describe("preconstruction estimate rebaseline persistence", () => {
  it("stores the budget treatment and linked estimate versions", () => {
    expect(projectChangeOrders.budgetTreatment.name).toBe("budget_treatment")
    expect(projectChangeOrders.baselineEstimateId.name).toBe(
      "baseline_estimate_id"
    )
    expect(projectChangeOrders.replacementEstimateId.name).toBe(
      "replacement_estimate_id"
    )
    expect(projectChangeOrders.rebaselineCompletedAt.name).toBe(
      "rebaseline_completed_at"
    )
    expect(projectChangeOrders.rebaselineExecutionToken.name).toBe(
      "rebaseline_execution_token"
    )
  })

  it("migrates existing change orders as additive adjustments", () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "drizzle/0148_preconstruction_estimate_rebaseline.sql"
      ),
      "utf8"
    )
    expect(migration).toContain("DEFAULT 'additive'")
    expect(migration).toContain(
      "project_change_orders_budget_treatment_idx"
    )
    expect(migration).toContain(
      "project_change_orders_replacement_estimate_idx"
    )
    expect(migration).toContain(
      "project_estimates_one_accepted_per_project_uq"
    )
    expect(migration).toContain(
      "project_change_orders_rebaseline_execution_guard"
    )
    expect(migration).toContain(
      "project_estimates_rebaseline_acceptance_guard"
    )
    expect(migration).toContain(
      "project_change_order_history_rebaseline_execution_guard"
    )
    expect(migration).toContain(
      "Preserve every\n-- row while retaining the newest accepted version"
    )
  })

  it("reconciles duplicate baselines and atomically blocks late costs", async () => {
    const database = await openDatabase()
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "drizzle/0148_preconstruction_estimate_rebaseline.sql"
      ),
      "utf8"
    )
    try {
      database.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE users (id text PRIMARY KEY NOT NULL);
        CREATE TABLE project_estimates (
          id text PRIMARY KEY NOT NULL,
          project_id text NOT NULL,
          version_number integer NOT NULL,
          status text NOT NULL,
          created_at text NOT NULL
        );
        CREATE TABLE project_change_orders (
          id text PRIMARY KEY NOT NULL,
          project_id text NOT NULL,
          status text NOT NULL,
          audience text NOT NULL
        );
        CREATE TABLE project_change_order_history (
          project_id text NOT NULL,
          change_order_id text NOT NULL,
          event_type text NOT NULL,
          metadata_json text
        );
        CREATE TABLE project_budget_lines (
          project_id text NOT NULL,
          previous_work_completed real NOT NULL DEFAULT 0,
          current_work_completed real NOT NULL DEFAULT 0,
          stored_materials real NOT NULL DEFAULT 0,
          prior_costs real NOT NULL DEFAULT 0,
          current_costs real NOT NULL DEFAULT 0,
          total_costs real NOT NULL DEFAULT 0
        );
        CREATE TABLE project_operations (
          project_id text NOT NULL,
          source_record_type text NOT NULL,
          status text NOT NULL
        );
        CREATE TABLE vendor_bills (project_id text);
        CREATE TABLE invoices (project_id text);
        CREATE TABLE payments (project_id text);
        CREATE TABLE project_budget_applications (
          project_id text NOT NULL,
          source_system text NOT NULL,
          status text NOT NULL,
          budget_revision_id text,
          owner_visible integer NOT NULL DEFAULT 0
        );
        CREATE TABLE project_contract_budget_revisions (
          id text PRIMARY KEY NOT NULL,
          project_id text NOT NULL,
          accepted_estimate_id text NOT NULL,
          status text NOT NULL
        );
        INSERT INTO project_estimates VALUES
          ('estimate-old', 'project-1', 1, 'accepted', '2026-01-01'),
          ('estimate-new', 'project-1', 2, 'accepted', '2026-02-01');
      `)
      database.exec(migration)
      expect(
        database
          .prepare("SELECT status FROM project_estimates WHERE id = ?")
          .get("estimate-old")
      ).toEqual({ status: "superseded" })

      database.exec(`
        INSERT INTO project_estimates VALUES
          ('baseline-2', 'project-2', 1, 'superseded', '2026-01-01'),
          ('replacement-2', 'project-2', 2, 'accepted', '2026-02-01');
        INSERT INTO project_contract_budget_revisions VALUES
          ('revision-2', 'project-2', 'replacement-2', 'current');
        INSERT INTO project_budget_applications (
          project_id, source_system, status, budget_revision_id, owner_visible
        ) VALUES (
          'project-2', 'compass_contract_budget_projection', 'budget_current',
          'revision-2', 1
        );
        INSERT INTO project_change_orders (
          id, project_id, status, audience, budget_treatment,
          baseline_estimate_id, replacement_estimate_id,
          rebaseline_execution_token
        ) VALUES (
          'co-2', 'project-2', 'signature_pending', 'owner',
          'baseline_replacement', 'baseline-2', 'replacement-2', 'token-2'
        );
        INSERT INTO project_budget_lines (project_id, total_costs)
        VALUES ('project-2', 1);
      `)
      expect(() =>
        database.exec(
          "UPDATE project_change_orders SET status = 'executed' WHERE id = 'co-2'"
        )
      ).toThrow("Rebaseline blocked by posted project costs")
      expect(
        database
          .prepare("SELECT status FROM project_change_orders WHERE id = ?")
          .get("co-2")
      ).toEqual({ status: "signature_pending" })

      database.exec(`
        INSERT INTO project_estimates VALUES
          ('baseline-5', 'project-5', 1, 'superseded', '2026-01-01'),
          ('replacement-5', 'project-5', 2, 'accepted', '2026-02-01');
        INSERT INTO project_contract_budget_revisions VALUES
          ('revision-5', 'project-5', 'replacement-5', 'current');
        INSERT INTO project_budget_applications (
          project_id, source_system, status, budget_revision_id, owner_visible
        ) VALUES
          ('project-5', 'compass_contract_budget_projection', 'budget_current', 'revision-5', 1),
          ('project-5', 'compass_contract_budget', 'building', NULL, 0);
        INSERT INTO project_change_orders (
          id, project_id, status, audience, budget_treatment,
          baseline_estimate_id, replacement_estimate_id,
          rebaseline_execution_token
        ) VALUES (
          'co-5', 'project-5', 'signature_pending', 'owner',
          'baseline_replacement', 'baseline-5', 'replacement-5', 'token-5'
        );
      `)
      expect(() =>
        database.exec(
          "UPDATE project_change_orders SET status = 'executed' WHERE id = 'co-5'"
        )
      ).toThrow("Rebaseline blocked by a payment application")

      database.exec(`
        INSERT INTO project_estimates VALUES
          ('baseline-6', 'project-6', 1, 'superseded', '2026-01-01'),
          ('replacement-6', 'project-6', 2, 'accepted', '2026-02-01');
        INSERT INTO project_contract_budget_revisions VALUES
          ('revision-6', 'project-6', 'replacement-6', 'current');
        INSERT INTO project_budget_applications (
          project_id, source_system, status, budget_revision_id, owner_visible
        ) VALUES
          ('project-6', 'compass_contract_budget_projection', 'budget_current', 'revision-6', 1),
          ('project-6', 'compass_contract_budget', 'budget_superseded', NULL, 0);
        INSERT INTO project_change_orders (
          id, project_id, status, audience, budget_treatment,
          baseline_estimate_id, replacement_estimate_id,
          rebaseline_execution_token
        ) VALUES (
          'co-6', 'project-6', 'signature_pending', 'owner',
          'baseline_replacement', 'baseline-6', 'replacement-6', 'token-6'
        );
      `)
      expect(() =>
        database.exec(
          "UPDATE project_change_orders SET status = 'executed' WHERE id = 'co-6'"
        )
      ).toThrow("Rebaseline blocked by a payment application")

      database.exec(`
        INSERT INTO project_estimates VALUES
          ('baseline-3', 'project-3', 1, 'accepted', '2026-01-01'),
          ('replacement-3', 'project-3', 2, 'signature_pending', '2026-02-01');
        INSERT INTO project_change_orders (
          id, project_id, status, audience, budget_treatment,
          baseline_estimate_id, replacement_estimate_id
        ) VALUES (
          'co-3', 'project-3', 'signature_pending', 'owner',
          'baseline_replacement', 'baseline-3', 'replacement-3'
        );
      `)
      expect(() =>
        database.exec(
          "UPDATE project_estimates SET status = 'accepted' WHERE id = 'replacement-3'"
        )
      ).toThrow("Execute the linked rebaseline amendment")
      expect(
        database
          .prepare("SELECT status FROM project_estimates WHERE id = ?")
          .get("replacement-3")
      ).toEqual({ status: "signature_pending" })
      database.exec(`
        UPDATE project_change_orders SET status = 'void' WHERE id = 'co-3';
        BEGIN;
        UPDATE project_estimates SET status = 'superseded'
        WHERE id = 'baseline-3';
        UPDATE project_estimates SET status = 'accepted'
        WHERE id = 'replacement-3';
        COMMIT;
      `)
      expect(
        database
          .prepare("SELECT status FROM project_estimates WHERE id = ?")
          .get("replacement-3")
      ).toEqual({ status: "accepted" })

      database.exec(`
        INSERT INTO project_estimates VALUES
          ('baseline-4', 'project-4', 1, 'accepted', '2026-01-01'),
          ('replacement-4', 'project-4', 2, 'signature_pending', '2026-02-01');
        INSERT INTO project_contract_budget_revisions VALUES
          ('revision-old-4', 'project-4', 'baseline-4', 'current'),
          ('revision-new-4', 'project-4', 'replacement-4', 'building');
        INSERT INTO project_budget_applications (
          project_id, source_system, status, budget_revision_id, owner_visible
        ) VALUES
          ('project-4', 'compass_contract_budget_projection', 'budget_current', 'revision-old-4', 1),
          ('project-4', 'compass_contract_budget_projection', 'building', 'revision-new-4', 0);
        INSERT INTO project_change_orders (
          id, project_id, status, audience, budget_treatment,
          baseline_estimate_id, replacement_estimate_id
        ) VALUES (
          'co-4', 'project-4', 'signature_pending', 'owner',
          'baseline_replacement', 'baseline-4', 'replacement-4'
        );

        BEGIN;
        UPDATE project_change_orders
        SET rebaseline_execution_token = 'token-4'
        WHERE id = 'co-4' AND status = 'signature_pending';
        UPDATE project_estimates SET status = 'superseded'
        WHERE id = 'baseline-4' AND status = 'accepted';
        UPDATE project_estimates SET status = 'accepted'
        WHERE id = 'replacement-4' AND status = 'signature_pending';
        UPDATE project_contract_budget_revisions SET status = 'superseded'
        WHERE id = 'revision-old-4';
        UPDATE project_contract_budget_revisions SET status = 'current'
        WHERE id = 'revision-new-4';
        UPDATE project_budget_applications SET status = 'budget_superseded'
        WHERE budget_revision_id = 'revision-old-4';
        UPDATE project_budget_applications
        SET status = 'budget_current', owner_visible = 1
        WHERE budget_revision_id = 'revision-new-4';
        UPDATE project_change_orders
        SET status = 'executed', rebaseline_completed_at = '2026-03-01'
        WHERE id = 'co-4' AND rebaseline_execution_token = 'token-4';
        INSERT INTO project_change_order_history (
          project_id, change_order_id, event_type, metadata_json
        ) VALUES (
          'project-4', 'co-4', 'baseline_replaced',
          '{"executionToken":"token-4"}'
        );
        COMMIT;
      `)
      expect(
        database
          .prepare("SELECT status FROM project_change_orders WHERE id = ?")
          .get("co-4")
      ).toEqual({ status: "executed" })
      expect(
        database
          .prepare("SELECT status FROM project_estimates WHERE id = ?")
          .get("replacement-4")
      ).toEqual({ status: "accepted" })
    } finally {
      database.close()
    }
  })
})
