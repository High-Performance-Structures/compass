import { describe, expect, it } from "vitest"

import {
  btProposalAttachment,
  btProposalGroupViews,
  btProposalStatusLabel,
  btProposalTotals,
  flattenBtProposalItems,
  parseBtLeadProposal,
  type BtLeadProposal,
} from "@/lib/buildertrend/lead-proposal"
import { syntheticProposal } from "./lead-proposal-fixture"

function parsed(overrides: Readonly<Record<string, unknown>> = {}): BtLeadProposal {
  const result = parseBtLeadProposal(JSON.stringify(syntheticProposal(overrides)))
  if (!result.success) throw new Error(result.error)
  return result.proposal
}

describe("parseBtLeadProposal", () => {
  it("reads a valid payload from JSON text, nested groups included", () => {
    const proposal = parsed()
    expect(proposal.title).toBe("Sample Basement Budget Estimate")
    expect(proposal.groups).toHaveLength(3)
    expect(proposal.groups[0]?.subGroups[0]?.items[0]?.title).toBe("Dig")
    expect(proposal.groups[1]?.items[0]?.unit).toBeNull()
  })

  it("accepts an already-parsed value", () => {
    expect(parseBtLeadProposal(syntheticProposal()).success).toBe(true)
  })

  it.each([
    ["not JSON", "{oops"],
    ["null", "null"],
    ["an array", "[]"],
  ])("rejects %s", (_label, raw) => {
    expect(parseBtLeadProposal(raw).success).toBe(false)
  })

  it("rejects a missing payload", () => {
    expect(parseBtLeadProposal(null).success).toBe(false)
  })

  it("rejects another schema version", () => {
    const result = parseBtLeadProposal(syntheticProposal({ schema: "bt-lead-proposal/v2" }))
    expect(result).toEqual({ success: false, error: "Unsupported proposal schema: bt-lead-proposal/v2." })
  })

  it("rejects an unknown status", () => {
    expect(parseBtLeadProposal(syntheticProposal({ status: "signed" })).success).toBe(false)
  })

  it("rejects fractional cents and wrong field types with the field path", () => {
    const fractional = parseBtLeadProposal(syntheticProposal({ ownerTotalCents: 10.5 }))
    expect(fractional.success).toBe(false)
    const badItem = syntheticProposal()
    const groups = badItem.groups
    if (!Array.isArray(groups)) throw new Error("fixture")
    const result = parseBtLeadProposal({
      ...badItem,
      groups: [{ title: "G", description: null, subGroups: [], items: [{ title: 5 }] }, ...groups.slice(1)],
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toContain("proposal.groups[0].items[0].title")
  })

  it("rejects groups nested deeper than two levels", () => {
    const deep = {
      title: "Top", description: null, items: [],
      subGroups: [{ title: "Sub", description: null, items: [], subGroups: [{ title: "Too deep", description: null, items: [], subGroups: [] }] }],
    }
    expect(parseBtLeadProposal(syntheticProposal({ groups: [deep] })).success).toBe(false)
  })

  it("rejects a blank proposal id or a non-boolean signature flag", () => {
    expect(parseBtLeadProposal(syntheticProposal({ proposalId: " " })).success).toBe(false)
    expect(parseBtLeadProposal(syntheticProposal({ signedInBuildertrend: "yes" })).success).toBe(false)
  })
})

describe("btProposalStatusLabel", () => {
  const base = { approvedByName: "Pat Example", approvalDeadline: "2024-11-15", statusDate: null }
  it.each([
    ["approved", "Approved by Pat Example"],
    ["approved_not_released", "Approved (not released)"],
    ["declined", "Declined by Pat Example"],
    ["declined_not_released", "Declined (not released)"],
    ["pending", "Pending"],
    ["pending_not_released", "Not released"],
    ["viewed", "Viewed by customer"],
    ["expired", "Expired Nov 15, 2024"],
  ] as const)("%s → %s", (status, label) => {
    expect(btProposalStatusLabel({ ...base, status })).toBe(label)
  })

  it("leaves out a missing name or deadline", () => {
    expect(btProposalStatusLabel({ status: "approved", approvedByName: null, approvalDeadline: null, statusDate: null })).toBe("Approved")
    expect(btProposalStatusLabel({ status: "expired", approvedByName: null, approvalDeadline: null, statusDate: null })).toBe("Expired")
  })
})

describe("proposal totals", () => {
  it("flattens items in order, sub-group items after their group's own", () => {
    const items = flattenBtProposalItems(parsed().groups)
    expect(items.map((entry) => [entry.item.title, entry.groupIndex, entry.subGroupTitle])).toEqual([
      ["Mobilize", 0, null],
      ["Dig", 0, "Excavation"],
      ["Paint", 1, null],
    ])
  })

  it("adds owner price and builder cost across groups and sub-groups", () => {
    expect(btProposalTotals(parsed().groups)).toEqual({ ownerPriceCents: 33_000, builderCostCents: 27_500, itemCount: 3 })
  })

  it("gives each group its subtotal, sub-groups included", () => {
    const views = btProposalGroupViews(parsed().groups)
    expect(views.map((group) => group.ownerPriceCents)).toEqual([24_500, 8_500, 0])
    expect(views[0]?.subGroups[0]?.ownerPriceCents).toBe(12_500)
  })
})

describe("btProposalAttachment", () => {
  const file = { id: "f1", fileName: "plan.pdf", verifiedDriveFileId: "abc_123", verifiedDriveUrl: "https://drive.google.com/file/d/abc_123/view" }

  it("links a verified Drive copy of the same file", () => {
    expect(btProposalAttachment(file)).toEqual({ status: "verified", id: "f1", label: "plan.pdf", url: "https://drive.google.com/file/d/abc_123/view" })
  })

  it("holds files that are unverified, elsewhere, or a different Drive file", () => {
    expect(btProposalAttachment({ ...file, verifiedDriveUrl: null }).status).toBe("held")
    expect(btProposalAttachment({ ...file, verifiedDriveUrl: "https://example.com/file/d/abc_123/view" }).status).toBe("held")
    expect(btProposalAttachment({ ...file, verifiedDriveUrl: "https://drive.google.com/file/d/other/view" }).status).toBe("held")
    expect(btProposalAttachment({ ...file, verifiedDriveUrl: "not a url" }).status).toBe("held")
  })
})
