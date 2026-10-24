import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

describe("owner-update write-fencing migration", () => {
  it("is appended after the current migration tail", () => {
    const migrationPath = resolve(
      process.cwd(),
      "drizzle/0243_owner_update_write_fencing.sql"
    )
    expect(
      existsSync(resolve(process.cwd(), "drizzle/0234_owner_update_write_fencing.sql"))
    ).toBe(false)
    expect(
      existsSync(resolve(process.cwd(), "drizzle/0242_estimate_assembly_client_detail.sql"))
    ).toBe(true)
    expect(
      existsSync(resolve(process.cwd(), "drizzle/0243_owner_update_write_fencing.sql"))
    ).toBe(true)
    const sql = readFileSync(migrationPath, "utf8")

    expect(sql).toContain("ALTER TABLE `owner_project_updates`")
    expect(sql).toContain("ADD `revision` integer DEFAULT 0 NOT NULL")
  })
})
