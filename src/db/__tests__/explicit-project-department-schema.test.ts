import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

type TestStatement = {
  readonly all: () => unknown
  readonly get: () => unknown
  readonly run: () => unknown
}

type TestDatabase = {
  readonly exec: (query: string) => void
  readonly prepare: (query: string) => TestStatement
  readonly close: () => void
}

type TestDatabaseModule = {
  readonly Database: new (filename: string) => TestDatabase
}

type NodeTestDatabaseModule = {
  readonly DatabaseSync: new (filename: string) => TestDatabase
}

function isTestDatabaseModule(value: unknown): value is TestDatabaseModule {
  return value !== null && typeof value === "object" && "Database" in value &&
    typeof value.Database === "function"
}

function isNodeTestDatabaseModule(value: unknown): value is NodeTestDatabaseModule {
  return value !== null && typeof value === "object" && "DatabaseSync" in value &&
    typeof value.DatabaseSync === "function"
}

async function createDatabase(): Promise<TestDatabase> {
  let database: TestDatabase
  if ("Bun" in globalThis) {
    const sqliteSpecifier = "bun:sqlite"
    const sqliteModule: unknown = await import(sqliteSpecifier)
    if (!isTestDatabaseModule(sqliteModule)) {
      throw new Error("bun:sqlite did not provide a Database constructor")
    }
    database = new sqliteModule.Database(":memory:")
  } else {
    const sqliteSpecifier = "node:sqlite"
    const sqliteModule: unknown = await import(sqliteSpecifier)
    if (!isNodeTestDatabaseModule(sqliteModule)) {
      throw new Error("node:sqlite did not provide a DatabaseSync constructor")
    }
    database = new sqliteModule.DatabaseSync(":memory:")
  }
  database.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY NOT NULL,
      project_number TEXT,
      buildertrend_project_id TEXT
    );
    INSERT INTO projects (id, project_number, buildertrend_project_id) VALUES
      ('proj-bt-nu-tech-job', NULL, '10555479'),
      ('numbered-o', 'O-170-2684', NULL),
      ('numbered-h', 'H-OFFICE', NULL),
      ('proj-bt-d-design-work', NULL, NULL),
      ('ambiguous-project', NULL, NULL);
  `)
  const sql = readFileSync(
    resolve(process.cwd(), "drizzle/0144_explicit_project_department.sql"),
    "utf8",
  ).replaceAll("--> statement-breakpoint", "")
  database.exec(sql)
  return database
}

describe("explicit project department migration", () => {
  it("backfills known departments without guessing ambiguous projects", async () => {
    const database = await createDatabase()
    expect(database.prepare("SELECT id, department FROM projects ORDER BY id").all()).toEqual([
      { id: "ambiguous-project", department: null },
      { id: "numbered-h", department: "H" },
      { id: "numbered-o", department: "O" },
      { id: "proj-bt-d-design-work", department: "D" },
      { id: "proj-bt-nu-tech-job", department: "N" },
    ])
    database.close()
  })

  it("rejects invalid departments", async () => {
    const database = await createDatabase()
    expect(() => database.prepare(
      "UPDATE projects SET department = 'X' WHERE id = 'ambiguous-project'",
    ).run()).toThrow(/CHECK constraint failed/)
    database.close()
  })
})
