import { describe, expect, it } from "vitest"

import {
  decodedLegacyProjectId,
  decodedLegacyProjectPathname,
  isSafeLegacyProjectSuffix,
  legacyProjectDeepLinkFromRequestUrl,
  legacyProjectFallbackPathname,
  legacyProjectResolutionPathname,
  normalizedLegacyProjectId,
  scalarLegacyRouteSearchParam,
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

  it("decodes route-safe stable project keys used by lead cutover", () => {
    expect(
      decodedLegacyProjectId(
        "buildertrend-lead-project%3Aorg-a%3Ad-100-example",
      ),
    ).toBe("buildertrend-lead-project:org-a:d-100-example")
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

  it("rejects repeated query values instead of calling string methods on arrays", () => {
    expect(
      scalarLegacyRouteSearchParam([
        "buildertrend-lead-project:org-1:lead-22496131",
        "buildertrend-lead-project:org-1:lead-22496131",
      ]),
    ).toBeUndefined()
    expect(
      normalizedLegacyProjectId([
        "buildertrend-lead-project:org-1:lead-22496131",
        "buildertrend-lead-project:org-1:lead-22496131",
      ]),
    ).toBeNull()
  })
})

describe("legacyProjectResolutionPathname", () => {
  it("routes encoded and decoded legacy ids through the root-level resolver", () => {
    const expected =
      "/legacy-project-route?sourceProjectId=buildertrend-lead-project%3Aorg-1%3Alead-22496131&suffix=%2Finformation"
    expect(
      legacyProjectResolutionPathname(
        "/dashboard/projects/buildertrend-lead-project%3Aorg-1%3Alead-22496131/information",
      ),
    ).toBe(expected)
    expect(
      legacyProjectResolutionPathname(
        "/dashboard/projects/buildertrend-lead-project:org-1:lead-22496131/information",
      ),
    ).toBe(expected)
  })

  it("does not intercept unrelated project routes", () => {
    expect(
      legacyProjectResolutionPathname(
        "/dashboard/projects/proj-bt-h-329-maley/information",
      ),
    ).toBeNull()
  })

  it("routes stable project-key ids through the resolver", () => {
    expect(
      legacyProjectResolutionPathname(
        "/dashboard/projects/buildertrend-lead-project:org-a:d-100-example/estimate",
      ),
    ).toBe(
      "/legacy-project-route?sourceProjectId=buildertrend-lead-project%3Aorg-a%3Ad-100-example&suffix=%2Festimate",
    )
  })

  it("carries the original query without the loop marker", () => {
    expect(
      legacyProjectResolutionPathname(
        "/dashboard/projects/buildertrend-lead-project:org-1:lead-22496131/estimate",
        "?estimateId=estimate-7&legacyResolved=1",
      ),
    ).toBe(
      "/legacy-project-route?sourceProjectId=buildertrend-lead-project%3Aorg-1%3Alead-22496131&suffix=%2Festimate&originalSearch=estimateId%3Destimate-7",
    )
  })
})

describe("legacyProjectDeepLinkFromRequestUrl", () => {
  it("recovers a marker-bearing legacy suffix and query for defensive layout redirects", () => {
    expect(
      legacyProjectDeepLinkFromRequestUrl(
        "https://compass.example/dashboard/projects/buildertrend-lead-project%3Aorg-1%3Alead-22496131/estimate/compare?estimateId=estimate-7&legacyResolved=1",
        "buildertrend-lead-project:org-1:lead-22496131",
      ),
    ).toEqual({
      suffix: "/estimate/compare",
      originalSearch: "estimateId=estimate-7",
    })
  })

  it("rejects malformed and mismatched request URLs", () => {
    expect(
      legacyProjectDeepLinkFromRequestUrl(
        "not-a-url",
        "buildertrend-lead-project:org-1:lead-22496131",
      ),
    ).toBeNull()
    expect(
      legacyProjectDeepLinkFromRequestUrl(
        "https://compass.example/dashboard/projects/buildertrend-lead-project%3Aorg-1%3Alead-999/information",
        "buildertrend-lead-project:org-1:lead-22496131",
      ),
    ).toBeNull()
  })
})

describe("legacy project resolver fallback", () => {
  it("returns unconsolidated leads to their original route with a loop marker", () => {
    expect(
      legacyProjectFallbackPathname(
        "buildertrend-lead-project:org-1:lead-22496131",
        "/photos",
      ),
    ).toBe(
      "/dashboard/projects/buildertrend-lead-project:org-1:lead-22496131/photos?legacyResolved=1",
    )
  })

  it("rejects invalid ids and falls back safely from an invalid suffix", () => {
    expect(normalizedLegacyProjectId("not-a-buildertrend-lead")).toBeNull()
    expect(
      legacyProjectFallbackPathname(
        "buildertrend-lead-project:org-1:lead-22496131",
        "//outside.example",
      ),
    ).toBe(
      "/dashboard/projects/buildertrend-lead-project:org-1:lead-22496131/information?legacyResolved=1",
    )
  })

  it("rejects literal and encoded dot-segment suffixes", () => {
    expect(isSafeLegacyProjectSuffix("/../evil")).toBe(false)
    expect(isSafeLegacyProjectSuffix("/./information")).toBe(false)
    expect(isSafeLegacyProjectSuffix("/foo/../evil")).toBe(false)
    expect(isSafeLegacyProjectSuffix("/%2e%2e/evil")).toBe(false)
    expect(
      legacyProjectFallbackPathname(
        "buildertrend-lead-project:org-1:lead-22496131",
        "/../../evil",
      ),
    ).toBe(
      "/dashboard/projects/buildertrend-lead-project:org-1:lead-22496131/information?legacyResolved=1",
    )
  })

  it("preserves valid encoded dynamic record ids without permitting separators", () => {
    expect(
      isSafeLegacyProjectSuffix(
        "/financials/pay-applications/sage-pay-app%3Aproj-1%3Asource-hash",
      ),
    ).toBe(true)
    expect(
      isSafeLegacyProjectSuffix(
        "/financials/pay-applications/sage-pay-app:proj-1:source-hash",
      ),
    ).toBe(true)
    expect(isSafeLegacyProjectSuffix("/files/folder%2Fchild")).toBe(false)
    expect(isSafeLegacyProjectSuffix("/files/folder%5Cchild")).toBe(false)
    expect(isSafeLegacyProjectSuffix("/files/bad%ZZescape")).toBe(false)
  })

  it("restores original query parameters before adding the loop marker", () => {
    expect(
      legacyProjectFallbackPathname(
        "buildertrend-lead-project:org-1:lead-22496131",
        "/estimate",
        "estimateId=estimate-7&legacyResolved=1",
      ),
    ).toBe(
      "/dashboard/projects/buildertrend-lead-project:org-1:lead-22496131/estimate?estimateId=estimate-7&legacyResolved=1",
    )
  })
})
