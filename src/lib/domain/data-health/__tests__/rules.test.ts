import { describe, expect, it } from "vitest"

import {
  HEALTHY_FINGERPRINT,
  driftFingerprint,
  driftNotice,
  findingsByValue,
  schemaDrift,
  shouldNotify,
  type DataHealthReport,
  type SchemaDrift,
  type StatusFinding,
} from "../rules"

const NO_SCHEMA_DRIFT: SchemaDrift = { extraTables: [], extraColumns: [], missingTables: [], missingColumns: [], known: [] }

function finding(overrides: Partial<StatusFinding> = {}): StatusFinding {
  return { check: "change order", table: "project_change_orders", column: "status", organizationId: "org-a", value: "approved", rows: 3, ...overrides }
}

function report(findings: readonly StatusFinding[], schema = NO_SCHEMA_DRIFT): DataHealthReport {
  return { checkedAt: "2026-11-13T12:00:00Z", statusChecks: 30, statusFindings: findings, schema }
}

describe("schemaDrift", () => {
  it("separates extra, missing and known differences and skips D1's own tables", () => {
    const declared = new Map([
      ["projects", ["id", "name"]],
      ["users", ["id"]],
      ["notification_preferences", ["id"]],
    ])
    const live = new Map([
      ["projects", ["id", "legacy"]],
      ["notification_preferences", ["id", "timezone"]],
      ["old_table", ["id"]],
      ["project_agreements", ["id"]],
      ["_cf_KV", ["key"]],
      ["d1_migrations", ["id"]],
      ["sqlite_sequence", ["name"]],
    ])
    const known = [
      { kind: "table", table: "project_agreements", reason: "x" },
      { kind: "column", table: "notification_preferences", column: "timezone", reason: "x" },
    ] as const
    expect(schemaDrift(declared, live, known)).toEqual({
      extraTables: ["old_table"],
      extraColumns: ["projects.legacy"],
      missingTables: ["users"],
      missingColumns: ["projects.name"],
      known: ["notification_preferences.timezone", "project_agreements"],
    })
  })
})

describe("driftFingerprint", () => {
  it("is healthy for a clean report", () => {
    expect(driftFingerprint(report([]))).toBe(HEALTHY_FINGERPRINT)
  })

  it("ignores row counts and which company, but not which values", () => {
    const base = driftFingerprint(report([finding()]))
    expect(driftFingerprint(report([finding({ rows: 900 })]))).toBe(base)
    expect(driftFingerprint(report([finding({ organizationId: null })]))).toBe(base)
    expect(driftFingerprint(report([finding({ value: "pending" })]))).not.toBe(base)
    expect(driftFingerprint(report([finding()], { ...NO_SCHEMA_DRIFT, extraTables: ["old"] }))).not.toBe(base)
  })
})

describe("shouldNotify", () => {
  it("tells a company only when its drift changes or clears", () => {
    expect(shouldNotify(null, HEALTHY_FINGERPRINT)).toBe(false)
    expect(shouldNotify(null, "drift:a")).toBe(true)
    expect(shouldNotify("drift:a", "drift:a")).toBe(false)
    expect(shouldNotify("drift:a", "drift:b")).toBe(true)
    expect(shouldNotify("drift:a", HEALTHY_FINGERPRINT)).toBe(true)
    expect(shouldNotify(HEALTHY_FINGERPRINT, HEALTHY_FINGERPRINT)).toBe(false)
  })
})

describe("driftNotice", () => {
  it("summarizes findings with counts and caps the list", () => {
    const findings = Array.from({ length: 12 }, (_, index) => finding({ value: `bad_${index}` }))
    const notice = driftNotice(report(findings, { ...NO_SCHEMA_DRIFT, extraColumns: ["users.old"] }))
    expect(notice.title).toBe("Data health: 12 unexpected status values and 1 schema difference")
    expect(notice.body).toContain('project_change_orders.status = "bad_0" (3 rows, not allowed by the change order statuses)')
    expect(notice.body).toContain("- and 5 more")
  })

  it("merges one value across companies", () => {
    expect(findingsByValue([finding(), finding({ organizationId: "org-b", rows: 2 })])).toEqual([finding({ organizationId: null, rows: 5 })])
  })
})
