export type ProjectTotalsImportLine = {
  readonly costCode: string
  readonly divisionCode: string
  readonly divisionName: string
  readonly description: string
  readonly specifications: string | null
  readonly amountCents: number
  readonly sortOrder: number
}

export type ProjectTotalsImportResult =
  | {
      readonly success: true
      readonly lines: readonly ProjectTotalsImportLine[]
      readonly displayedTotalCents: number
      readonly projectSubtotalCents: number
      readonly overheadRateBasisPoints: number
      readonly overheadCents: number
      readonly marginRateBasisPoints: number
      readonly marginCents: number
      readonly contingencyRateBasisPoints: number
      readonly contingencyCents: number
      readonly roundingAdjustmentCents: number
    }
  | { readonly success: false; readonly error: string }

export const CONTRACT_ADJUSTMENT_COST_CODES = [
  {
    value: "99 10 00",
    description: "Company Overhead",
    sourceLabels: ["Company Overhead"],
  },
  {
    value: "99 20 00",
    description: "Company Margin",
    sourceLabels: ["Company Margin"],
  },
  {
    value: "99 30 00",
    description: "Contingency Reserve",
    sourceLabels: ["Contingency Reserve", "Contingency"],
  },
] as const

const DIVISION_NAMES: Readonly<Record<string, string>> = {
  "00": "Procurement Requirements",
  "01": "General Requirements",
  "02": "Existing Conditions",
  "03": "Concrete",
  "04": "Masonry",
  "05": "Metals",
  "06": "Wood, Plastics, and Composites",
  "07": "Thermal and Moisture Protection",
  "08": "Openings",
  "09": "Finishes",
  "10": "Specialties",
  "11": "Equipment",
  "12": "Furnishings",
  "13": "Special Construction",
  "14": "Conveying Equipment",
  "21": "Fire Suppression",
  "22": "Plumbing",
  "23": "Heating, Ventilating, and Air Conditioning",
  "26": "Electrical",
  "27": "Communications",
  "28": "Electronic Safety and Security",
  "31": "Earthwork",
  "32": "Exterior Improvements",
  "33": "Utilities",
  "48": "Electrical Power Generation Equipment",
  "99": "Contract Adjustments",
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parseCurrency(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const negative = trimmed.startsWith("(") && trimmed.endsWith(")")
  const parsed = Number(trimmed.replaceAll(/[$,\s()]/g, ""))
  if (!Number.isFinite(parsed)) return null
  return negative ? -parsed : parsed
}

function parseCostCodeLabel(
  value: string
): { readonly code: string; readonly description: string } | null {
  const match = /^(\d{2}(?:\s\d{2}){0,2}(?:\.\d{2})*)\s+-\s+(.+)$/.exec(
    value
  )
  const code = match?.[1]?.trim()
  const description = match?.[2]?.trim()
  return code && description ? { code, description } : null
}

function adjustmentForLabel(
  value: string
): (typeof CONTRACT_ADJUSTMENT_COST_CODES)[number] | null {
  const normalized = value.trim().toLowerCase()
  return (
    CONTRACT_ADJUSTMENT_COST_CODES.find(
      (item) =>
        item.sourceLabels.some((label) => label.toLowerCase() === normalized)
    ) ?? null
  )
}

function roundingNote(cents: number): string {
  const amount = Math.abs(cents) / 100
  const sign = cents >= 0 ? "+" : "-"
  return `Source rounding reconciliation: ${sign}$${amount.toFixed(2)}.`
}

export function parseProjectTotalsRows(
  rows: ReadonlyArray<ReadonlyArray<unknown>>
): ProjectTotalsImportResult {
  const parsedLines: Array<{
    readonly costCode: string
    readonly description: string
    readonly specifications: string | null
    readonly rawAmount: number
  }> = []
  const adjustments = new Map<string, number>()
  let displayedTotal: number | null = null
  let displayedSubtotal: number | null = null
  let inAdjustmentSection = false

  for (const row of rows) {
    const label = cleanText(row[0])
    if (!label) continue
    const amount = parseCurrency(row[4])

    if (label === "Project Total:") {
      if (amount !== null && amount > 0) displayedTotal = amount
      continue
    }
    if (label === "Project Subtotal:") {
      if (amount !== null && amount > 0) displayedSubtotal = amount
      continue
    }
    if (label === "Company Overhead & Margin") {
      inAdjustmentSection = true
      continue
    }
    if (
      label === "Project Totals" ||
      label.startsWith("Total:")
    ) {
      continue
    }

    const parsedCostCode = parseCostCodeLabel(label)
    const adjustment = inAdjustmentSection
      ? adjustmentForLabel(label)
      : null
    if ((!parsedCostCode && !adjustment) || amount === null || amount === 0) {
      continue
    }

    if (adjustment) {
      adjustments.set(adjustment.value, amount)
      continue
    }

    parsedLines.push({
      costCode: parsedCostCode?.code ?? "",
      description: parsedCostCode?.description ?? label,
      specifications: cleanText(row[1]),
      rawAmount: amount,
    })
  }

  if (parsedLines.length === 0) {
    return {
      success: false,
      error: "No non-zero Schedule of Values lines were found in Project Totals.",
    }
  }

  const duplicates = [...new Set(
    parsedLines
      .filter(
        (line, index) =>
          parsedLines.findIndex((candidate) => candidate.costCode === line.costCode) !==
          index
      )
      .map((line) => line.costCode)
  )]
  if (duplicates.length > 0) {
    return {
      success: false,
      error: `Project Totals contains duplicate cost codes: ${duplicates.join(", ")}. Resolve them before import.`,
    }
  }

  const rawDirectTotal = parsedLines.reduce(
    (sum, line) => sum + line.rawAmount,
    0
  )
  const sourceSubtotal = displayedSubtotal ?? rawDirectTotal
  const rawAdjustmentTotal = [...adjustments.values()].reduce(
    (sum, amount) => sum + amount,
    0
  )
  const sourceTotal = displayedTotal ?? sourceSubtotal + rawAdjustmentTotal
  if (Math.abs(rawDirectTotal - sourceSubtotal) >= 0.005) {
    return {
      success: false,
      error: `Project Totals does not reconcile: displayed subtotal $${sourceSubtotal.toFixed(2)} versus cost-code total $${rawDirectTotal.toFixed(2)}.`,
    }
  }
  if (Math.abs(sourceSubtotal + rawAdjustmentTotal - sourceTotal) >= 0.005) {
    return {
      success: false,
      error: `Project Totals does not reconcile: displayed $${sourceTotal.toFixed(2)} versus subtotal and builder fee $${(sourceSubtotal + rawAdjustmentTotal).toFixed(2)}.`,
    }
  }

  const displayedTotalCents = Math.round(sourceTotal * 100)
  const projectSubtotalCents = Math.round(sourceSubtotal * 100)
  const roundedTotalCents = parsedLines.reduce(
    (sum, line) => sum + Math.round(line.rawAmount * 100),
    0
  )
  const roundingAdjustmentCents = projectSubtotalCents - roundedTotalCents
  const targetIndex = parsedLines.length - 1

  const lines = parsedLines.map((line, index): ProjectTotalsImportLine => {
    const adjustment = index === targetIndex ? roundingAdjustmentCents : 0
    const divisionCode = line.costCode.slice(0, 2)
    const note = adjustment === 0
      ? line.specifications
      : [line.specifications, roundingNote(adjustment)].filter(Boolean).join(" ")
    return {
      costCode: line.costCode,
      divisionCode,
      divisionName: DIVISION_NAMES[divisionCode] ?? "Project Estimate",
      description: line.description,
      specifications: note || null,
      amountCents: Math.round(line.rawAmount * 100) + adjustment,
      sortOrder: index + 1,
    }
  })

  return {
    success: true,
    lines,
    displayedTotalCents,
    projectSubtotalCents,
    overheadRateBasisPoints: Math.round(
      ((adjustments.get("99 10 00") ?? 0) / sourceSubtotal) * 10_000
    ),
    overheadCents: Math.round((adjustments.get("99 10 00") ?? 0) * 100),
    marginRateBasisPoints: Math.round(
      ((adjustments.get("99 20 00") ?? 0) / sourceSubtotal) * 10_000
    ),
    marginCents: Math.round((adjustments.get("99 20 00") ?? 0) * 100),
    contingencyRateBasisPoints: Math.round(
      ((adjustments.get("99 30 00") ?? 0) / sourceSubtotal) * 10_000
    ),
    contingencyCents: Math.round(
      (adjustments.get("99 30 00") ?? 0) * 100
    ),
    roundingAdjustmentCents,
  }
}

export function spreadsheetIdFromUrl(value: string | null): string | null {
  if (!value) return null
  const match = /\/spreadsheets\/d\/([^/]+)/.exec(value)
  return match?.[1] ?? null
}
