import { describe, expect, it } from "vitest"

import {
  generateBuildertrendScheduleStatusRefreshSql,
  summarizeBuildertrendScheduleStatusRefresh,
} from "./buildertrend-schedule-status-refresh.mjs"

function fixture() {
  return {
    organizationId: "org-1",
    projectId: "project-1",
    projectNumber: "O-170-2684",
    buildertrendJobId: "35400494",
    capturedAt: "2026-08-15T19:12:32.255Z",
    sourceLabel: "Authenticated schedule status capture",
    expectedCompassTaskCount: 3,
    items: [
      {
        sourceRecordId: "1001",
        sourceHref: "/app/Schedules/5/Schedule/1001/35400494",
        title: "Foundation",
        percent: 100,
      },
      {
        sourceRecordId: "1002",
        sourceHref: "/app/Schedules/5/Schedule/1002/35400494",
        title: "Walls",
        percent: 25,
      },
    ],
  }
}

describe("Buildertrend schedule status refresh", () => {
  it("updates only status fields with guarded promoted mappings", () => {
    const output = generateBuildertrendScheduleStatusRefreshSql(fixture())

    expect(output).toContain("INSERT INTO projects SELECT * FROM projects")
    expect(output).toContain("source.buildertrend_record_id IN ('1001', '1002')")
    expect(output).not.toContain("task.title IN")
    expect(output).toContain("UPDATE schedule_tasks AS task SET status=CASE")
    expect(output).toContain("WHEN '1001' THEN 'COMPLETE'")
    expect(output).toContain("WHEN '1002' THEN 'IN_PROGRESS'")
    expect(output).toContain("UPDATE buildertrend_staging_records AS source")
    expect(output).toContain("source.id, CASE source.buildertrend_record_id")
    expect(output).not.toContain("source_key=")
    expect(output).not.toContain("start_date=")
    expect(output).not.toContain("task_dependencies")
    expect(output).not.toContain("buildertrend.net")
    expect(output).not.toContain("/app/Schedules")
    expect(summarizeBuildertrendScheduleStatusRefresh(fixture())).toMatchObject({
      sourceItemCount: 2,
      expectedCompassTaskCount: 3,
      completeItems: 1,
      inProgressItems: 1,
      pendingItems: 0,
      createsExternalLinks: false,
    })
  })

  it("rejects a source count larger than the Compass task count", () => {
    const input = fixture()
    input.expectedCompassTaskCount = 1
    expect(() => generateBuildertrendScheduleStatusRefreshSql(input)).toThrow(
      "cannot be smaller",
    )
  })

  it("rejects duplicate source records", () => {
    const input = fixture()
    input.items[1].sourceRecordId = "1001"
    input.items[1].sourceHref = "/app/Schedules/5/Schedule/1001/35400494"
    expect(() => generateBuildertrendScheduleStatusRefreshSql(input)).toThrow(
      "Duplicate sourceRecordId",
    )
  })

  it("rejects invalid completion percentages", () => {
    const input = fixture()
    input.items[1].percent = 101
    expect(() => generateBuildertrendScheduleStatusRefreshSql(input)).toThrow(
      "Invalid percent",
    )
  })
})
