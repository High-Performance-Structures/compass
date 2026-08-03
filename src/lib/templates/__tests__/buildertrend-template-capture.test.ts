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
  it("captures all active Buildertrend schedule templates", async () => {
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
    expect(
      capture.data.templates.filter((template) => template.schedule !== null)
    ).toHaveLength(30)
    expect(
      capture.data.templates.reduce(
        (count, template) => count + (template.schedule?.items.length ?? 0),
        0
      )
    ).toBe(163)
    expect(
      capture.data.templates.reduce(
        (count, template) =>
          count + (template.schedule?.dependencies.length ?? 0),
        0
      )
    ).toBe(144)
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

  it("preserves captured schedule fields and accepts negative predecessor lag", () => {
    const capture = parseBuildertrendTemplateCapture({
      capturedAt: "2026-08-03T15:00:00.000Z",
      sourceUrl: "https://buildertrend.net/app/Templates/MyTemplates",
      expectedActiveCount: 1,
      excludedArchivedCount: 0,
      templates: [
        {
          name: "Captured schedule",
          sourceTemplateId: "123",
          sourceUrl:
            "https://buildertrend.net/app/Templates/MyTemplates/Template/123",
          scheduleDurationDays: 2,
          moduleCounts: { scheduleItems: 2 },
          schedule: {
            sourceAnchorDate: "2026-08-03",
            phases: [{ sourcePhaseId: "1", name: "Concrete" }],
            items: [
              {
                sourceItemId: "1",
                title: "Layout",
                startDate: "2026-08-03",
                workdays: 1,
                phase: "Concrete",
                displayColor: "#dd2222",
                isMilestone: false,
                assigneePlaceholder: "Concrete crew",
                ownerVisible: true,
                subVendorVisible: true,
                notes: "Buildertrend note",
              },
              {
                sourceItemId: "2",
                title: "Pour",
                startDate: "2026-08-04",
                workdays: 1,
                phase: "Concrete",
                displayColor: "green",
              },
            ],
            dependencies: [
              {
                predecessorSourceItemId: "1",
                successorSourceItemId: "2",
                type: "FS",
                lagDays: -1,
              },
            ],
          },
        },
      ],
    })

    expect(capture.success).toBe(true)
    if (!capture.success) return
    expect(capture.data.templates[0]?.schedule?.items[0]).toMatchObject({
      displayColor: "#dd2222",
      assigneePlaceholder: "Concrete crew",
      ownerVisible: true,
      subVendorVisible: true,
      notes: "Buildertrend note",
    })
    expect(capture.data.templates[0]?.schedule?.dependencies[0]?.lagDays).toBe(-1)
  })

  it("builds guarded SQL for all captured schedules", async () => {
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
    expect(build.capturedScheduleCount).toBe(30)
    expect(build.capturedScheduleItemCount).toBe(163)
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

    const publishBuild = buildBuildertrendTemplateCaptureSql({
      organizationId: "org-test",
      inventory: inventory.data,
      capture: capture.data,
      publishCapturedSchedules: true,
    })
    expect(publishBuild.sql).toContain("status='published'")
    expect(publishBuild.sql).toContain(
      "(SELECT COUNT(*) FROM schedule_template_items"
    )
    expect(publishBuild.sql).toContain(
      "(SELECT COUNT(*) FROM schedule_template_dependencies"
    )
    expect(publishBuild.sql).toContain("review_status='verified'")

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
