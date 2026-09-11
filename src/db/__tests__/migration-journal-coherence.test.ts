import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function migrationJournalEntries(): readonly {
  readonly idx: number
  readonly tag: string
}[] {
  const parsed: unknown = JSON.parse(
    readFileSync(join(process.cwd(), "drizzle/meta/_journal.json"), "utf8")
  )
  if (!isRecord(parsed) || !Array.isArray(parsed.entries)) {
    throw new Error("Drizzle migration journal has no entries array")
  }
  return parsed.entries.map((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry.idx !== "number" ||
      typeof entry.tag !== "string"
    ) {
      throw new Error("Drizzle migration journal contains an invalid entry")
    }
    return { idx: entry.idx, tag: entry.tag }
  })
}

describe("D1 migration journal coherence", () => {
  it("tracks every numbered SQL migration exactly once in Wrangler filename order", () => {
    const fileTags = readdirSync(join(process.cwd(), "drizzle"))
      .filter((name) => /^\d{4}_.+\.sql$/.test(name))
      .sort((left, right) => left.localeCompare(right))
      .map((name) => name.slice(0, -4))
    const entries = migrationJournalEntries()
    const journalTags = entries.map((entry) => entry.tag)

    expect(journalTags).toEqual(fileTags)
    expect(new Set(journalTags).size).toBe(journalTags.length)
    expect(entries.map((entry) => entry.idx)).toEqual(
      entries.map((_entry, index) => index)
    )
  })
})
