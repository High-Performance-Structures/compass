import { readdirSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

describe("D1 migration ordinals", () => {
  it("uses one SQL migration per ordinal", () => {
    const migrationDirectory = join(process.cwd(), "drizzle")
    const ordinals = readdirSync(migrationDirectory)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => name.match(/^(\d+)_/)?.[1] ?? null)
      .filter((ordinal): ordinal is string => ordinal !== null)

    expect(new Set(ordinals).size).toBe(ordinals.length)
  })
})
