/**
 * Totals for the owner's choosing view. Pure.
 *
 * "Allowance for what you've chosen" and "your choices" only count picks
 * that have an owner price and a published allowance, so the over/under
 * compares like with like. Null when no pick is priced yet.
 */
export type OwnerBoardTotalsInput = readonly {
  readonly allowanceCents: number | null
  readonly panel: { readonly choices: readonly { readonly chosen: boolean; readonly ownerPriceCents: number | null }[] }
}[]

export type OwnerBoardTotals = {
  readonly total: number
  readonly chosen: number
  readonly allowanceCents: number | null
  readonly pickedCents: number | null
  readonly deltaCents: number
}

export function ownerBoardTotals(selections: OwnerBoardTotalsInput): OwnerBoardTotals {
  let chosen = 0
  let allowance = 0
  let picked = 0
  let priced = 0
  for (const selection of selections) {
    const pick = selection.panel.choices.find((choice) => choice.chosen)
    if (!pick) continue
    chosen += 1
    if (pick.ownerPriceCents === null || selection.allowanceCents === null) continue
    priced += 1
    allowance += selection.allowanceCents
    picked += pick.ownerPriceCents
  }
  return {
    total: selections.length,
    chosen,
    allowanceCents: priced > 0 ? allowance : null,
    pickedCents: priced > 0 ? picked : null,
    deltaCents: picked - allowance,
  }
}
