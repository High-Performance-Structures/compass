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
  it("tracks journaled migrations against real SQL files in append-only index order", () => {
    const fileTags = new Set(
      readdirSync(join(process.cwd(), "drizzle"))
      .filter((name) => /^\d{4}_.+\.sql$/.test(name))
      .map((name) => name.slice(0, -4))
    )
    const entries = migrationJournalEntries()
    const journalTags = entries.map((entry) => entry.tag)

    expect(journalTags.every((tag) => fileTags.has(tag))).toBe(true)
    expect(new Set(journalTags).size).toBe(journalTags.length)
    expect(entries.map((entry) => entry.idx)).toEqual(
      entries.map((_entry, index) => index)
    )
    expect(journalTags.slice(-7)).toEqual([
      "0160_project_operation_revision",
      "0161_purchase_order_email_claim",
      "0162_purchase_order_email_claim_recovery",
      "0163_nutech_order_item_release_guards",
      "0164_purchase_order_email_reconciliation_evidence",
      "0165_nutech_workbook_claim",
      "0166_nutech_workbook_provider_effect",
    ])
  })

  it("keeps migration ordinals unique and strictly increasing", () => {
    const ordinals = migrationJournalEntries().map((entry) => {
      const match = /^(\d{4})_/.exec(entry.tag)
      if (!match) throw new Error(`Migration tag has no numeric ordinal: ${entry.tag}`)
      return Number(match[1])
    })

    expect(new Set(ordinals).size).toBe(ordinals.length)
    expect(ordinals).toEqual([...ordinals].sort((left, right) => left - right))
  })
})
