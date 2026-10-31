import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { ARCHITECTURE_RULES, computeArchitectureMetrics } from "../../../scripts/architecture-metrics.mjs"

/*
 * Enforces docs/development/architecture-standards.md as a ratchet. Existing
 * violations live in architecture-baseline.json and may only shrink:
 *   - a new file, table, or writer that breaks a rule fails;
 *   - a baselined count that grows fails;
 *   - a count that shrinks fails until the baseline is rewritten
 *     (`bun scripts/architecture-baseline.mjs --write`), locking in the gain.
 * Fix the code rather than editing the baseline upward.
 */

const ROOT = process.cwd()

type CountMap = Readonly<Record<string, number>>
type WriterMap = Readonly<Record<string, readonly string[]>>

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function countMap(value: unknown): CountMap {
  if (!isRecord(value)) throw new Error("expected a count map")
  const entries = Object.entries(value).map(([key, count]): [string, number] => {
    if (typeof count !== "number") throw new Error(`expected a count for ${key}`)
    return [key, count]
  })
  return Object.fromEntries(entries)
}

function writerMap(value: unknown): WriterMap {
  if (!isRecord(value)) throw new Error("expected a writer map")
  const entries = Object.entries(value).map(([table, writers]): [string, readonly string[]] => {
    if (!Array.isArray(writers) || !writers.every((writer) => typeof writer === "string")) {
      throw new Error(`expected writer files for ${table}`)
    }
    return [table, writers]
  })
  return Object.fromEntries(entries)
}

function ruleText(rule: string): string {
  const entry = Object.entries(ARCHITECTURE_RULES).find(([key]) => key === rule)
  return entry ? String(entry[1]) : rule
}

const metrics: unknown = computeArchitectureMetrics(ROOT)
const baseline: unknown = JSON.parse(
  readFileSync(join(ROOT, "src/lib/__tests__/architecture-baseline.json"), "utf8"),
)
if (!isRecord(metrics) || !isRecord(baseline)) throw new Error("architecture metrics are malformed")

const STALE = "Baseline is stale after an improvement; run `bun scripts/architecture-baseline.mjs --write`."

const COUNT_RULES = [
  "largeFiles",
  "localHelpers",
  "envCasts",
  "libImportsApp",
  "actionImportsActions",
  "clientPages",
  "handRolledContext",
  "typeAssertions",
  "nonNullAssertions",
  "explicitAny",
  "statusColumnsWithoutList",
] as const

describe("architecture standard", () => {
  for (const rule of COUNT_RULES) {
    it(`${rule} does not grow`, () => {
      const current = countMap(metrics[rule])
      const frozen = countMap(baseline[rule])
      const regressions = Object.entries(current)
        .filter(([path, count]) => count > (frozen[path] ?? 0))
        .map(([path, count]) => `${path}: ${frozen[path] ?? 0} -> ${count}`)
      expect(regressions, ruleText(rule)).toEqual([])

      const improved = Object.entries(frozen)
        .filter(([path, count]) => (current[path] ?? 0) < count)
        .map(([path]) => path)
      expect(improved, STALE).toEqual([])
    })
  }

  it("adds no new writer to any table", () => {
    const current = writerMap(metrics.tableWriters)
    const frozen = writerMap(baseline.tableWriters)
    const newWriters = Object.entries(current).flatMap(([table, writers]) =>
      writers
        .filter((writer) => !(frozen[table] ?? []).includes(writer))
        .map((writer) => `${table}: ${writer}`),
    )
    expect(newWriters, ruleText("tableWriters")).toEqual([])

    const removedWriters = Object.entries(frozen).flatMap(([table, writers]) =>
      writers
        .filter((writer) => !(current[table] ?? []).includes(writer))
        .map((writer) => `${table}: ${writer}`),
    )
    expect(removedWriters, STALE).toEqual([])
  })
})
