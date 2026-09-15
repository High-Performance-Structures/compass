import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

import { projectEstimateLineCostItems } from "@/db/schema-estimates"

describe("estimate breakdown recovery persistence contract", () => {
  it("keeps removed breakdown items recoverable and attributable", () => {
    expect(projectEstimateLineCostItems.deletedAt.name).toBe("deleted_at")
    expect(projectEstimateLineCostItems.deletedByUserId.name).toBe(
      "deleted_by_user_id"
    )
  })

  it("adds the recovery columns without rebuilding existing estimate data", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle/0160_estimate_breakdown_recovery.sql"),
      "utf8"
    )
    expect(migration).toContain("ADD `deleted_at` text")
    expect(migration).toContain("ADD `deleted_by_user_id` text")
    expect(migration).toContain(
      "project_estimate_line_cost_items_active_idx"
    )
  })
})
