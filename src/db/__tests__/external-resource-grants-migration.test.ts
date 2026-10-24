import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

describe("external resource grant migration", () => {
  it("adds audience-bound photo and owner-update document grants after fencing", () => {
    const migrationPath = resolve(
      process.cwd(),
      "drizzle/0244_external_resource_grants.sql"
    )
    expect(existsSync(migrationPath)).toBe(true)
    const sql = readFileSync(migrationPath, "utf8")

    expect(sql).toContain("CREATE TABLE `project_external_resource_grants`")
    expect(sql).toContain("'owner_update_document'")
    expect(sql).toContain("`audience`")
    expect(sql).toContain("project_external_resource_grants_resource_guard_insert")
    expect(sql).toContain("project_external_resource_grants_revocation_guard")
  })
})
