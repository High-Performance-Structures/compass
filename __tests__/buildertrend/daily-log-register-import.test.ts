import { describe, expect, it } from "vitest"

import {
  generateBuildertrendDailyLogRegisterImportSql,
  summarizeBuildertrendDailyLogRegisterImport,
} from "../../scripts/lib/buildertrend-daily-log-register-import.mjs"

type DailyLogRegisterFixture = {
  organizationId: string
  projectId: string
  projectNumber: string
  buildertrendJobId: string
  capturedAt: string
  sourceLabel: string
  expectedExistingOperationalCount: number
  existingMappings: Array<{
    sourceId: string
    existingDailyLogId: string
    existingSourceSystem: string
    existingSourceExternalId: string | null
    method: string
  }>
  records: Array<{
    sourceId: string
    title: string
    author: string
    visibility: string[]
    tags: string[]
    weather: string[]
    notes: string
    rawText: string
    displayedMedia: Array<{
      fileName: string
      previewUrl: string
      testId: string
    }>
    documentNames: string[]
    mediaCount: number
  }>
}

function fixture(): DailyLogRegisterFixture {
  return {
    organizationId: "org-1",
    projectId: "project-1",
    projectNumber: "O-170-2684",
    buildertrendJobId: "35400494",
    capturedAt: "2026-08-17T17:30:00.000Z",
    sourceLabel: "Authenticated daily-log register capture",
    expectedExistingOperationalCount: 1,
    existingMappings: [
      {
        sourceId: "1001",
        existingDailyLogId: "existing-log",
        existingSourceSystem: "buildertrend",
        existingSourceExternalId: "legacy-source-key",
        method: "manual_alias",
      },
    ],
    records: [
      {
        sourceId: "1001",
        title: "Tue, Aug 11 | Existing work",
        author: "Wesley Jones",
        visibility: ["Internal"],
        tags: ["Scheduling"],
        weather: ["91°F↑", "64°F↓"],
        notes: "Existing work was completed.",
        rawText: "source text",
        displayedMedia: [],
        documentNames: [],
        mediaCount: 0,
      },
      {
        sourceId: "1002",
        title: "Thu, Apr 17, 2025 | Owner-visible work",
        author: "Martine Vogel",
        visibility: ["Client"],
        tags: ["Progress"],
        weather: [],
        notes: "Owner's requested work was completed.",
        rawText: "source text",
        displayedMedia: [
          {
            fileName: "site.jpg",
            previewUrl: "/api/files/456/preview?jobId=35400494",
            testId: "SquareImage-0",
          },
        ],
        documentNames: [],
        mediaCount: 1,
      },
    ],
  }
}

describe("Buildertrend daily-log register import", () => {
  it("stages the complete register and inserts only missing operational logs", () => {
    const output = generateBuildertrendDailyLogRegisterImportSql(fixture())

    expect(output).toContain("INSERT INTO projects SELECT * FROM projects")
    expect(output.match(/INSERT INTO projects SELECT \* FROM projects/g)).toHaveLength(1)
    expect(output).toContain("VALUES ('bt-dl-1002', 'project-1'")
    expect(output).not.toContain("VALUES ('bt-dl-1001', 'project-1'")
    expect(output).toContain("legacy-record:bt-src-daily-log-35400494-1001")
    expect(output).toContain("legacy-record:bt-src-daily-log-35400494-1002")
    expect(output).toContain("promoted_record_id<>'existing-log'")
    expect(output).toContain("buildertrend_record_id NOT IN ('1001', '1002')")
    expect(output).toContain("GROUP BY buildertrend_record_id HAVING COUNT(*)>1")
    expect(output).toContain("json_remove(tags, '$.sourceUrl')")
    expect(output).toContain("'2025-04-17'")
    expect(output).toContain("Owner''s requested work was completed.")
    expect(output).toContain("Owner''s requested work was completed.', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, 'needs_review'")
    expect(output).toContain("'Client'")
    expect(output).not.toContain("buildertrend.net")
    expect(output).not.toContain("/api/files/")
    expect(output).not.toContain("previewUrl")
    expect(summarizeBuildertrendDailyLogRegisterImport(fixture())).toMatchObject({
      sourceRecordCount: 2,
      existingBuildertrendOperationalCount: 1,
      representedExistingCount: 1,
      importedOperationalCount: 1,
      sourceClientVisibleRecords: 1,
      automaticallyExposedClientRecords: 0,
      declaredMediaCount: 1,
      createsExternalLinks: false,
      removesLegacySourceUrlMetadata: true,
    })
  })

  it("rejects mappings that do not belong to the source register", () => {
    const input = fixture()
    input.existingMappings[0].sourceId = "9999"
    expect(() => generateBuildertrendDailyLogRegisterImportSql(input)).toThrow(
      "unknown sourceId",
    )
  })

  it("rejects duplicate source records", () => {
    const input = fixture()
    input.records[1].sourceId = "1001"
    expect(() => generateBuildertrendDailyLogRegisterImportSql(input)).toThrow(
      "Duplicate sourceId",
    )
  })

  it("rejects an invalid Buildertrend display date", () => {
    const input = fixture()
    input.records[1].title = "Thu, Smarch 42 | Invalid"
    expect(() => generateBuildertrendDailyLogRegisterImportSql(input)).toThrow(
      "Cannot parse daily-log month",
    )
  })

  it("batches large source registers below D1's expression-depth limit", () => {
    const input = fixture()
    input.expectedExistingOperationalCount = 0
    input.existingMappings = []
    input.records = Array.from({ length: 85 }, (_, index) => ({
      ...input.records[1],
      sourceId: String(2000 + index),
      title: `Thu, Apr 17, 2025 | Imported work ${index + 1}`,
    }))

    const output = generateBuildertrendDailyLogRegisterImportSql(input)
    const guardStatements = output.match(/INSERT INTO projects SELECT \* FROM projects/g)
    expect(guardStatements?.length).toBeGreaterThanOrEqual(3)
  })

  it("honors a verified staging pointer to a Compass-authored equivalent", () => {
    const input = fixture()
    input.expectedExistingOperationalCount = 0
    input.existingMappings[0].existingSourceSystem = "compass"
    input.existingMappings[0].existingSourceExternalId = null

    const output = generateBuildertrendDailyLogRegisterImportSql(input)
    expect(output).toContain("source_system='compass' AND source_external_id IS NULL")
    expect(output).not.toContain("VALUES ('bt-dl-1001', 'project-1'")
    expect(summarizeBuildertrendDailyLogRegisterImport(input)).toMatchObject({
      existingBuildertrendOperationalCount: 0,
      representedExistingCount: 1,
      importedOperationalCount: 1,
    })
  })
})
