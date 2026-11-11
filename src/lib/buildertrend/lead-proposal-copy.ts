import type { BuildertrendEstimateLine, BuildertrendEstimatePhase } from "@/lib/estimates/buildertrend-estimate-import"
import { parseBuildertrendCostCode } from "@/lib/estimates/buildertrend-estimate-import"
import { flattenBtProposalItems, type BtLeadProposal } from "@/lib/buildertrend/lead-proposal"

/*
 * A Buildertrend lead proposal as rows for the existing Buildertrend estimate
 * importer (importBuildertrendExport in src/lib/domain/estimates/imports.ts),
 * which "Copy into a new draft estimate" runs on a new draft. Each top-level
 * proposal group becomes a report phase and an assembly, as a Buildertrend
 * export's Parent Group does; sub-group items land in their top group with
 * "Subgroup: …" in the line notes. Amounts are carried exactly: builder cost
 * is the line's direct cost and the owner price its total, with Buildertrend's
 * markup percent. The proposal itself is never changed.
 *
 * Pure: no database or network access.
 */

export type BtProposalImportRows = {
  readonly sourceFileName: string
  readonly lines: readonly BuildertrendEstimateLine[]
  readonly phases: readonly BuildertrendEstimatePhase[]
}

const PHASE_NAME_LIMIT = 160

/** A unique, non-empty phase name for each top-level group, in order. */
function phaseNames(titles: readonly string[]): readonly string[] {
  const used = new Set<string>()
  return titles.map((title, index) => {
    const base = (title.trim() || `Group ${index + 1}`).slice(0, PHASE_NAME_LIMIT)
    let name = base
    for (let copy = 2; used.has(name); copy += 1) {
      const suffix = ` (${copy})`
      name = `${base.slice(0, PHASE_NAME_LIMIT - suffix.length)}${suffix}`
    }
    used.add(name)
    return name
  })
}

/** Buildertrend's markup percent, or the rate its cents imply, in basis points. */
export function btMarkupBasisPoints(markupPercent: number | null, builderCostCents: number, ownerPriceCents: number): number {
  if (markupPercent !== null) return Math.round(markupPercent * 100)
  if (builderCostCents <= 0) return 0
  return Math.round(((ownerPriceCents - builderCostCents) / builderCostCents) * 10_000)
}

/**
 * "01 71 13 - Mobilization" → code "01 71 13", name "Mobilization". Text that
 * is not a CSI code is kept as written so the importer can flag it for remapping.
 */
export function btCostCode(costCode: string | null): { readonly code: string; readonly name: string } {
  const text = costCode?.trim() ?? ""
  return parseBuildertrendCostCode(text) ?? { code: text.slice(0, 100), name: text.slice(0, 200) }
}

/** The importer rows for a proposal's items. */
export function btProposalImportRows(proposal: BtLeadProposal): BtProposalImportRows {
  const names = phaseNames(proposal.groups.map((group) => group.title))
  const items = flattenBtProposalItems(proposal.groups)
  const lines = items.map((entry, index): BuildertrendEstimateLine => {
    const { item } = entry
    const cost = btCostCode(item.costCode)
    const notes = [
      item.description?.trim() ?? "",
      entry.subGroupTitle?.trim() ? `Subgroup: ${entry.subGroupTitle.trim()}` : "",
      item.internalNotes?.trim() ?? "",
    ].filter(Boolean).join("\n")
    return {
      rowNumber: index + 1,
      costCode: cost.code,
      costCodeName: cost.name,
      description: (item.title.trim() || item.description?.trim() || "Proposal item").slice(0, 500),
      notes: notes ? notes.slice(0, 5_000) : null,
      phaseName: names[entry.groupIndex] ?? `Group ${entry.groupIndex + 1}`,
      quantity: item.quantity,
      unit: item.unit?.trim().slice(0, 40) || "LS",
      unitCostCents: item.unitCostCents,
      directCostCents: item.builderCostCents,
      markupRateBasisPoints: btMarkupBasisPoints(item.markupPercent, item.builderCostCents, item.ownerPriceCents),
      lineTotalCents: item.ownerPriceCents,
      costType: null,
    }
  })
  // Only groups with items become phases; an empty group would be an empty assembly.
  const usedGroups = new Set(items.map((entry) => entry.groupIndex))
  const phases = proposal.groups.flatMap((group, index): BuildertrendEstimatePhase[] =>
    usedGroups.has(index)
      ? [{
          name: names[index] ?? `Group ${index + 1}`,
          description: (group.description ?? "").slice(0, 6_000),
          sortOrder: index + 1,
          fromParentGroup: true,
        }]
      : [],
  )
  return { sourceFileName: (proposal.title.trim() || `Proposal ${proposal.proposalId}`).slice(0, 200), lines, phases }
}
