import { readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { SCHEMA_MODULES, declaredTableColumns } from "../declared-schema"

describe("declared schema", () => {
  it("imports every schema file, so the drift detector knows every table", () => {
    const files = [
      ...readdirSync(join(process.cwd(), "src/db"))
        .filter((file) => /^schema.*\.ts$/.test(file))
        .map((file) => `src/db/${file}`),
      "src/lib/sync/schema.ts",
    ].sort()
    expect(SCHEMA_MODULES.map(([path]) => path).sort()).toEqual(files)
  })

  it("reads tables and their columns", () => {
    const tables = declaredTableColumns()
    expect(tables.get("projects")).toContain("organization_id")
    expect(tables.get("local_sync_metadata")).toContain("vector_clock")
  })
})
