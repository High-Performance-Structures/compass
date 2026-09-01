import { describe, expect, it } from "vitest"

import {
  projectRouteAliasDestination,
  resolveProjectRouteAliasChain,
} from "@/lib/project-route-alias"

describe("projectRouteAliasDestination", () => {
  it("lands a merged legacy route on the canonical project information page", () => {
    expect(projectRouteAliasDestination("proj-bt-lead-n-713-00")).toBe(
      "/dashboard/projects/proj-bt-lead-n-713-00/information",
    )
  })

  it("encodes target ids as one route segment", () => {
    expect(projectRouteAliasDestination("project:with/slash")).toBe(
      "/dashboard/projects/project%3Awith%2Fslash/information",
    )
  })

  it("preserves a safe deep-link suffix and its query parameters", () => {
    expect(
      projectRouteAliasDestination(
        "proj-bt-lead-n-713-00",
        "/estimate/compare",
        "estimateId=estimate-7&legacyResolved=1",
      ),
    ).toBe(
      "/dashboard/projects/proj-bt-lead-n-713-00/estimate/compare?estimateId=estimate-7",
    )
  })

  it("falls back to information for an unsafe suffix", () => {
    expect(
      projectRouteAliasDestination(
        "proj-bt-lead-n-713-00",
        "//outside.example",
      ),
    ).toBe("/dashboard/projects/proj-bt-lead-n-713-00/information")
  })

  it("falls back to information for literal and encoded dot-segments", () => {
    expect(
      projectRouteAliasDestination("proj-bt-lead-n-713-00", "/../evil"),
    ).toBe("/dashboard/projects/proj-bt-lead-n-713-00/information")
    expect(
      projectRouteAliasDestination("proj-bt-lead-n-713-00", "/foo/../evil"),
    ).toBe("/dashboard/projects/proj-bt-lead-n-713-00/information")
    expect(
      projectRouteAliasDestination("proj-bt-lead-n-713-00", "/%2e%2e/evil"),
    ).toBe("/dashboard/projects/proj-bt-lead-n-713-00/information")
  })

  it("preserves encoded dynamic record ids within a safe suffix", () => {
    expect(
      projectRouteAliasDestination(
        "proj-bt-lead-n-713-00",
        "/financials/pay-applications/sage-pay-app%3Aproj-1%3Asource-hash",
      ),
    ).toBe(
      "/dashboard/projects/proj-bt-lead-n-713-00/financials/pay-applications/sage-pay-app%3Aproj-1%3Asource-hash",
    )
  })
})

describe("resolveProjectRouteAliasChain", () => {
  it("resolves a bounded alias chain to its final target", async () => {
    const aliases = new Map([
      ["legacy-a", "legacy-b"],
      ["legacy-b", "canonical-project"],
    ])

    await expect(
      resolveProjectRouteAliasChain(
        "legacy-a",
        async (sourceProjectId) => aliases.get(sourceProjectId) ?? null,
      ),
    ).resolves.toEqual({ kind: "resolved", targetProjectId: "canonical-project" })
  })

  it("fails closed on alias cycles", async () => {
    const aliases = new Map([
      ["legacy-a", "legacy-b"],
      ["legacy-b", "legacy-a"],
    ])

    await expect(
      resolveProjectRouteAliasChain(
        "legacy-a",
        async (sourceProjectId) => aliases.get(sourceProjectId) ?? null,
      ),
    ).resolves.toEqual({ kind: "cycle" })
  })

  it("fails closed when the hop guard is exhausted", async () => {
    const aliases = new Map(
      Array.from({ length: 17 }, (_, index) => [
        `legacy-${index}`,
        `legacy-${index + 1}`,
      ]),
    )

    await expect(
      resolveProjectRouteAliasChain(
        "legacy-0",
        async (sourceProjectId) => aliases.get(sourceProjectId) ?? null,
      ),
    ).resolves.toEqual({ kind: "cycle" })
  })
})
