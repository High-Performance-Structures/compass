import { describe, expect, it } from "vitest"

import {
  generateBuildertrendScheduleRefreshSql,
  summarizeBuildertrendScheduleRefresh,
} from "./buildertrend-schedule-refresh.mjs"

function fixture() {
  return {
    organizationId: "org-1",
    projectId: "project-1",
    projectNumber: "H-430-1900",
    buildertrendJobId: "45847565",
    capturedAt: "2026-08-15T18:37:21.056Z",
    sourceLabel: "Authenticated schedule capture",
    replaceAllDependencies: true,
    items: [
      {
        sourceHref: "/app/Schedules/5/Schedule/1001/45847565",
        sourceRecordId: "1001",
        compassTaskId: "task-1",
        sortOrder: 1,
        title: "Foundation",
        phase: "Structure",
        complete: true,
        start: "Aug 10, 2026",
        duration: 2,
        end: "Aug 11, 2026",
        percent: 100,
        predecessors: [],
      },
      {
        sourceHref: "/app/Schedules/5/Schedule/1002/45847565",
        sourceRecordId: "1002",
        compassTaskId: "task-2",
        sortOrder: 2,
        title: "Walls",
        phase: "Structure",
        complete: false,
        start: "Aug 12, 2026",
        duration: 3,
        end: "Aug 14, 2026",
        percent: 25,
        predecessors: [
          {
            title: "Foundation - 8-10-2026 to 8-11-2026",
            relation: "Finish-to-Start (FS)",
            lag: 0,
          },
        ],
      },
    ],
  }
}

describe("Buildertrend schedule refresh", () => {
  it("generates guarded, idempotent SQL without user-facing Buildertrend links", () => {
    const output = generateBuildertrendScheduleRefreshSql(fixture())

    expect(output).toContain("INSERT INTO projects SELECT * FROM projects")
    expect(output).toContain("AND NOT (")
    expect(output).toContain("id='task-1' AND title='Foundation'")
    expect(output).toContain("UPDATE schedule_tasks")
    expect(output).toContain("INSERT INTO task_dependencies")
    expect(output).toMatch(/bt-observation-20260815-[a-f0-9]{12}-45847565-1001/)
    expect(output).toContain("buildertrend_url")
    expect(output).toContain("NULL, 'Foundation'")
    expect(output).not.toContain("buildertrend.net")
    expect(output).not.toContain("/app/Schedules")
    expect(summarizeBuildertrendScheduleRefresh(fixture())).toMatchObject({
      itemCount: 2,
      dependencyCount: 1,
      preservesCompassTaskIds: true,
      createsExternalLinks: false,
    })
  })

  it("rejects duplicate sort orders", () => {
    const input = fixture()
    input.items[1].sortOrder = 1
    expect(() => generateBuildertrendScheduleRefreshSql(input)).toThrow(
      "Duplicate sortOrder",
    )
  })

  it("rejects unresolved predecessor references", () => {
    const input = fixture()
    input.items[1].predecessors[0].title =
      "Unknown item - 8-10-2026 to 8-11-2026"
    expect(() => generateBuildertrendScheduleRefreshSql(input)).toThrow(
      "Unknown predecessor",
    )
  })

  it("ignores Buildertrend's untouched predecessor placeholder", () => {
    const input = fixture()
    input.items[0].predecessors = [
      {
        title: "",
        relation: "Finish-to-Start (FS)",
        lag: 0,
      },
    ]

    expect(summarizeBuildertrendScheduleRefresh(input)).toMatchObject({
      dependencyCount: 1,
    })
  })
})
