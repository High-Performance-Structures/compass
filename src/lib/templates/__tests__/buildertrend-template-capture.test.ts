import { readFile } from "node:fs/promises"

import { describe, expect, it } from "vitest"

import {
  buildBuildertrendTemplateCaptureSql,
  parseBuildertrendTemplateCapture,
} from "../buildertrend-template-capture"
import { parseBuildertrendTemplateInventory } from "../buildertrend-template-inventory"

async function fixture(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"))
}

describe("Buildertrend active template capture", () => {
  it("captures stable metadata for 40 active templates and one pilot schedule", async () => {
    const capture = parseBuildertrendTemplateCapture(
      await fixture(
        "scripts/fixtures/buildertrend-active-template-capture-2026-07-31.json"
      )
    )

    expect(capture.success).toBe(true)
    if (!capture.success) return
    expect(capture.data.templates).toHaveLength(40)
    expect(
      capture.data.templates.some((template) =>
        /^archive(?:d)?\b/i.test(template.name)
      )
    ).toBe(false)
    const pilot = capture.data.templates.find(
      (template) => template.sourceTemplateId === "12978371"
    )
    expect(pilot?.moduleCounts).toMatchObject({
      tasks: 45,
      bidPackages: 2,
      scheduleItems: 9,
    })
    expect(pilot?.schedule?.items).toHaveLength(9)
    expect(pilot?.schedule?.dependencies).toHaveLength(6)
  })

  it("rejects archived source metadata even when the name is not prefixed", () => {
    const capture = parseBuildertrendTemplateCapture({
      capturedAt: "2026-07-31T17:30:00.000Z",
      sourceUrl: "https://buildertrend.net/app/Templates/MyTemplates",
      expectedActiveCount: 1,
      excludedArchivedCount: 0,
      templates: [
        {
          name: "Looks active",
          sourceTemplateId: "123",
          sourceUrl:
            "https://buildertrend.net/app/Templates/MyTemplates/Template/123",
          sourceStatus: "archived",
          scheduleDurationDays: 0,
          moduleCounts: {},
        },
      ],
    })

    expect(capture.success).toBe(false)
    if (capture.success) return
    expect(capture.errors.join(" ")).toContain("Archived template")
  })

  it("rejects cyclic schedule dependencies during capture", () => {
    const capture = parseBuildertrendTemplateCapture({
      capturedAt: "2026-07-31T17:30:00.000Z",
      sourceUrl: "https://buildertrend.net/app/Templates/MyTemplates",
      expectedActiveCount: 1,
      excludedArchivedCount: 0,
      templates: [
        {
          name: "Schedule pilot",
          sourceTemplateId: "123",
          sourceUrl:
            "https://buildertrend.net/app/Templates/MyTemplates/Template/123",
          scheduleDurationDays: 2,
          moduleCounts: { scheduleItems: 2 },
          schedule: {
            sourceAnchorDate: "2026-07-31",
            phases: [{ sourcePhaseId: "1", name: "Pilot" }],
            items: [
              {
                sourceItemId: "1",
                title: "First",
                startDate: "2026-07-31",
                workdays: 1,
                phase: "Pilot",
              },
              {
                sourceItemId: "2",
                title: "Second",
                startDate: "2026-08-03",
                workdays: 1,
                phase: "Pilot",
              },
            ],
            dependencies: [
              {
                predecessorSourceItemId: "1",
                successorSourceItemId: "2",
                type: "FS",
                lagDays: 0,
              },
              {
                predecessorSourceItemId: "2",
                successorSourceItemId: "1",
                type: "FS",
                lagDays: 0,
              },
            ],
          },
        },
      ],
    })

    expect(capture.success).toBe(false)
    if (capture.success) return
    expect(capture.errors.join(" ")).toContain("contains a cycle")
  })

  it("builds draft-only SQL with the pilot schedule anchored by workdays", async () => {
    const inventory = parseBuildertrendTemplateInventory(
      await fixture(
        "scripts/fixtures/buildertrend-active-template-inventory-2026-07-31.json"
      )
    )
    const capture = parseBuildertrendTemplateCapture(
      await fixture(
        "scripts/fixtures/buildertrend-active-template-capture-2026-07-31.json"
      )
    )
    expect(inventory.success).toBe(true)
    expect(capture.success).toBe(true)
    if (!inventory.success || !capture.success) return

    const build = buildBuildertrendTemplateCaptureSql({
      organizationId: "org-test",
      inventory: inventory.data,
      capture: capture.data,
    })

    expect(build.capturedTemplateCount).toBe(40)
    expect(build.capturedScheduleCount).toBe(1)
    expect(build.capturedScheduleItemCount).toBe(9)
    expect(build.sql).toContain("schedule_captured")
    expect(build.sql).toContain("Building Dept. Electrical Rough Inspection")
    expect(build.sql).toContain(
      "bt-template-dependency:12978371:145102245:145102272:FS"
    )
    expect(build.sql).toContain("start_offset_workdays")
    expect(build.sql).not.toContain("'ARCHIVE")
    expect(build.sql).not.toContain("'published'")
    expect(build.sql).not.toContain("BEGIN TRANSACTION")
    expect(build.sql).toContain("project_template_versions.status='draft'")
    expect(build.sql).toContain(
      "WHEN project_templates.review_status='verified'"
    )

    expect(() =>
      buildBuildertrendTemplateCaptureSql({
        organizationId: "org-test",
        inventory: inventory.data,
        capture: {
          ...capture.data,
          templates: capture.data.templates.slice(1),
        },
      })
    ).toThrow("every active inventory template")
  })
})
