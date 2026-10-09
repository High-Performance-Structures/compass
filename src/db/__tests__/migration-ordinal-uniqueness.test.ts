import { readdirSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

describe("owner-update migration numbering", () => {
  it("keeps the write-fencing migration after current main's 0193 migration", () => {
    const migrationDirectory = join(process.cwd(), "drizzle")
    const migrations = readdirSync(migrationDirectory)

    expect(migrations).toContain("0193_travel_charges_and_site_location.sql")
    expect(migrations).toContain("0194_owner_update_write_fencing.sql")
    expect(
      migrations.some((name) => name.startsWith("0193_owner_update"))
    ).toBe(false)
  })
})
