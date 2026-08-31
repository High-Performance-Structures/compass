import { describe, expect, it } from "vitest"

import {
  decodeProjectRouteId,
  resolveProjectRouteIdWithLookup,
} from "@/lib/project-route-id"

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

  it("resolves a stale source ID to the canonical target before route actions", async () => {
    await expect(
      resolveProjectRouteIdWithLookup(
        "buildertrend-lead-project%3Aorg-1%3Alead-22496131",
        async (projectId) =>
          projectId === "buildertrend-lead-project:org-1:lead-22496131"
            ? "canonical-project"
            : null,
      ),
    ).resolves.toBe("canonical-project")
  })

  it("fails closed when a route alias cycle is encountered", async () => {
    await expect(
      resolveProjectRouteIdWithLookup(
        "legacy-source",
        async (projectId) =>
          projectId === "legacy-source" ? "legacy-target" : "legacy-source",
      ),
    ).resolves.toBeNull()
  })
})
