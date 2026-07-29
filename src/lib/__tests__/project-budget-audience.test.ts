import { describe, expect, it } from "vitest"

import { effectiveProjectBudgetAudience } from "@/lib/project-budget-audience"

describe("project budget audience", () => {
  it("allows internal staff to request internal detail", () => {
    expect(effectiveProjectBudgetAudience("internal", "office")).toBe(
      "internal"
    )
  })

  it.each(["client", "subcontractor", "supplier", "guest"])(
    "forces %s users to owner-safe detail",
    (role) => {
      expect(effectiveProjectBudgetAudience("internal", role)).toBe("owner")
    }
  )
})
