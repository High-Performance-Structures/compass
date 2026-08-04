import { describe, expect, it } from "vitest"

import {
  buildBuildertrendTemplateInventorySql,
  parseBuildertrendTemplateInventory,
} from "../buildertrend-template-inventory"

describe("Buildertrend active template inventory", () => {
  it("refuses archived template rows", () => {
    const result = parseBuildertrendTemplateInventory({
      capturedAt: "2026-07-31T12:00:00.000Z",
      sourceUrl: "https://buildertrend.net/app/Templates/MyTemplates",
      expectedActiveCount: 1,
      excludedArchivedCount: 27,
      templates: [
        {
          name: "ARCHIVE Sample Job",
          tradeCategory: "Other",
          templateKind: "project",
        },
      ],
    })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.errors.join(" ")).toContain("forbidden")
  })

  it("refuses a source-marked archive even without an archive name prefix", () => {
    const result = parseBuildertrendTemplateInventory({
      capturedAt: "2026-07-31T17:08:41.000Z",
      sourceUrl: "https://buildertrend.net/app/Templates/MyTemplates",
      expectedActiveCount: 1,
      excludedArchivedCount: 27,
      templates: [
        {
          name: "Old sample job",
          tradeCategory: "Other",
          templateKind: "project",
          sourceStatus: "Archived",
        },
      ],
    })

    expect(result.success).toBe(false)
  })

  it("emits only active inventory records", () => {
    const parsed = parseBuildertrendTemplateInventory({
      capturedAt: "2026-07-31T12:00:00.000Z",
      sourceUrl: "https://buildertrend.net/app/Templates/MyTemplates",
      expectedActiveCount: 1,
      excludedArchivedCount: 27,
      templates: [
        {
          name: "Concrete - Footer Assembly",
          tradeCategory: "Concrete",
          templateKind: "assembly",
        },
      ],
    })
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    const build = buildBuildertrendTemplateInventorySql("org-1", parsed.data)
    expect(build.importedCount).toBe(1)
    expect(build.sql).toContain("Concrete - Footer Assembly")
    expect(build.sql).toContain("27 archived templates were excluded")
    expect(build.sql).not.toContain("ARCHIVE Sample Job")
    expect(build.sql).toContain("NULL, 'Concrete - Footer Assembly'")
    expect(build.sql).not.toContain("https://buildertrend.net/")
  })
})
