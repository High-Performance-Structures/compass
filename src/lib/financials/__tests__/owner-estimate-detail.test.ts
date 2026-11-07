import { describe, expect, it } from "vitest"

import { ownerDetailForEstimateMode } from "@/lib/financials/owner-estimate-detail"

describe("ownerDetailForEstimateMode", () => {
  it("shows the owner budget at the detail the signed estimate printed", () => {
    expect(ownerDetailForEstimateMode("assembly_summary")).toBe("assembly")
    expect(ownerDetailForEstimateMode("assembly_items")).toBe("assembly")
    expect(ownerDetailForEstimateMode("line_items")).toBe("cost_code")
    expect(ownerDetailForEstimateMode("division_summary")).toBe("division")
    expect(ownerDetailForEstimateMode("phase_summary")).toBe("division")
  })
})
