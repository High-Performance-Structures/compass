import { describe, expect, it } from "vitest"

import {
  decodedLegacyProjectId,
  decodedLegacyProjectPathname,
} from "@/lib/legacy-project-route"

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

  it("does not redirect encoded colons on unrelated API paths", () => {
    expect(decodedLegacyProjectPathname("/api/webhooks/source%3Aevent")).toBeNull()
  })

  it("does not redirect other project ID formats containing encoded colons", () => {
    expect(
      decodedLegacyProjectPathname(
        "/dashboard/projects/another-project%3Aorg-1%3A123/information",
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

describe("decodedLegacyProjectId", () => {
  it("decodes the encoded Buildertrend lead id received by a page boundary", () => {
    expect(
      decodedLegacyProjectId(
        "buildertrend-lead-project%3Aorg-1%3Alead-22496131",
      ),
    ).toBe("buildertrend-lead-project:org-1:lead-22496131")
  })

  it("does not reinterpret unrelated or already-decoded ids", () => {
    expect(decodedLegacyProjectId("project%20123")).toBeNull()
    expect(decodedLegacyProjectId("project%2F123")).toBeNull()
    expect(
      decodedLegacyProjectId(
        "buildertrend-lead-project:org-1:lead-22496131",
      ),
    ).toBeNull()
  })
})
