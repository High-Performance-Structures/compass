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

describe("D1 migration authority and Drizzle metadata", () => {
  it("validates Wrangler's complete lexical SQL migration order", () => {
    const migrationFiles = readdirSync(join(process.cwd(), "drizzle"))
      .filter((name) => /^\d{4}_.+\.sql$/.test(name))
      .sort()
    const migrationTags = migrationFiles.map((name) => name.slice(0, -4))

    // Wrangler D1 is the production executor and orders the complete filename
    // set. Numeric prefixes are historical and are not unique in this repo.
    expect(migrationFiles).toEqual([...migrationFiles].sort())
    expect(new Set(migrationTags).size).toBe(migrationTags.length)
    expect(migrationTags.slice(-9)).toEqual([
      "0160_project_operation_revision",
      "0161_purchase_order_email_claim",
      "0162_purchase_order_email_claim_recovery",
      "0163_nutech_order_item_release_guards",
      "0164_purchase_order_email_reconciliation_evidence",
      "0165_nutech_workbook_claim",
      "0166_nutech_workbook_provider_effect",
      "0167_nutech_purchase_order_release_token",
      "0168_nutech_vendor_invoice_release_guard",
    ])
  })

  it("keeps the Drizzle subset append-only without claiming it is the D1 manifest", () => {
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
    expect(journalTags.slice(-9)).toEqual([
      "0160_project_operation_revision",
      "0161_purchase_order_email_claim",
      "0162_purchase_order_email_claim_recovery",
      "0163_nutech_order_item_release_guards",
      "0164_purchase_order_email_reconciliation_evidence",
      "0165_nutech_workbook_claim",
      "0166_nutech_workbook_provider_effect",
      "0167_nutech_purchase_order_release_token",
      "0168_nutech_vendor_invoice_release_guard",
    ])
  })
})
