import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

type Statement = { readonly get: () => unknown; readonly run: () => unknown }
type Database = { readonly exec: (sql: string) => void; readonly prepare: (sql: string) => Statement; readonly close: () => void }
type Module = { readonly Database: new (filename: string) => Database }
function isModule(value: unknown): value is Module { return value !== null && typeof value === "object" && "Database" in value && typeof value.Database === "function" }
async function database(): Promise<Database> {
  const specifier = "bun:sqlite"; const loaded: unknown = await import(specifier); if (!isModule(loaded)) throw new Error("sqlite unavailable")
  const db = new loaded.Database(":memory:"); db.exec("PRAGMA foreign_keys=ON; CREATE TABLE organizations(id TEXT PRIMARY KEY); CREATE TABLE users(id TEXT PRIMARY KEY); CREATE TABLE projects(id TEXT PRIMARY KEY); INSERT INTO organizations VALUES('org'); INSERT INTO users VALUES('user'); INSERT INTO projects VALUES('project');")
  db.exec(readFileSync(resolve(process.cwd(), "drizzle/0158_project_review_durability.sql"), "utf8").replaceAll("--> statement-breakpoint", "")); return db
}
describe("project review durability migration", () => {
  it("keeps a retired project number after permanent project deletion", async () => {
    const db = await database(); db.exec("INSERT INTO project_number_retirements(id,organization_id,former_project_id,project_number,department,sequence,retired_at) VALUES('r','org','project','H-425-515','H',425,'now'); DELETE FROM projects WHERE id='project';")
    expect(db.prepare("SELECT project_number FROM project_number_retirements").get()).toEqual({ project_number: "H-425-515" }); db.close()
  })
  it("prevents reusing a retired department and sequence", async () => {
    const db = await database(); db.exec("INSERT INTO project_number_retirements(id,organization_id,former_project_id,project_number,department,sequence,retired_at) VALUES('r','org','project','H-425-515','H',425,'now')")
    expect(() => db.prepare("INSERT INTO project_number_retirements(id,organization_id,former_project_id,project_number,department,sequence,retired_at) VALUES('r2','org','other','H-425-999','H',425,'now')").run()).toThrow(/UNIQUE constraint failed/); db.close()
  })
})
