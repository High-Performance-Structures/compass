import { describe, expect, it } from "vitest"

import { parseBtLeadProposal } from "@/lib/buildertrend/lead-proposal"
import { btCostCode, btMarkupBasisPoints, btProposalImportRows } from "@/lib/buildertrend/lead-proposal-copy"
import { newDraftBlockedReason } from "@/lib/estimates/estimate-family"
import { syntheticProposal } from "./lead-proposal-fixture"

function rows(overrides: Readonly<Record<string, unknown>> = {}): ReturnType<typeof btProposalImportRows> {
  const result = parseBtLeadProposal(syntheticProposal(overrides))
  if (!result.success) throw new Error(result.error)
  return btProposalImportRows(result.proposal)
}

describe("btProposalImportRows", () => {
  it("makes one importer line per item with exact Buildertrend amounts", () => {
    const { lines } = rows()
    expect(lines).toHaveLength(3)
    expect(lines[0]).toMatchObject({
      rowNumber: 1,
      costCode: "01 71 13",
      costCodeName: "Mobilization",
      description: "Mobilize",
      phaseName: "Site Work",
      quantity: 1,
      unit: "LS",
      unitCostCents: 10_000,
      directCostCents: 10_000,
      markupRateBasisPoints: 2_000,
      lineTotalCents: 12_000,
    })
    expect(lines[0]?.notes).toBe("Move equipment on site\nUse the small loader")
    expect(lines.reduce((sum, line) => sum + line.lineTotalCents, 0)).toBe(33_000)
  })

  it("files sub-group items under their top group and notes the sub-group", () => {
    const dig = rows().lines[1]
    expect(dig?.phaseName).toBe("Site Work")
    expect(dig?.notes).toBe("Subgroup: Excavation")
  })

  it("keeps unmatched cost code text and defaults a missing unit", () => {
    const { lines } = rows()
    expect(lines[1]).toMatchObject({ costCode: "Custom Dirt Code", costCodeName: "Custom Dirt Code" })
    expect(lines[2]).toMatchObject({ costCode: "", unit: "LS" })
  })

  it("derives markup from cents when Buildertrend gave no percent", () => {
    expect(rows().lines[1]?.markupRateBasisPoints).toBe(2_500)
  })

  it("makes a phase and assembly for each group with items, in order", () => {
    expect(rows().phases).toEqual([
      { name: "Site Work", description: "Prepare the site", sortOrder: 1, fromParentGroup: true },
      { name: "Finishes", description: "", sortOrder: 2, fromParentGroup: true },
    ])
  })

  it("gives duplicate or blank group titles distinct phase names", () => {
    const item = { title: "X", costCode: null, description: null, internalNotes: null, quantity: 1, unit: null,
      unitCostCents: 1, builderCostCents: 1, markupPercent: 0, markupCents: 0, ownerPriceCents: 1 }
    const group = (title: string): Record<string, unknown> => ({ title, description: null, items: [item], subGroups: [] })
    const { phases, lines } = rows({ groups: [group("Same"), group("Same"), group(" ")] })
    expect(phases.map((phase) => phase.name)).toEqual(["Same", "Same (2)", "Group 3"])
    expect(lines.map((line) => line.phaseName)).toEqual(["Same", "Same (2)", "Group 3"])
  })

  it("names the source after the proposal", () => {
    expect(rows().sourceFileName).toBe("Sample Basement Budget Estimate")
  })
})

describe("copy helpers", () => {
  it("parses CSI cost codes and keeps other text", () => {
    expect(btCostCode("31 23 16.13 - Trenching")).toEqual({ code: "31 23 16.13", name: "Trenching" })
    expect(btCostCode("  Misc  ")).toEqual({ code: "Misc", name: "Misc" })
    expect(btCostCode(null)).toEqual({ code: "", name: "" })
  })

  it("rounds markup percent to basis points", () => {
    expect(btMarkupBasisPoints(13.333, 7_500, 8_500)).toBe(1_333)
    expect(btMarkupBasisPoints(null, 0, 500)).toBe(0)
  })

  it("blocks a new draft only on one-contract jobs that already have a contract", () => {
    const contract = { changeOrderId: null, phaseProposalId: null, status: "draft" }
    expect(newDraftBlockedReason("multiple", [contract])).toBeNull()
    expect(newDraftBlockedReason("single", [])).toBeNull()
    expect(newDraftBlockedReason("single", [{ ...contract, status: "void" }])).toBeNull()
    expect(newDraftBlockedReason("single", [contract])).toContain("open draft")
    expect(newDraftBlockedReason("single", [{ ...contract, status: "accepted" }])).toContain("change order")
  })
})
