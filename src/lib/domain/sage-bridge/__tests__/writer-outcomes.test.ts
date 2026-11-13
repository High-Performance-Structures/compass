import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import {
  AR_INVOICE_NO_WRITE_MESSAGES,
  COMPANY_ADD_NO_WRITE_MESSAGES,
  writerWroteNothing,
  writerWroteNothingSql,
} from "@/lib/domain/sage-bridge/writer-outcomes"

/*
 * The closed lists of the writer's nothing-written outcomes against the
 * installed writer's own source: if its wording changes, this fails, and the
 * lists (which decide whether an invoice may already be in Sage) must change
 * with it.
 */

const AR_WRITER = readFileSync("scripts/Sage.100.Contractor.CompassArInvoiceWriter.cs", "utf8")
const CLIENT_WRITER = readFileSync("scripts/Sage.100.Contractor.CompassClientProjectWriter.cs", "utf8")

/** The text of each `throw new …Exception("…" + … + "…")` in `source`, dynamic parts left out. */
function thrownMessages(source: string): readonly string[] {
  return [...source.matchAll(/throw new \w*Exception\(((?:"(?:[^"\\]|\\.)*"|[^;])*?)\);/g)]
    .map((match) => [...(match[1] ?? "").matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((part) => part[1]).join(""))
}

/** The part of `source` from `start` up to (not including) `end`. */
function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from)
  if (from < 0 || to < 0) throw new Error(`writer source changed: ${start} … ${end} not found`)
  return source.slice(from, to)
}

describe("the AR invoice writer's nothing-written outcomes", () => {
  it("every failure before the submit is on the list", () => {
    const beforeSubmit = between(AR_WRITER, "private static void ProcessArInvoice", 'RunStage("submit Sage AR invoice add"')
    const checks = between(AR_WRITER, "private static void RequireArInvoiceReferences", "private const string ArInvoiceRowsSql")
    const messages = [...thrownMessages(beforeSubmit), ...thrownMessages(checks)]
    expect(messages.length).toBeGreaterThan(10)
    for (const message of messages) expect(writerWroteNothing(AR_INVOICE_NO_WRITE_MESSAGES, message), message).toBe(true)
  })

  it("the stage names on the list run before the submit, worded as the writer words them", () => {
    const beforeSubmit = between(AR_WRITER, "private static void ProcessArInvoice", 'RunStage("submit Sage AR invoice add"')
    for (const rule of AR_INVOICE_NO_WRITE_MESSAGES.filter((entry) => entry.text.endsWith(" failed:"))) {
      expect(beforeSubmit, rule.text).toContain(`RunStage("${rule.text.slice(0, -" failed:".length)}"`)
    }
    expect(CLIENT_WRITER).toContain('throw new InvalidOperationException(stage + " failed: "')
  })

  it("a failed submit or a write that doesn't read back is not on the list", () => {
    expect(writerWroteNothing(AR_INVOICE_NO_WRITE_MESSAGES, "submit Sage AR invoice add failed: COMException: timeout")).toBe(false)
    const readBack = thrownMessages(between(AR_WRITER, "Sage commits accepted requests", "private static void ProcessArInvoice"))
    expect(readBack.some((message) => message.startsWith("Sage accepted the invoice but it doesn't read back"))).toBe(true)
    for (const message of readBack) expect(writerWroteNothing(AR_INVOICE_NO_WRITE_MESSAGES, message), message).toBe(false)
    expect(writerWroteNothing(AR_INVOICE_NO_WRITE_MESSAGES, null)).toBe(false)
  })

  it("the SQL form uses texts with no LIKE wildcards", () => {
    for (const rule of [...AR_INVOICE_NO_WRITE_MESSAGES, ...COMPANY_ADD_NO_WRITE_MESSAGES]) expect(rule.text).not.toMatch(/[%_]/)
    expect(writerWroteNothingSql(AR_INVOICE_NO_WRITE_MESSAGES)).toContain("error_message LIKE '%no write was attempted%'")
  })
})

describe("the company add writer's nothing-written outcomes", () => {
  it("every failure before the vendor submit is on the list", () => {
    const vendor = between(CLIENT_WRITER, "private static WriteOutcome ProcessEnsureVendor", 'RunStage("submit Sage vendor add"')
    const messages = thrownMessages(vendor)
    expect(messages.length).toBeGreaterThan(2)
    for (const message of messages) expect(writerWroteNothing(COMPANY_ADD_NO_WRITE_MESSAGES, message), message).toBe(true)
  })

  it("each prefix on the list is the writer's own wording", () => {
    for (const rule of COMPANY_ADD_NO_WRITE_MESSAGES.filter((entry) => entry.kind === "prefix")) {
      const text = rule.text.endsWith(" failed:") ? `RunStage("${rule.text.slice(0, -" failed:".length)}"` : rule.text
      expect(CLIENT_WRITER, rule.text).toContain(text)
    }
    expect(writerWroteNothing(COMPANY_ADD_NO_WRITE_MESSAGES, "submit Sage vendor add failed: timeout")).toBe(false)
  })
})
