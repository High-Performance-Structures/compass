import { describe, expect, it } from "vitest"

import { decodeProjectRouteId } from "@/lib/project-route-id"

describe("decodeProjectRouteId", () => {
  it("decodes an encoded Buildertrend lead project ID", () => {
    expect(
      decodeProjectRouteId("buildertrend-lead-project%3Aorg-1%3Alead-22496131"),
    ).toBe("buildertrend-lead-project:org-1:lead-22496131")
  })

  it("decodes encoded stable Buildertrend route keys", () => {
    expect(
      decodeProjectRouteId("buildertrend-lead-project%3Aorg-1%3Aroute-key_42"),
    ).toBe("buildertrend-lead-project:org-1:route-key_42")
  })

  it("leaves IDs outside the exact Buildertrend shape unchanged", () => {
    const values = [
      "buildertrend-lead-project:org-1:lead-22496131",
      "buildertrend-lead-project%3Aorg-1%3A%2F",
      "buildertrend-lead-project%253Aorg-1%253Alead-22496131",
      "project%3Aorg-1%3Alead-22496131",
      "project-123",
    ]

    for (const value of values) {
      expect(decodeProjectRouteId(value)).toBe(value)
    }
  })

  it("accepts lowercase percent-escape hex digits", () => {
    expect(
      decodeProjectRouteId("buildertrend-lead-project%3aorg-1%3alead-22496131"),
    ).toBe("buildertrend-lead-project:org-1:lead-22496131")
  })
})
