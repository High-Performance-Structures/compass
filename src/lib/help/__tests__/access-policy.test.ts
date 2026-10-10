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

  it.each([
    ["agent", "jarvis"],
    ["nutech-orders", "nutech.orders"],
    ["social-publishing", "social.posts"],
  ])("keeps %s guidance behind its effective feature permission", (featureId, guideId) => {
    const allowed = new Set(HELP_GUIDES.map((guide) => guide.featureId))
    expect(selectAllowedHelpGuideIds("admin", allowed)).toContain(guideId)
    allowed.delete(featureId)
    expect(selectAllowedHelpGuideIds("admin", allowed)).not.toContain(guideId)
    allowed.add(featureId)
    for (const role of ["client", "subcontractor", "supplier", "guest"]) {
      expect(selectAllowedHelpGuideIds(role, allowed)).not.toContain(guideId)
    }
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
