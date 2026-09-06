import { describe, expect, it } from "vitest"

import { HELP_GUIDES } from "@/lib/help"
import { selectAllowedHelpGuideIds } from "@/lib/help/access-policy"

describe("effective help access policy", () => {
  it("filters guides using effective permission feature IDs", () => {
    const allowedFeatureIds = new Set(
      HELP_GUIDES.map((guide) => guide.featureId).filter(
        (featureId) => featureId !== "schedule"
      )
    )

    const allowedGuideIds = selectAllowedHelpGuideIds(
      "admin",
      allowedFeatureIds
    )

    expect(allowedGuideIds).not.toContain("schedule")
    expect(allowedGuideIds).toContain("support")
  })

  it("preserves external help while filtering to external-safe audiences", () => {
    const allFeatureIds = new Set(
      HELP_GUIDES.map((guide) => guide.featureId)
    )
    const allowedGuideIds = selectAllowedHelpGuideIds(
      "client",
      allFeatureIds
    )
    const ownerGuideIds = HELP_GUIDES.filter((guide) =>
      guide.audiences.includes("owner")
    ).map((guide) => guide.id)

    expect(allowedGuideIds).toEqual(ownerGuideIds)
    expect(allowedGuideIds.length).toBeGreaterThan(0)
  })

  it("returns no guides for an unknown role", () => {
    expect(
      selectAllowedHelpGuideIds(
        "unknown-role",
        new Set(HELP_GUIDES.map((guide) => guide.featureId))
      )
    ).toEqual([])
  })
})
