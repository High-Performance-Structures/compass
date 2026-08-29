import { spawnSync } from "node:child_process"
import {
  linkSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"

import {
  generateBuildertrendDailyLogDeltaImportSql,
  summarizeBuildertrendDailyLogDeltaImport,
} from "../../scripts/lib/buildertrend-daily-log-delta-import.mjs"

type DailyLogDeltaFixture = {
  readonly [key: string]: unknown
  approvedAttachmentFolderIds: string[]
  records: Array<{
    [key: string]: unknown
    sourceId: string
    author: string
    attachments: Array<{
      [key: string]: unknown
      driveFileId: string
      driveFolderId: string
    }>
  }>
}

function fixture(): DailyLogDeltaFixture {
  return {
    organizationId: "org-example",
    projectId: "project-example",
    projectNumber: "BT-EXAMPLE-001",
    buildertrendJobId: "99990001",
    projectDriveFolderId: "drive-project-folder",
    approvedAttachmentFolderIds: [],
    capturedAt: "2026-08-28T15:30:00.000Z",
    sourceLabel: "Authenticated Buildertrend daily-log delta capture",
    records: [
      {
        sourceId: "9001",
        title: "Thu, Aug 27 | Site progress",
        logDate: "2026-08-27",
        author: "Example Builder",
        visibility: ["Internal"],
        tags: ["Progress"],
        workCompleted: "Foundation work continued.",
        weather: {
          highF: 88,
          lowF: 61,
          wind: "W 8 mph",
          humidity: 42,
          precipitation: "0.00 in",
          uvIndex: 7,
          sourceStation: "KDEN",
        },
        attachments: [
          {
            driveFileId: "drive-file-9001",
            driveUrl: "https://drive.google.com/file/d/drive-file-9001/view",
            driveFolderId: "drive-project-folder",
            fileName: "site-progress.jpg",
            fileSize: 1234,
            mimeType: "image/jpeg",
          },
        ],
      },
    ],
  }
}

describe("Buildertrend daily-log delta import", () => {
  it("generates guarded idempotent staging SQL with complete raw weather and Drive links", () => {
    const output = generateBuildertrendDailyLogDeltaImportSql(fixture())

    expect(output).not.toContain("BEGIN IMMEDIATE;")
    expect(output).not.toContain("COMMIT;")
    expect(output).toContain(
      "SELECT NULL, 'Buildertrend daily-log delta guard'",
    )
    expect(output).toContain("google_drive_folder_id='drive-project-folder'")
    expect(output).toContain("WHERE NOT EXISTS (SELECT 1 FROM daily_logs")
    expect(output).toContain("ON CONFLICT(organization_id, source_key) DO UPDATE")
    expect(output).toContain('"buildertrendWeather"')
    expect(output).toContain('"highF":88')
    expect(output).toContain('"lowF":61')
    expect(output).toContain('"wind":"W 8 mph"')
    expect(output).toContain('"humidity":42')
    expect(output).toContain('"precipitation":"0.00 in"')
    expect(output).toContain('"uvIndex":7')
    expect(output).toContain("'drive-file-9001'")
    expect(output).toContain("'https://drive.google.com/file/d/drive-file-9001/view'")
    expect(output).toContain("'partial'")
    expect(output).toContain(
      "WHERE buildertrend_module_attestations.status<>'captured'",
    )
    expect(output).toContain("Delta capture only; observed_count is this delta")
    expect(output).toContain("complete_register_attested")
    expect(output).toContain("source_system='google_drive_reference'")
    expect(output).toContain("weather_temp_f")
    expect(output).toContain("weather_precipitation")
    expect(summarizeBuildertrendDailyLogDeltaImport(fixture())).toMatchObject({
      captureKind: "daily_log_delta",
      completeRegister: false,
      sourceRecordCount: 1,
      attachmentCount: 1,
      sourceAuthorsPresent: true,
      rawWeatherPreserved: true,
      moduleAttestationStatus: "partial",
    })
  })

  it("rejects a missing source author", () => {
    const input = fixture()
    input.records[0].author = "   "
    expect(() => generateBuildertrendDailyLogDeltaImportSql(input)).toThrow("source author")
  })

  it("rejects a Drive attachment outside the project folder", () => {
    const input = fixture()
    input.records[0].attachments[0].driveFolderId = "another-folder"
    expect(() => generateBuildertrendDailyLogDeltaImportSql(input)).toThrow("not under the project folder")
  })

  it("rejects non-Drive and mismatched Drive attachment URLs", () => {
    const nonDrive = fixture()
    nonDrive.records[0].attachments[0].driveUrl =
      "https://files.example.test/file/d/drive-file-9001/view"
    expect(() => generateBuildertrendDailyLogDeltaImportSql(nonDrive)).toThrow(
      "must reference the matching Google Drive file",
    )

    const mismatched = fixture()
    mismatched.records[0].attachments[0].driveUrl =
      "https://drive.google.com/file/d/another-file/view"
    expect(() => generateBuildertrendDailyLogDeltaImportSql(mismatched)).toThrow(
      "must reference the matching Google Drive file",
    )
  })

  it("allows a verified descendant folder and preserves its actual folder ID", () => {
    const input = fixture()
    input.approvedAttachmentFolderIds = ["drive-descendant-folder"]
    input.records[0].attachments[0].driveFolderId = "drive-descendant-folder"

    const output = generateBuildertrendDailyLogDeltaImportSql(input)
    expect(output).toContain('"driveFolderId":"drive-descendant-folder"')
    expect(summarizeBuildertrendDailyLogDeltaImport(input)).toMatchObject({
      approvedAttachmentFolderIds: ["drive-project-folder", "drive-descendant-folder"],
    })
  })

  it("rejects duplicate source records and duplicate Drive files", () => {
    const input = fixture()
    input.records.push({ ...input.records[0], sourceId: "9001" })
    expect(() => generateBuildertrendDailyLogDeltaImportSql(input)).toThrow("Duplicate sourceId")

    const duplicateAttachment = fixture()
    duplicateAttachment.records.push({
      ...duplicateAttachment.records[0],
      sourceId: "9002",
      attachments: duplicateAttachment.records[0].attachments,
    })
    expect(() => generateBuildertrendDailyLogDeltaImportSql(duplicateAttachment)).toThrow("Duplicate Drive attachment")
  })

  it("supports dry-run summaries without generating mutation output", () => {
    const summary = summarizeBuildertrendDailyLogDeltaImport(fixture())
    expect(summary.completeRegister).toBe(false)
    expect(summary.moduleAttestationStatus).toBe("partial")
  })

  it("refuses output paths that alias the source capture", () => {
    const directory = mkdtempSync(join(tmpdir(), "compass-bt-delta-cli-"))
    try {
      const input = join(directory, "capture.json")
      writeFileSync(input, JSON.stringify(fixture()))
      const script = resolve(
        process.cwd(),
        "scripts/build-buildertrend-daily-log-delta-import-sql.mjs",
      )
      const run = (output: string) =>
        spawnSync(
          "bun",
          [script, "--input", input, "--output", output],
          { cwd: process.cwd(), encoding: "utf8" },
        )

      const samePath = run(input)
      expect(samePath.status).toBe(1)
      expect(samePath.stderr).toContain("--output must not overwrite --input")

      const hardlink = join(directory, "hardlink.json")
      linkSync(input, hardlink)
      const hardlinkResult = run(hardlink)
      expect(hardlinkResult.status).toBe(1)
      expect(hardlinkResult.stderr).toContain("--output must not overwrite --input")

      const symlink = join(directory, "symlink.json")
      symlinkSync(input, symlink)
      const symlinkResult = run(symlink)
      expect(symlinkResult.status).toBe(1)
      expect(symlinkResult.stderr).toContain("--output must not overwrite --input")
      expect(JSON.parse(readFileSync(input, "utf8"))).toMatchObject({
        projectId: "project-example",
      })
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })
})
