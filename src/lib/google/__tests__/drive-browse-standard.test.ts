import { join, relative } from "node:path"
import { beforeAll, describe, expect, it } from "vitest"

import { preloadSources, readSource, SOURCE_SCAN_TIMEOUT_MS, sourceFiles as sharedSourceFiles } from "@/test/source-tree"

import { driveIdFromInput } from "@/lib/google/drive-picker"

const ROOT = process.cwd()

const SOURCE_OPTIONS = { skipDirectories: ["__tests__"], include: /\.tsx$/ }

function tsxFiles(dir: string): readonly string[] {
  return sharedSourceFiles(dir, SOURCE_OPTIONS)
}

// Read the tree once for this file, as setup (see @/test/source-tree).
beforeAll(() => preloadSources("src", SOURCE_OPTIONS), SOURCE_SCAN_TIMEOUT_MS)

function source(file: string): string {
  return readSource(join(ROOT, file))
}

// Text that only shows up on a box asking someone to paste a Drive link or id.
const PASTE_ONLY_DRIVE = /placeholder=\{?["'`](?:https:\/\/drive\.google\.com|[^"'`]*(?:Paste the folder|folder's link|Drive link|Drive folder ID|Google Sheet ID))/i

describe("Drive files are browsed to, never only pasted", () => {
  it("has no paste-only Drive link or id boxes outside the shared field", () => {
    const offenders = [...tsxFiles(join(ROOT, "src/components")), ...tsxFiles(join(ROOT, "src/app"))]
      .map((path) => relative(ROOT, path))
      .filter((file) => file !== "src/components/google/drive-item-field.tsx")
      .filter((file) => {
        const text = source(file)
        // A registry-style field list may keep an id placeholder when the row renders DriveItemField.
        return PASTE_ONLY_DRIVE.test(text) && !text.includes("DriveItemField")
      })
    expect(offenders).toEqual([])
  })

  it("uses the shared Browse field for Drive settings", () => {
    for (const file of [
      "src/components/settings/trade-doc-settings-section.tsx",
      "src/components/settings/trade-doc-import-dialog.tsx",
      "src/components/settings/nutech-email-settings-section.tsx",
      "src/components/projects/projects-hub-registry-fields.tsx",
      "src/components/projects/project-registry-panel.tsx",
    ]) {
      expect(source(file), file).toContain("<DriveItemField")
    }
    expect(source("src/components/settings/archive-delivery-settings.tsx")).toContain("<DriveBrowseDialog")
  })

  it("offers Drive, Compass projects and this computer in one dialog", () => {
    const dialog = source("src/components/google/drive-browse-dialog.tsx")
    expect(dialog).toContain('value="drive"')
    expect(dialog).toContain('value="projects"')
    expect(dialog).toContain('value="computer"')
    expect(source("src/components/projects/project-drive-file-picker.tsx")).toContain("DriveBrowseDialog")
  })

  it("reads ids from every kind of Drive link", () => {
    const id = "1AbCdEfGhIjKlMnOp"
    expect(driveIdFromInput(`https://drive.google.com/file/d/${id}/view`)).toBe(id)
    expect(driveIdFromInput(`https://docs.google.com/spreadsheets/d/${id}/edit`)).toBe(id)
    expect(driveIdFromInput(`https://drive.google.com/drive/u/0/folders/${id}`)).toBe(id)
    expect(driveIdFromInput(`https://drive.google.com/open?id=${id}`)).toBe(id)
    expect(driveIdFromInput(id)).toBe(id)
    expect(driveIdFromInput("https://example.com/receipt")).toBeNull()
  })
})
