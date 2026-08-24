export type NuTechProductCategory = "block" | "panel" | "web" | "accessory"

export type NuTechAirliteMappingStatus = "mapped" | "addendum_required"

export type NuTechImportedProduct = {
  readonly manufacturerSku: string
  readonly name: string
  readonly category: NuTechProductCategory
  readonly origin: string
  readonly priceUnit: string
  readonly packageQuantity: number
  readonly packageLabel: string
  readonly minimumOrderIncrement: number
  readonly squareFeetPerUnitMils: number | null
  readonly airliteTemplateSku: string | null
  readonly airliteTemplateRow: number | null
  readonly airliteMappingStatus: NuTechAirliteMappingStatus
  readonly airliteCostCents: number
  readonly newStandardPriceCents: number
  readonly newCashPriceCents: number
  readonly returningStandardPriceCents: number
  readonly returningCashPriceCents: number
  readonly newStandardMarginBasisPoints: number
  readonly newCashMarginBasisPoints: number
  readonly returningStandardMarginBasisPoints: number
  readonly returningCashMarginBasisPoints: number
}

export type NuTechCatalogImport = {
  readonly products: readonly NuTechImportedProduct[]
  readonly targetMargins: {
    readonly newStandardBasisPoints: number
    readonly newCashBasisPoints: number
    readonly returningStandardBasisPoints: number
    readonly returningCashBasisPoints: number
  }
}

type ParsedPriceRow = {
  readonly origin: string
  readonly name: string
  readonly manufacturerSku: string
  readonly packageValue: string | number
  readonly squareFeetPerUnit: number | null
  readonly airliteCostCents: number
  readonly marginBasisPoints: number
  readonly customerPriceCents: number
}

type ParsedPriceSheet = {
  readonly targetMarginBasisPoints: number
  readonly rows: readonly ParsedPriceRow[]
}

type AirliteTemplateMapping = {
  readonly row: number
  readonly sku: string
}

const BLOCK_SKUS = new Set([
  "FOX-S400",
  "FOX-EC490",
  "FOX-EC445",
  "FOX-TBT4T600",
  "FOX-S400HB",
  "FOX-EC490HB",
  "FOX-S600A",
  "FOX-EC690A",
  "FOX-C645A",
  "FOX-BL600A",
  "FOX-TT600A",
  "FOX-TB600A",
  "FOX-TBT6T400",
  "FOX-RB",
  "FOX-S800",
  "FOX-EC890",
  "FOX-C845",
  "FOX-BL800",
  "FOX-TT800",
  "FOX-TB800",
  "FOX-TBT8T400",
  "FOX-TBT8T600",
  "FOX-S800CB",
  "FOX-EC890CB",
  "FOX-S800HB",
  "FOX-EC890HB",
  "FOX-S1000",
  "FOX-EC1090",
  "FOX-S1000CB",
  "FOX-EC1090CB",
  "FOX-S1000HB",
  "FOX-EC1090HB",
  "FOX-S1200",
  "FOX-EC1290",
  "FOX-S1200HB",
  "FOX-EC1290HB",
])

const PACKAGE_PRICED_SKUS = new Set([
  "L921T809B",
  "L922T809B",
  "L923T809B",
  "L924T809B",
  "L925T809B",
  "WEBEX",
  "FOX-HVCLIPS",
  "FOX-TIE-KEY",
  "FOX-TIE-KEY-SS",
  "FOX-ZIPT36",
  "FOX-SPRAYFOAM",
  "FOX-BAGYD",
])

const AIRLITE_TEMPLATE_MAPPINGS: Readonly<
  Record<string, AirliteTemplateMapping>
> = {
  "FOX-S400": { row: 22, sku: "FOX-S400" },
  "FOX-EC490": { row: 23, sku: "FOX-EC490" },
  "FOX-EC445": { row: 24, sku: "FOX-EC445" },
  "FOX-TBT4T600": { row: 25, sku: "FOX-TBT4T600" },
  "FOX-S400HB": { row: 26, sku: "FOX-S400HB" },
  "FOX-EC490HB": { row: 27, sku: "FOX-EC490HB" },
  "FOX-S600A": { row: 28, sku: "FOX-S600" },
  "FOX-EC690A": { row: 29, sku: "FOX-EC690" },
  "FOX-C645A": { row: 30, sku: "FOX-C645" },
  "FOX-BL600A": { row: 31, sku: "FOX-BL600" },
  "FOX-TT600A": { row: 32, sku: "FOX-TT600" },
  "FOX-TB600A": { row: 33, sku: "FOX-TB600" },
  "FOX-TBT6T400": { row: 34, sku: "FOX-TBT6T400" },
  "FOX-RB": { row: 35, sku: "FOX-RB" },
  "FOX-S800": { row: 44, sku: "FOX-S800" },
  "FOX-EC890": { row: 45, sku: "FOX-EC890" },
  "FOX-C845": { row: 46, sku: "FOX-C845" },
  "FOX-BL800": { row: 47, sku: "FOX-BL800" },
  "FOX-TT800": { row: 48, sku: "FOX-TT800" },
  "FOX-TB800": { row: 49, sku: "FOX-TB800" },
  "FOX-TBT8T400": { row: 50, sku: "FOX-TBT8T400" },
  "FOX-TBT8T600": { row: 51, sku: "FOX-TBT8T600" },
  "FOX-S800CB": { row: 52, sku: "FOX-S800CB" },
  "FOX-EC890CB": { row: 53, sku: "FOX-EC890CB" },
  "FOX-S800HB": { row: 54, sku: "FOX-S800HB" },
  "FOX-EC890HB": { row: 55, sku: "FOX-EC890HB" },
  "FOX-S1000": { row: 56, sku: "FOX-S1000" },
  "FOX-EC1090": { row: 57, sku: "FOX-EC1090" },
  "FOX-S1000CB": { row: 58, sku: "FOX-S1000CB" },
  "FOX-EC1090CB": { row: 59, sku: "FOX-EC1090CB" },
  "FOX-S1000HB": { row: 60, sku: "FOX-S1000HB" },
  "FOX-EC1090HB": { row: 61, sku: "FOX-EC1090HB" },
  "FOX-S1200": { row: 64, sku: "FOX-S1200" },
  "FOX-EC1290": { row: 65, sku: "FOX-EC1290" },
  "FOX-S1200HB": { row: 66, sku: "FOX-S1200HB" },
  "FOX-EC1290HB": { row: 67, sku: "FOX-EC1290HB" },
  "FOX-BUCK4": { row: 70, sku: "FOX-Buck4" },
  "FOX-BUCK6": { row: 71, sku: "FOX-Buck6" },
  "FOX-BUCK8": { row: 72, sku: "FOX-Buck8" },
  "FOX-BUCK10": { row: 73, sku: "FOX-Buck10" },
  "FOX-BUCK12": { row: 74, sku: "FOX-Buck12" },
  "FOX-ESTICK": { row: 75, sku: "FOX-Estick" },
  "FOX-EXTR": { row: 76, sku: "FOX-Extr" },
  "FOX-HVCLIPS": { row: 77, sku: "FOX-HVClips" },
  "FOX-TIE-KEY": { row: 78, sku: "FOX-Tie-Key" },
  "FOX-TIE-KEY-SS": { row: 79, sku: "FOX-Tie-Key-ss" },
  "FOX-XLERATOR": { row: 80, sku: "Fox-xLerator" },
  "FOX-ZIPT36": { row: 81, sku: "FOX-ZipT36" },
  "FOX-BAGYD": { row: 83, sku: "FOX-Bagyd" },
  "FOX-SIGN": { row: 84, sku: "FOX-Sign" },
}

function stringCell(value: unknown): string | null {
  if (typeof value !== "string") return null
  const cleaned = value.trim()
  return cleaned.length > 0 ? cleaned : null
}

function numberCell(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value !== "string") return null
  const normalized = value.replace(/[$,%]/g, "").trim()
  if (normalized.length === 0) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function cents(value: unknown, label: string): number {
  const parsed = numberCell(value)
  if (parsed === null || parsed < 0) throw new Error(`${label} must be a number.`)
  return Math.round(parsed * 100)
}

function basisPoints(value: unknown, label: string): number {
  const parsed = numberCell(value)
  if (parsed === null || parsed < 0 || parsed >= 1) {
    throw new Error(`${label} must be a decimal gross margin.`)
  }
  return Math.round(parsed * 10_000)
}

function parsePriceSheet(
  values: ReadonlyArray<ReadonlyArray<unknown>>,
  label: string
): ParsedPriceSheet {
  const targetMarginRow = values.find(
    (row) => stringCell(row[0])?.toLowerCase() === "target gross margin"
  )
  const headerIndex = values.findIndex(
    (row) =>
      stringCell(row[0])?.toLowerCase() === "origin" &&
      stringCell(row[2])?.toLowerCase() === "sku"
  )
  if (!targetMarginRow || headerIndex < 0) {
    throw new Error(`${label} is missing its pricing header or target margin.`)
  }
  const targetMarginBasisPoints = basisPoints(
    targetMarginRow[1],
    `${label} target margin`
  )
  const rows: ParsedPriceRow[] = []
  for (const [offset, row] of values.slice(headerIndex + 1).entries()) {
    const origin = stringCell(row[0])
    const name = stringCell(row[1])
    const manufacturerSku = stringCell(row[2])?.toUpperCase() ?? null
    if (!origin && !name && !manufacturerSku) continue
    if (!origin || !name || !manufacturerSku) {
      throw new Error(`${label} row ${headerIndex + offset + 2} is incomplete.`)
    }
    const packageNumber = numberCell(row[3])
    const packageText = stringCell(row[3])
    const packageValue = packageText ?? packageNumber
    if (packageValue === null) {
      throw new Error(`${label} ${manufacturerSku} is missing its package quantity.`)
    }
    const squareFeet = numberCell(row[4])
    rows.push({
      origin,
      name,
      manufacturerSku,
      packageValue,
      squareFeetPerUnit: squareFeet,
      airliteCostCents: cents(row[5], `${label} ${manufacturerSku} cost`),
      marginBasisPoints: basisPoints(
        row[6],
        `${label} ${manufacturerSku} margin`
      ),
      customerPriceCents: cents(
        row[7],
        `${label} ${manufacturerSku} customer price`
      ),
    })
  }
  if (rows.length === 0) throw new Error(`${label} contains no catalog products.`)
  return { targetMarginBasisPoints, rows }
}

function categoryForSku(sku: string): NuTechProductCategory {
  if (BLOCK_SKUS.has(sku)) return "block"
  if (sku.startsWith("FOX-PANEL")) return "panel"
  if (sku.startsWith("L92") || sku === "WEBEX") return "web"
  return "accessory"
}

function packageDetails(
  sku: string,
  packageValue: string | number
): {
  readonly priceUnit: string
  readonly packageQuantity: number
  readonly packageLabel: string
  readonly minimumOrderIncrement: number
} {
  const packageLabel = String(packageValue).trim()
  const match = /^(\d+)(?:\s*\/\s*([a-z]+))?$/i.exec(packageLabel)
  if (!match) throw new Error(`${sku} has an unsupported package value: ${packageLabel}.`)
  const quantityText = match[1]
  if (!quantityText) throw new Error(`${sku} is missing its package quantity.`)
  const packageQuantity = Number(quantityText)
  const packageUnit = match[2]?.toLowerCase() ?? "each"
  const packagePriced = PACKAGE_PRICED_SKUS.has(sku)
  return {
    priceUnit: packagePriced ? packageUnit : "each",
    packageQuantity,
    packageLabel,
    minimumOrderIncrement: packagePriced ? 1 : packageQuantity,
  }
}

function rowMap(sheet: ParsedPriceSheet, label: string): ReadonlyMap<string, ParsedPriceRow> {
  const mapped = new Map<string, ParsedPriceRow>()
  for (const row of sheet.rows) {
    if (mapped.has(row.manufacturerSku)) {
      throw new Error(`${label} contains duplicate SKU ${row.manufacturerSku}.`)
    }
    mapped.set(row.manufacturerSku, row)
  }
  return mapped
}

function matchingRow(
  rows: ReadonlyMap<string, ParsedPriceRow>,
  sku: string,
  label: string
): ParsedPriceRow {
  const row = rows.get(sku)
  if (!row) throw new Error(`${label} is missing SKU ${sku}.`)
  return row
}

function assertSameProduct(
  baseline: ParsedPriceRow,
  candidate: ParsedPriceRow,
  label: string
): void {
  if (
    baseline.name !== candidate.name ||
    baseline.origin !== candidate.origin ||
    String(baseline.packageValue) !== String(candidate.packageValue) ||
    baseline.squareFeetPerUnit !== candidate.squareFeetPerUnit ||
    baseline.airliteCostCents !== candidate.airliteCostCents
  ) {
    throw new Error(`${label} does not match the product definition for ${baseline.manufacturerSku}.`)
  }
}

export function buildNuTechCatalogImport(input: {
  readonly newStandard: ReadonlyArray<ReadonlyArray<unknown>>
  readonly newCash: ReadonlyArray<ReadonlyArray<unknown>>
  readonly returningStandard: ReadonlyArray<ReadonlyArray<unknown>>
  readonly returningCash: ReadonlyArray<ReadonlyArray<unknown>>
}): NuTechCatalogImport {
  const newStandard = parsePriceSheet(input.newStandard, "New standard pricing")
  const newCash = parsePriceSheet(input.newCash, "New cash pricing")
  const returningStandard = parsePriceSheet(
    input.returningStandard,
    "Returning standard pricing"
  )
  const returningCash = parsePriceSheet(
    input.returningCash,
    "Returning cash pricing"
  )
  const newCashRows = rowMap(newCash, "New cash pricing")
  const returningStandardRows = rowMap(
    returningStandard,
    "Returning standard pricing"
  )
  const returningCashRows = rowMap(returningCash, "Returning cash pricing")
  if (
    newStandard.rows.length !== newCash.rows.length ||
    newStandard.rows.length !== returningStandard.rows.length ||
    newStandard.rows.length !== returningCash.rows.length
  ) {
    throw new Error("The four Nu-Tech price sheets do not contain the same product count.")
  }

  const products = newStandard.rows.map((baseline) => {
    const newCashRow = matchingRow(
      newCashRows,
      baseline.manufacturerSku,
      "New cash pricing"
    )
    const returningStandardRow = matchingRow(
      returningStandardRows,
      baseline.manufacturerSku,
      "Returning standard pricing"
    )
    const returningCashRow = matchingRow(
      returningCashRows,
      baseline.manufacturerSku,
      "Returning cash pricing"
    )
    assertSameProduct(baseline, newCashRow, "New cash pricing")
    assertSameProduct(baseline, returningStandardRow, "Returning standard pricing")
    assertSameProduct(baseline, returningCashRow, "Returning cash pricing")
    const packageInfo = packageDetails(
      baseline.manufacturerSku,
      baseline.packageValue
    )
    const airlite = AIRLITE_TEMPLATE_MAPPINGS[baseline.manufacturerSku]
    return {
      manufacturerSku: baseline.manufacturerSku,
      name: baseline.name,
      category: categoryForSku(baseline.manufacturerSku),
      origin: baseline.origin,
      ...packageInfo,
      squareFeetPerUnitMils:
        baseline.squareFeetPerUnit === null
          ? null
          : Math.round(baseline.squareFeetPerUnit * 1_000),
      airliteTemplateSku: airlite?.sku ?? null,
      airliteTemplateRow: airlite?.row ?? null,
      airliteMappingStatus: airlite ? "mapped" : "addendum_required",
      airliteCostCents: baseline.airliteCostCents,
      newStandardPriceCents: baseline.customerPriceCents,
      newCashPriceCents: newCashRow.customerPriceCents,
      returningStandardPriceCents: returningStandardRow.customerPriceCents,
      returningCashPriceCents: returningCashRow.customerPriceCents,
      newStandardMarginBasisPoints: baseline.marginBasisPoints,
      newCashMarginBasisPoints: newCashRow.marginBasisPoints,
      returningStandardMarginBasisPoints: returningStandardRow.marginBasisPoints,
      returningCashMarginBasisPoints: returningCashRow.marginBasisPoints,
    } satisfies NuTechImportedProduct
  })

  return {
    products,
    targetMargins: {
      newStandardBasisPoints: newStandard.targetMarginBasisPoints,
      newCashBasisPoints: newCash.targetMarginBasisPoints,
      returningStandardBasisPoints: returningStandard.targetMarginBasisPoints,
      returningCashBasisPoints: returningCash.targetMarginBasisPoints,
    },
  }
}

export type NuTechSageCostCodeCandidate = {
  readonly id: string
  readonly code: string
  readonly description: string
  readonly score: number
}

function normalizedSearchValue(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

export function nuTechSageCostCodeCandidates(
  product: Pick<NuTechImportedProduct, "manufacturerSku" | "name">,
  costCodes: readonly {
    readonly id: string
    readonly code: string
    readonly description: string
  }[]
): readonly NuTechSageCostCodeCandidate[] {
  const sku = normalizedSearchValue(product.manufacturerSku)
  const name = normalizedSearchValue(product.name)
  return costCodes
    .flatMap((costCode) => {
      const haystack = normalizedSearchValue(
        `${costCode.code} ${costCode.description}`
      )
      const score = haystack.includes(sku)
        ? 100
        : haystack === name
          ? 90
          : haystack.includes(name) || name.includes(haystack)
            ? 70
            : 0
      return score > 0 ? [{ ...costCode, score }] : []
    })
    .sort((left, right) => right.score - left.score || left.code.localeCompare(right.code))
}
