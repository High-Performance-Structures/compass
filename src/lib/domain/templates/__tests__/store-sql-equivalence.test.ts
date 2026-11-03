import { describe, expect, it } from "vitest"

import {
  insertTemplateEstimateLineStatement,
  insertTemplateEstimateStatement,
  reorderEstimateLinesStatements,
} from "@/lib/domain/estimates/store"
import {
  completeTemplateApplicationStatement,
  estimateTemplateDraftStatements,
  estimateTemplateRevisionStatements,
  insertAppliedScheduleItemsApplicationStatement,
  insertEstimateTemplateApplicationStatement,
  insertProjectTemplateApplicationStatement,
  insertTemplateApplicationItemStatement,
  publishCapturedTemplateStatements,
  savedScheduleTemplateStatements,
} from "@/lib/domain/templates/store"

import original from "./fixtures/original-sql.json"

/*
 * The SQL each moved statement prepares must be the exact text the actions
 * prepared on main (fixtures/original-sql.json was extracted from those
 * files), with the same bound values in the same order.
 */

type Recorded = { readonly sql: string; readonly values: readonly unknown[] }

function recordingDb(): D1Database {
  const prepare = (sql: string): D1PreparedStatement => {
    const statement = {
      sql,
      values: [] as unknown[],
      bind(...values: unknown[]) {
        return { ...statement, values }
      },
    }
    return statement as unknown as D1PreparedStatement
  }
  return { prepare } as unknown as D1Database
}

function recorded(statement: D1PreparedStatement): Recorded {
  return statement as unknown as Recorded
}

const normalize = (sql: string): string => sql.replace(/\s+/g, " ").trim()

const db = recordingDb()
const now = "2026-10-31T12:00:00.000Z"

describe("estimate template statements", () => {
  it("creates a draft with the original four statements", () => {
    const statements = estimateTemplateDraftStatements(db, {
      id: "t1",
      versionId: "v1",
      moduleId: "m1",
      organizationId: "org",
      name: "Deck",
      description: null,
      createdBy: "u1",
      now,
    }).map(recorded)
    expect(statements.map((s) => s.sql)).toEqual([
      original.estimateDraftTemplate,
      original.estimateDraftVersion,
      original.estimateDraftModule,
      original.estimateDraftDefaults,
    ])
    expect(statements.map((s) => s.values)).toEqual([
      ["t1", "org", "compass:t1", "Deck", null, "u1", now, now],
      ["v1", "t1", "u1", now],
      ["m1", "v1"],
      ["v1"],
    ])
  })

  it("copies a revision's defaults and lines with booleans as 0/1", () => {
    const statements = estimateTemplateRevisionStatements(db, {
      templateId: "t1",
      versionId: "v2",
      moduleId: "m2",
      versionNumber: 2,
      notes: "Revision of version 1",
      createdBy: "u1",
      now,
      defaults: { documentTitle: "Estimate", contractTerms: "Terms", defaultMarkupRateBasisPoints: 1500 },
      lines: [
        {
          id: "l-new",
          versionId: "v1",
          itemKey: "k1",
          divisionCode: "06",
          divisionName: "Wood",
          costCode: "06-100",
          costCodeName: "Framing",
          description: "Frame",
          specifications: null,
          quantity: 2,
          unit: "LS",
          unitCostCents: 1000,
          markupRateBasisPoints: 500,
          taxable: true,
          taxCode: null,
          ownerVisible: false,
          sortOrder: 3,
        },
      ],
    }).map(recorded)
    expect(statements.map((s) => s.sql)).toEqual([
      original.estimateRevisionVersion,
      original.estimateRevisionModule,
      original.estimateRevisionDefaults,
      original.estimateRevisionLine,
    ])
    expect(statements.map((s) => s.values)).toEqual([
      ["v2", "t1", 2, "Revision of version 1", "u1", now],
      ["m2", "v2", 1],
      ["v2", "Estimate", "Terms", 1500],
      ["l-new", "v2", "k1", "06", "Wood", "06-100", "Framing", "Frame", null, 2, "LS", 1000, 500, 1, null, 0, 3],
    ])
  })
})

describe("template applications", () => {
  const base = {
    id: "a1",
    organizationId: "org",
    projectId: "p1",
    templateId: "t1",
    versionId: "v1",
    anchorDate: "2026-11-02",
    appliedBy: "u1",
    itemCount: 4,
    optionsJson: "{}",
    now,
  }

  it("keeps each application insert's text and bindings", () => {
    const estimate = recorded(insertEstimateTemplateApplicationStatement(db, base))
    expect(estimate.sql).toBe(original.estimateApplication)
    expect(estimate.values).toEqual(["a1", "org", "p1", "t1", "v1", "2026-11-02", "u1", 4, "{}", now])

    const project = recorded(insertProjectTemplateApplicationStatement(db, { ...base, dependencyCount: 2 }))
    expect(project.sql).toBe(original.projectApplication)
    expect(project.values).toEqual(["a1", "org", "p1", "t1", "v1", "2026-11-02", "u1", 4, 2, "{}", now])

    const imported = recorded(insertAppliedScheduleItemsApplicationStatement(db, { ...base, dependencyCount: 2 }))
    expect(imported.sql).toBe(original.importApplication)
    expect(imported.values).toEqual(["a1", "org", "p1", "t1", "v1", "2026-11-02", "u1", 4, 2, "{}", now, now])
  })

  it("links items and completes the application", () => {
    const item = recorded(
      insertTemplateApplicationItemStatement(db, {
        id: "i1",
        applicationId: "a1",
        templateItemId: "ti1",
        scheduleTaskId: "st1",
      })
    )
    expect(item.sql).toBe(original.projectApplicationItem)
    expect(item.values).toEqual(["i1", "a1", "ti1", "st1"])

    const complete = recorded(completeTemplateApplicationStatement(db, "a1", now))
    expect(complete.sql).toBe(original.projectApplicationComplete)
    // The estimate action wrote the same statement on one line.
    expect(normalize(complete.sql)).toBe(normalize(original.estimateApplicationComplete))
    expect(complete.values).toEqual([now, "a1"])
  })

  it("publishes a captured template with both guards", () => {
    const statements = publishCapturedTemplateStatements(db, {
      templateId: "t1",
      versionId: "v1",
      organizationId: "org",
      now,
    }).map(recorded)
    expect(statements.map((s) => s.sql)).toEqual([original.publishCapturedVersion, original.publishCapturedTemplate])
    expect(statements.map((s) => s.values)).toEqual([
      ["Captured content reviewed in Compass and published by internal staff.", "v1"],
      [now, "t1", "org"],
    ])
  })
})

describe("estimates created from templates", () => {
  it("inserts the estimate and its lines with the original bindings", () => {
    const estimate = recorded(
      insertTemplateEstimateStatement(db, {
        id: "e1",
        projectId: "p1",
        estimateNumber: "N-1",
        versionNumber: 1,
        title: "Estimate",
        estimateDate: "2026-10-31",
        sourceRevision: "Deck v1",
        templateVersionId: "v1",
        templateApplicationId: "a1",
        defaultTaxEntityId: null,
        defaultTaxCode: null,
        defaultTaxName: null,
        defaultTaxRateBasisPoints: 0,
        contractTerms: null,
        directCostCents: 100,
        markupCents: 10,
        taxCents: 0,
        builderFeeBaseCents: 110,
        estimateTotalCents: 110,
        createdBy: "u1",
        now,
      })
    )
    expect(estimate.sql).toBe(original.templateEstimate)
    expect(estimate.values).toEqual([
      "e1", "p1", "N-1", 1, "Estimate", "2026-10-31", "Deck v1", "v1", "a1", null, null, null, 0, null,
      100, 10, 0, 110, 110, "u1", now, now,
    ])

    const line = recorded(
      insertTemplateEstimateLineStatement(db, {
        id: "el1",
        projectId: "p1",
        estimateId: "e1",
        templateLineId: "tl1",
        divisionCode: "06",
        divisionName: "Wood",
        costCode: "06-100",
        costCodeName: "Framing",
        description: "Frame",
        specifications: null,
        quantity: 1,
        unit: "LS",
        unitCostCents: 100,
        directCostCents: 100,
        markupRateBasisPoints: 1000,
        markupCents: 10,
        taxable: false,
        taxEntityId: null,
        taxCode: null,
        taxName: null,
        taxRateBasisPoints: 0,
        taxCents: 0,
        lineTotalCents: 110,
        ownerVisible: true,
        sortOrder: 0,
        now,
      })
    )
    expect(line.sql).toBe(original.templateEstimateLine)
    expect(line.values).toEqual([
      "el1", "p1", "e1", "tl1", "06", "Wood", "06-100", "Framing", "Frame", null, 1, "LS", 100, 100, 1000,
      10, 0, null, null, null, 0, 0, 110, 1, 0, now, now,
    ])
  })
})

describe("estimate line reorder", () => {
  it("chunks 25 lines per statement and touches the estimate last", () => {
    const positions = Array.from({ length: 30 }, (_, index) => ({ id: `l${index}`, sortOrder: index }))
    const statements = reorderEstimateLinesStatements(db, {
      estimateId: "e1",
      projectId: "p1",
      expectedUpdatedAt: "old",
      now,
      positions,
    }).map(recorded)
    expect(statements).toHaveLength(3)
    const lineSql = (count: number): string =>
      original.reorderLines
        .replace('${chunk.map(() => "WHEN ? THEN ?").join(" ")}', Array(count).fill("WHEN ? THEN ?").join(" "))
        .replace('${chunk.map(() => "?").join(",")}', Array(count).fill("?").join(","))
    expect(statements[0]?.sql).toBe(lineSql(25))
    expect(statements[1]?.sql).toBe(lineSql(5))
    expect(statements[2]?.sql).toBe(original.reorderEstimate)
    const tail = positions.slice(25)
    expect(statements[1]?.values).toEqual([
      ...tail.flatMap((position) => [position.id, position.sortOrder]),
      now,
      ...tail.map((position) => position.id),
      "e1", "p1", "e1", "p1", "old",
    ])
    expect(statements[2]?.values).toEqual([now, "e1", "p1", "old"])
  })
})

describe("saved schedule templates", () => {
  const items = Array.from({ length: 7 }, (_, index) => ({
    id: `i${index}`,
    sourceItemId: `s${index}`,
    itemKey: `k${index}`,
    title: `Item ${index}`,
    startOffsetWorkdays: index,
    workdays: 1,
    phase: "framing",
    displayColor: "#123456",
    isMilestone: index === 0,
    assigneePlaceholder: null,
    ownerVisible: true,
    subVendorVisible: false,
    notes: null,
    sortOrder: index,
  }))
  const dependencies = [
    { id: "d1", predecessorItemId: "i0", successorItemId: "i1", type: "FS" as const, lagDays: 0 },
  ]

  it("writes a new template, version, module, chunked items and dependencies", () => {
    const statements = savedScheduleTemplateStatements(db, {
      header: {
        kind: "new",
        templateId: "t1",
        organizationId: "org",
        versionNumber: 1,
        name: "Ranch",
        description: null,
        templateKind: "schedule",
        tradeCategory: "Schedules",
        sourceMetadataJson: '{"sourceProjectId":"p1"}',
        now,
      },
      versionId: "v1",
      moduleId: "m1",
      createdBy: "u1",
      versionNotes: "Saved from the Ranch schedule.",
      modulePayloadJson: "{}",
      items,
      dependencies,
    }).map(recorded)
    const itemSql = (count: number): string =>
      original.savedScheduleItems.replace(
        "__VALUES__",
        Array(count).fill(`(${Array(15).fill("?").join(", ")})`).join(", ")
      )
    // The original multi-row VALUES list, written out for one row.
    const dependencySql = original.savedScheduleDependencies.replace(
      "__VALUES__",
      `(${Array(6).fill("?").join(", ")})`
    )
    expect(statements.map((s) => s.sql)).toEqual([
      original.savedScheduleNewTemplate,
      original.savedScheduleVersion,
      original.savedScheduleModule,
      itemSql(6),
      itemSql(1),
      dependencySql,
    ])
    expect(statements[0]?.values).toEqual([
      "t1", "org", "schedule:t1", "Ranch", null, "schedule", "Schedules", 1, '{"sourceProjectId":"p1"}', "u1", now, now,
    ])
    expect(statements[1]?.values).toEqual(["v1", "t1", 1, now, "Saved from the Ranch schedule.", "u1", now])
    expect(statements[2]?.values).toEqual(["m1", "v1", 7, "{}"])
    expect(statements[4]?.values).toEqual([
      "i6", "v1", "s6", "k6", "Item 6", 6, 1, "framing", "#123456", 0, null, 1, 0, null, 6,
    ])
    expect(statements[5]?.values).toEqual(["d1", "v1", "i0", "i1", "FS", 0])
  })

  it("updates an existing template for a new version", () => {
    const [header] = savedScheduleTemplateStatements(db, {
      header: {
        kind: "existing",
        templateId: "t1",
        organizationId: "org",
        versionNumber: 3,
        name: "Ranch",
        tradeCategory: "Schedules",
        description: null,
        now,
      },
      versionId: "v3",
      moduleId: "m3",
      createdBy: "u1",
      versionNotes: "Saved",
      modulePayloadJson: "{}",
      items: [],
      dependencies: [],
    }).map(recorded)
    expect(header?.sql).toBe(original.savedScheduleExistingTemplate)
    expect(header?.values).toEqual([3, "Ranch", "Schedules", null, now, "t1", "org"])
  })
})
