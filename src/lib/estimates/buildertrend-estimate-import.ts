/**
 * Buildertrend "Estimate report" spreadsheet export → Compass estimate lines.
 *
 * Each Buildertrend row becomes one estimate line. Buildertrend's "Parent
 * Group" (a scope package such as "Footer Labor & Materials") becomes a
 * report phase, so the client report reads like the Buildertrend proposal:
 * the package name, its description and its total. Amounts are kept exactly
 * as exported (builder cost and total price) so an imported, signed estimate
 * matches the signed contract to the cent; Compass's own rounding can differ
 * by a cent from Buildertrend's on some lines.
 */

const BUILDERTREND_ESTIMATE_REQUIRED_COLUMNS = [
  "Cost Code",
  "Title",
  "Parent Group",
  "Quantity",
  "Unit Cost",
  "Builder Cost",
  "Total Price",
] as const

export type BuildertrendEstimateLine = {
  /** Spreadsheet row number (header is row 1). */
  readonly rowNumber: number
  readonly costCode: string
  readonly costCodeName: string
  readonly description: string
  readonly notes: string | null
  readonly phaseName: string
  readonly quantity: number
  readonly unit: string
  readonly unitCostCents: number
  readonly directCostCents: number
  readonly markupRateBasisPoints: number
  readonly lineTotalCents: number
  readonly costType: string | null
}

export type BuildertrendEstimatePhase = {
  readonly name: string
  readonly description: string
  readonly sortOrder: number
  /** Named by a Buildertrend Parent Group, which also becomes an estimate assembly. */
  readonly fromParentGroup: boolean
}

export type BuildertrendEstimateParseResult =
  | {
      readonly success: true
      readonly lines: readonly BuildertrendEstimateLine[]
      readonly phases: readonly BuildertrendEstimatePhase[]
      readonly directCostCents: number
      readonly totalCents: number
    }
  | { readonly success: false; readonly error: string }

type Row = Readonly<Record<string, unknown>>

function text(row: Row, column: string): string {
  const value = row[column]
  if (value === null || value === undefined) return ""
  return String(value).trim()
}

function amount(row: Row, column: string): number | null {
  const value = row[column]
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  const cleaned = text(row, column).replace(/[$,\s]/g, "")
  if (cleaned === "") return null
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

function cents(value: number): number {
  return Math.round(value * 100)
}

/** "... 03 11 13 - Forming Boards" → { code: "03 11 13", name: "Forming Boards" }. */
export function parseBuildertrendCostCode(value: string): { readonly code: string; readonly name: string } | null {
  const match = /^(?:\.\.\.\s*)?(\d{2}(?:\s\d{2}){2})\s*-\s*(.+)$/.exec(value.trim())
  if (!match) return null
  return { code: match[1] ?? "", name: (match[2] ?? "").trim() }
}

/**
 * Validates and normalizes Buildertrend export rows (objects keyed by the
 * header row). Rejects exports Compass can't import faithfully yet (taxed or
 * optional/alternate rows) instead of silently changing the total.
 */
export function parseBuildertrendEstimateRows(rows: readonly Row[]): BuildertrendEstimateParseResult {
  if (rows.length === 0) return { success: false, error: "The spreadsheet has no estimate rows." }
  const headers = new Set(Object.keys(rows[0] ?? {}).map((key) => key.trim()))
  const missing = BUILDERTREND_ESTIMATE_REQUIRED_COLUMNS.filter((column) => !headers.has(column))
  if (missing.length > 0) {
    return { success: false, error: `This doesn't look like a Buildertrend estimate export. Missing columns: ${missing.join(", ")}.` }
  }
  if (rows.length > 2_000) return { success: false, error: "Buildertrend imports are limited to 2,000 rows." }

  const lines: BuildertrendEstimateLine[] = []
  const phaseOrder: string[] = []
  const phaseDescriptions = new Map<string, string>()
  const parentGroupPhases = new Set<string>()
  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 2
    // Fully blank rows (spreadsheet padding) are skipped.
    if (Object.values(row).every((value) => value === null || value === undefined || String(value).trim() === "")) continue
    const optionType = text(row, "Option Type")
    if (optionType) return { success: false, error: `Row ${rowNumber} is a Buildertrend option (${optionType}). Remove options from the export or import them as a change order.` }
    const taxAmount = amount(row, "Tax Amount") ?? 0
    if (Math.abs(taxAmount) >= 0.005) return { success: false, error: `Row ${rowNumber} is taxed. Taxed Buildertrend rows aren't supported by this import yet.` }
    const costCode = parseBuildertrendCostCode(text(row, "Cost Code"))
    if (!costCode) return { success: false, error: `Row ${rowNumber} has no recognizable cost code (expected "03 21 00 - Name").` }
    const description = text(row, "Title")
    if (!description) return { success: false, error: `Row ${rowNumber} has no title.` }
    const parentGroup = text(row, "Parent Group")
    const phaseName = parentGroup || costCode.name
    const quantity = amount(row, "Quantity")
    const unitCost = amount(row, "Unit Cost")
    const builderCost = amount(row, "Builder Cost")
    const totalPrice = amount(row, "Total Price")
    if (quantity === null || quantity < 0) return { success: false, error: `Row ${rowNumber} has an invalid quantity.` }
    if (unitCost === null || unitCost < 0) return { success: false, error: `Row ${rowNumber} has an invalid unit cost.` }
    if (builderCost === null || builderCost < 0) return { success: false, error: `Row ${rowNumber} has an invalid builder cost.` }
    if (totalPrice === null || totalPrice < 0) return { success: false, error: `Row ${rowNumber} has an invalid total price.` }
    const directCostCents = cents(builderCost)
    const lineTotalCents = cents(totalPrice)
    if (lineTotalCents < directCostCents) return { success: false, error: `Row ${rowNumber}'s total price is below its builder cost.` }
    const markupPercent = text(row, "Markup Type") === "%" || text(row, "Markup Type") === "" ? amount(row, "Markup") ?? 0 : null
    const markupRateBasisPoints =
      markupPercent !== null
        ? Math.round(markupPercent * 100)
        : directCostCents > 0
          ? Math.round(((lineTotalCents - directCostCents) / directCostCents) * 10_000)
          : 0
    if (parentGroup) parentGroupPhases.add(phaseName)
    if (!phaseDescriptions.has(phaseName)) {
      phaseOrder.push(phaseName)
      phaseDescriptions.set(phaseName, text(row, "Parent Group Description"))
    }
    const subgroup = text(row, "Subgroup")
    const internalNotes = text(row, "Internal Notes")
    const notes = [subgroup ? `Subgroup: ${subgroup}` : "", internalNotes].filter(Boolean).join("\n")
    lines.push({
      rowNumber,
      costCode: costCode.code,
      costCodeName: costCode.name,
      description: description.slice(0, 500),
      notes: notes ? notes.slice(0, 5_000) : null,
      phaseName: phaseName.slice(0, 160),
      quantity,
      unit: text(row, "Unit").slice(0, 40) || "LS",
      unitCostCents: cents(unitCost),
      directCostCents,
      markupRateBasisPoints,
      lineTotalCents,
      costType: text(row, "Cost Type") || null,
    })
  }
  if (lines.length === 0) return { success: false, error: "The spreadsheet has no estimate rows." }
  return {
    success: true,
    lines,
    phases: phaseOrder.map((name, index) => ({
      name: name.slice(0, 160),
      description: (phaseDescriptions.get(name) ?? "").slice(0, 6_000),
      sortOrder: index + 1,
      fromParentGroup: parentGroupPhases.has(name),
    })),
    directCostCents: lines.reduce((sum, line) => sum + line.directCostCents, 0),
    totalCents: lines.reduce((sum, line) => sum + line.lineTotalCents, 0),
  }
}
