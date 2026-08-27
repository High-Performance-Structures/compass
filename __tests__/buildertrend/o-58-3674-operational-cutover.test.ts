import { describe, expect, it } from "vitest"
import { readFile } from "node:fs/promises"

import {
  generateO583674OperationalCutover,
  summarizeO583674OperationalCutover,
} from "../../scripts/lib/o-58-3674-operational-cutover.mjs"

const fixturePath = new URL(
  "../../scripts/fixtures/o-58-3674-operational-cutover.json",
  import.meta.url
)

async function fixture(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(fixturePath, "utf8"))
}

describe("O-58-3674 standard operational cutover", () => {
  it("targets the current 230-activity live schedule only", async () => {
    const input = await fixture()
    const summary = summarizeO583674OperationalCutover(input)

    expect(summary).toMatchObject({
      projectId: "proj-bt-o-58-3674-forest",
      buildertrendJobId: "5072748",
      currentScheduleCapturedAt: "2026-08-27T04:57:12.745Z",
      scheduleActivities: 230,
      historicalScheduleSnapshots: 0,
      derivedReviewRecords: 0,
      nonOperationalDocuments: 0,
    })
  })

  it("uses only existing operational tables and ordinary daily-log attachments", async () => {
    const output = generateO583674OperationalCutover(await fixture())
    const sql = output.canonicalSql

    expect(sql.match(/INSERT INTO schedule_tasks/g)).toHaveLength(230)
    expect(sql.match(/INSERT INTO buildertrend_staging_records/g)).toHaveLength(230)
    expect(sql.match(/INSERT INTO schedule_task_links/g)).toHaveLength(230)
    expect(sql.match(/'weather_observation'/g)?.length).toBeGreaterThanOrEqual(77)
    expect(sql.match(/'procurement_evidence'/g)?.length).toBeGreaterThanOrEqual(7)
    expect(sql.match(/INSERT INTO daily_log_photos/g)).toHaveLength(12)

    const mutatedTables = [
      ...sql.matchAll(/^(?:INSERT INTO|UPDATE) ([a-z_]+)/gm),
    ].map((match) => match[1])
    expect(new Set(mutatedTables)).toEqual(
      new Set([
        "projects",
        "buildertrend_staging_runs",
        "schedule_tasks",
        "buildertrend_staging_records",
        "schedule_task_links",
        "buildertrend_module_attestations",
        "daily_logs",
        "daily_log_photos",
      ])
    )
    expect(sql).not.toMatch(/\b(?:DELETE|DROP|ALTER|TRUNCATE)\b/i)
    expect(sql).not.toContain("2026-07-24T01:30:45.347Z")
    expect(sql).not.toContain("2026-08-27T04:09:49.358Z")
  })

  it("keeps weather text neutral and source metadata explicit", async () => {
    const input = await fixture()
    const weatherEvents = input.weatherEvents
    expect(Array.isArray(weatherEvents)).toBe(true)
    if (!Array.isArray(weatherEvents)) return
    expect(weatherEvents).toHaveLength(77)

    for (const event of weatherEvents) {
      expect(event).toMatchObject({
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        provider: expect.any(String),
        sourceKind: expect.any(String),
        sourceUrl: expect.stringMatching(/^https:\/\//),
        timezone: "America/Denver",
      })
      expect(JSON.stringify(event)).not.toMatch(
        /\b(delay|stall|impact|no[- ]work|not conducive|caus(?:e|ed|ation))\b/i
      )
    }
  })

  it("preserves protected operational counts and deterministic rerun guards", async () => {
    const output = generateO583674OperationalCutover(await fixture())
    const summary = output.summary
    expect(summary).toMatchObject({
      protectedBuildertrendDailyLogs: 249,
      neutralWeatherDailyLogs: 77,
      procurementDailyLogs: 7,
      procurementAttachments: 12,
      buildertrendWrites: 0,
      preExistingImmutablePriorOnlySourceRows: 2,
      importedPriorScheduleRows: 0,
      deletes: 0,
    })
    expect(output.canonicalSql).toContain("source_record_type='change_order')=28")
    expect(output.canonicalSql).toContain("source_record_type='rfi')=1")
    expect(output.canonicalSql).toContain("source_record_type='rfq')=0")
    expect(output.canonicalSql).toContain("source_record_type='estimate')=1")
    expect(output.canonicalSql).toContain("source_record_type='message')=227")
    expect(output.canonicalSql).toContain("source_record_type='owner_invoice')=21")
    expect(output.canonicalSql).toContain("source_external_id='85012183')=0")
    expect(output.canonicalSql).toContain("BEGIN IMMEDIATE;")
    expect(output.canonicalSql).toContain("COMMIT;")
    expect(output.statements.every((statement) => statement.endsWith(";"))).toBe(true)
  })
})
