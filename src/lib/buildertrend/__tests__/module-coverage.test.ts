import { describe, expect, it } from "vitest"

import {
  moduleForArchiveFileType,
  moduleForSourceRecordType,
  summarizeBuildertrendModuleCoverage,
  type BuildertrendModuleCoverageRow,
} from "@/lib/buildertrend/module-coverage"

function moduleRow(
  rows: readonly BuildertrendModuleCoverageRow[],
  key: BuildertrendModuleCoverageRow["key"]
): BuildertrendModuleCoverageRow {
  const row = rows.find((candidate) => candidate.key === key)
  if (!row) throw new Error(`Missing coverage row for ${key}`)
  return row
}

describe("Buildertrend module coverage", () => {
  it("does not treat source records alone as complete evidence", () => {
    const summary = summarizeBuildertrendModuleCoverage(
      [
        { id: "project-a", status: "OPEN" },
        { id: "project-b", status: "OPEN" },
      ],
      [{ projectId: "project-a", moduleKey: "daily_logs", recordCount: 4 }],
      []
    )

    const dailyLogs = moduleRow(summary.modules, "daily_logs")
    expect(dailyLogs.partialCount).toBe(1)
    expect(dailyLogs.missingCount).toBe(1)
    expect(dailyLogs.verifiedCount).toBe(0)
  })

  it("counts matching captures and explicit empty checks as verified", () => {
    const summary = summarizeBuildertrendModuleCoverage(
      [
        { id: "project-a", status: "OPEN" },
        { id: "project-b", status: "OPEN" },
      ],
      [{ projectId: "project-a", moduleKey: "rfis", recordCount: 3 }],
      [
        {
          projectId: "project-a",
          moduleKey: "rfis",
          status: "captured",
          observedCount: 3,
          checkedAt: "2026-08-17T12:00:00.000Z",
        },
        {
          projectId: "project-b",
          moduleKey: "rfis",
          status: "verified_empty",
          observedCount: 0,
          checkedAt: "2026-08-17T12:00:00.000Z",
        },
      ],
      "2026-08-17T12:00:00.000Z"
    )

    const rfis = moduleRow(summary.modules, "rfis")
    expect(rfis.verifiedCapturedCount).toBe(1)
    expect(rfis.verifiedEmptyCount).toBe(1)
    expect(rfis.completionPercent).toBe(100)
  })

  it("flags count mismatches instead of accepting stale attestations", () => {
    const summary = summarizeBuildertrendModuleCoverage(
      [{ id: "project-a", status: "OPEN" }],
      [{ projectId: "project-a", moduleKey: "tasks", recordCount: 5 }],
      [
        {
          projectId: "project-a",
          moduleKey: "tasks",
          status: "captured",
          observedCount: 4,
          checkedAt: "2026-08-17T12:00:00.000Z",
        },
      ],
      "2026-08-17T12:00:00.000Z"
    )

    expect(moduleRow(summary.modules, "tasks").conflictCount).toBe(1)
  })

  it("does not count stale evidence for a live project as complete", () => {
    const summary = summarizeBuildertrendModuleCoverage(
      [{ id: "project-a", status: "OPEN" }],
      [{ projectId: "project-a", moduleKey: "messages", recordCount: 8 }],
      [
        {
          projectId: "project-a",
          moduleKey: "messages",
          status: "captured",
          observedCount: 8,
          checkedAt: "2026-08-01T12:00:00.000Z",
        },
      ],
      "2026-08-17T12:00:00.000Z"
    )

    const messages = moduleRow(summary.modules, "messages")
    expect(messages.staleCount).toBe(1)
    expect(messages.verifiedCount).toBe(0)
  })

  it("keeps matching historical evidence complete for an inactive project", () => {
    const summary = summarizeBuildertrendModuleCoverage(
      [{ id: "project-a", status: "INACTIVE" }],
      [{ projectId: "project-a", moduleKey: "messages", recordCount: 8 }],
      [
        {
          projectId: "project-a",
          moduleKey: "messages",
          status: "captured",
          observedCount: 8,
          checkedAt: "2026-07-01T12:00:00.000Z",
        },
      ],
      "2026-08-17T12:00:00.000Z"
    )

    expect(moduleRow(summary.modules, "messages").verifiedCapturedCount).toBe(1)
  })

  it("maps staging record and file types to the audited modules", () => {
    expect(moduleForSourceRecordType("estimate_line_item")).toBe("estimates")
    expect(moduleForSourceRecordType("message_claim_detail")).toBe(
      "warranty_claims"
    )
    expect(moduleForArchiveFileType("owner_update_photo")).toBe("photos")
    expect(moduleForArchiveFileType("document")).toBe("files")
    expect(moduleForSourceRecordType("job")).toBeNull()
  })
})
