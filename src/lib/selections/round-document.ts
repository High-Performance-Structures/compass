/**
 * The selections round document: what the owner reviews and signs for one
 * round. One line per selection in the round with its room, the chosen
 * choice, photo, supplier link, owner price and over/under the allowance,
 * then the round total against the allowance, and what the overage becomes
 * (a variance or a change order, by contract type and the company
 * threshold). Pure: the print view, the signing PDF and the server checks
 * share it.
 */

export type RoundDocumentLineInput = {
  readonly selectionId: string
  readonly roomName: string
  readonly selectionName: string
  readonly choiceId: string | null
  readonly choiceTitle: string | null
  readonly choiceDescription: string | null
  readonly photoId: string | null
  readonly linkUrl: string | null
  readonly linkSite: string | null
  readonly ownerPriceCents: number | null
  readonly allowanceCents: number | null
  /**
   * The owner price already in the contract for this selection (an approved
   * pick that changed): the line is billed against it instead of the
   * allowance, which is still shown and used for the threshold.
   */
  readonly settledOwnerPriceCents?: number | null
  readonly costCode: string | null
  /** "Picked by … for the owner" or "Picked by the owner", for the record. */
  readonly pickedBy: string | null
  /** Already signed for in an earlier signature on this pick (shown, not signed again). */
  readonly signedEarlier: boolean
}

type RoundDocumentLine = RoundDocumentLineInput & {
  /** Owner price minus the price already in the contract (settled, else the allowance; none counts as $0); null until the owner price is set. */
  readonly deltaCents: number | null
}

export type OverageTreatment = "none" | "variance" | "change_order"

export type RoundDocument = {
  readonly lines: readonly RoundDocumentLine[]
  /** Lines this signature covers: picked and not already signed for. */
  readonly toSign: readonly RoundDocumentLine[]
  readonly allowanceCents: number
  readonly ownerTotalCents: number
  /** Over (+) or under (-) the allowance for the lines being signed. */
  readonly deltaCents: number
  /** |delta| as a percent of the allowance; null with no allowance. */
  readonly deltaPercent: number | null
  readonly treatment: OverageTreatment
  /** Why the document can't be signed yet, or null. */
  readonly blocker: string | null
}

export type ContractKind = "fixed_price" | "cost_plus"

/**
 * Fixed-price jobs change the contract by change order. Cost-plus jobs use a
 * variance, unless the overage (or credit) is more than the threshold
 * percent of the allowance, which makes it a change order the owner signs.
 */
export function overageTreatment(deltaCents: number, allowanceCents: number, contract: ContractKind, thresholdPercent: number): OverageTreatment {
  if (deltaCents === 0) return "none"
  if (contract === "fixed_price") return "change_order"
  if (allowanceCents <= 0) return "change_order"
  return (Math.abs(deltaCents) / allowanceCents) * 100 > thresholdPercent ? "change_order" : "variance"
}

export function buildRoundDocument(
  inputs: readonly RoundDocumentLineInput[],
  contract: ContractKind,
  thresholdPercent: number,
): RoundDocument {
  const lines = inputs.map((line) => ({
    ...line,
    deltaCents: line.ownerPriceCents === null ? null : line.ownerPriceCents - (line.settledOwnerPriceCents ?? line.allowanceCents ?? 0),
  }))
  const toSign = lines.filter((line) => line.choiceId !== null && !line.signedEarlier)
  const allowanceCents = toSign.reduce((total, line) => total + (line.allowanceCents ?? 0), 0)
  const ownerTotalCents = toSign.reduce((total, line) => total + (line.ownerPriceCents ?? 0), 0)
  const deltaCents = toSign.reduce((total, line) => total + (line.deltaCents ?? 0), 0)
  const missingPick = lines.find((line) => line.choiceId === null)
  const missingPrice = toSign.find((line) => line.ownerPriceCents === null)
  const blocker =
    lines.length === 0
      ? "This Selection Phase has no selections."
      : missingPick
        ? `${missingPick.selectionName} doesn't have the owner's pick yet.`
        : missingPrice
          ? `${missingPrice.selectionName}: set the owner price for the picked choice.`
          : toSign.length === 0
            ? "Every pick in this Selection Phase is already signed for."
            : null
  return {
    lines,
    toSign,
    allowanceCents,
    ownerTotalCents,
    deltaCents,
    deltaPercent: allowanceCents > 0 ? (Math.abs(deltaCents) / allowanceCents) * 100 : null,
    treatment: overageTreatment(deltaCents, allowanceCents, contract, thresholdPercent),
    blocker,
  }
}

export type OverageLine = { readonly costCode: string; readonly description: string; readonly amountCents: number }

/**
 * The change order or variance lines for a round: each cost code's net
 * over/under across the picks being signed. Lines that net to zero drop
 * out. A pick off the allowance with no cost code can't be coded.
 */
export function roundOverageLines(
  document: Pick<RoundDocument, "toSign">,
  roundName: string,
): { readonly ok: true; readonly lines: readonly OverageLine[] } | { readonly ok: false; readonly error: string } {
  const uncoded = document.toSign.find((line) => (line.deltaCents ?? 0) !== 0 && !line.costCode?.trim())
  if (uncoded) return { ok: false, error: `${uncoded.selectionName}: choose a cost code so its change can be coded.` }
  const byCode = new Map<string, { amountCents: number; names: string[] }>()
  for (const line of document.toSign) {
    const delta = line.deltaCents ?? 0
    const code = line.costCode?.trim()
    if (delta === 0 || !code) continue
    const entry = byCode.get(code) ?? { amountCents: 0, names: [] }
    entry.amountCents += delta
    entry.names.push(line.selectionName)
    byCode.set(code, entry)
  }
  const lines = [...byCode.entries()]
    .filter(([, entry]) => entry.amountCents !== 0)
    .map(([costCode, entry]) => ({
      costCode,
      description: `${roundName} selections: ${entry.names.join(", ")}`.slice(0, 500),
      amountCents: entry.amountCents,
    }))
  return { ok: true, lines }
}
