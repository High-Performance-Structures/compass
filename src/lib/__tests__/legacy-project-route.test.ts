import { describe, expect, it } from "vitest"

import { decodedLegacyProjectPathname } from "@/lib/legacy-project-route"

describe("decodedLegacyProjectPathname", () => {
  it("decodes encoded Buildertrend project ID colons", () => {
    expect(
      decodedLegacyProjectPathname(
        "/dashboard/projects/buildertrend-lead-project%3Aorg-1%3Alead-22496131/information",
      ),
    ).toBe(
      "/dashboard/projects/buildertrend-lead-project:org-1:lead-22496131/information",
    )
  })

  it("does not decode unrelated path escapes", () => {
    expect(
      decodedLegacyProjectPathname(
        "/dashboard/projects/project%2Fwith-slash/information",
      ),
    ).toBeNull()
  })

  it("returns null for an already decoded project path", () => {
    expect(
      decodedLegacyProjectPathname(
        "/dashboard/projects/buildertrend-lead-project:org-1:lead-22496131/information",
      ),
    ).toBeNull()
  })
})
