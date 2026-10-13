import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

type TestStatement = {
  readonly get: (...params: unknown[]) => unknown
  readonly run?: (...params: unknown[]) => unknown
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

type NodeTestDatabaseModule = {
  readonly DatabaseSync: TestDatabaseConstructor
}

function isTestDatabaseModule(value: unknown): value is TestDatabaseModule {
  return (
    value !== null &&
    typeof value === "object" &&
    "Database" in value &&
    typeof value.Database === "function"
  )
}

function isNodeTestDatabaseModule(
  value: unknown
): value is NodeTestDatabaseModule {
  return (
    value !== null &&
    typeof value === "object" &&
    "DatabaseSync" in value &&
    typeof value.DatabaseSync === "function"
  )
}

async function openDatabase(): Promise<TestDatabase> {
  if ("Bun" in globalThis) {
    const sqliteSpecifier = "bun:sqlite"
    const sqliteModule: unknown = await import(sqliteSpecifier)
    if (!isTestDatabaseModule(sqliteModule)) {
      throw new Error("bun:sqlite did not provide a Database constructor")
    }
    return new sqliteModule.Database(":memory:")
  }

  const sqliteSpecifier = "node:sqlite"
  const sqliteModule: unknown = await import(sqliteSpecifier)
  if (!isNodeTestDatabaseModule(sqliteModule)) {
    throw new Error("node:sqlite did not provide a DatabaseSync constructor")
  }
  return new sqliteModule.DatabaseSync(":memory:")
}

describe("several Nu-Tech orders per job (migration 0222)", () => {
  it("numbers existing orders, links the job's newest estimate, and allows more orders", async () => {
    const database = await openDatabase()
    const migration = readFileSync(resolve(process.cwd(), "drizzle/0222_nutech_several_orders.sql"), "utf8")
    try {
      database.exec(`
        CREATE TABLE project_estimates (id text PRIMARY KEY NOT NULL, project_id text NOT NULL, updated_at text NOT NULL);
        CREATE TABLE nutech_order_workflows (id text PRIMARY KEY NOT NULL, project_id text NOT NULL);
        CREATE UNIQUE INDEX nutech_order_workflows_project_uq ON nutech_order_workflows (project_id);
        INSERT INTO project_estimates VALUES ('older', 'job-1', '2026-09-01'), ('newer', 'job-1', '2026-10-01'), ('other', 'job-2', '2026-10-05');
        INSERT INTO nutech_order_workflows VALUES ('order-1', 'job-1');
      `)
      for (const statement of migration.split("--> statement-breakpoint")) database.exec(statement)

      expect(database.prepare("SELECT order_number, estimate_id FROM nutech_order_workflows WHERE id = 'order-1'").get()).toEqual({
        order_number: 1,
        estimate_id: "newer",
      })
      database.exec("INSERT INTO nutech_order_workflows (id, project_id, order_number) VALUES ('order-2', 'job-1', 2)")
      expect(() =>
        database.exec("INSERT INTO nutech_order_workflows (id, project_id, order_number) VALUES ('order-3', 'job-1', 2)"),
      ).toThrow()
    } finally {
      database.close()
    }
  })
})
