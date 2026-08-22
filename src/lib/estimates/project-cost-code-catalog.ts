import { CSI_PROJECT_TOTALS_FALLBACK_COST_CODES } from "@/lib/estimates/csi-project-totals-catalog"
import {
  SAGE_ESTIMATE_COST_CODE_CATALOG,
  type SageEstimateCatalogRow,
} from "@/lib/estimates/sage-estimate-cost-code-catalog"

export type EstimateSageCostCode = {
  readonly code: string
  readonly description: string
  readonly displayLabel: string
  readonly divisionCode: string
  readonly divisionDescription: string
  readonly divisionDisplayLabel: string
}

export type EstimateSageNamedCostCode = {
  readonly sourceSystem: string
  readonly costCode: string
  readonly description: string
  readonly divisionName: string
}

export type ProjectEstimateCostCodeCatalogItem = {
  readonly code: string
  readonly sourceCostCode: string
  readonly description: string
  readonly displayLabel: string
  readonly divisionCode: string
  readonly divisionDescription: string
  readonly divisionDisplayLabel: string
  readonly sageMapped: boolean
}

const CSI_CODE_FROM_NAME =
  /^\s*(\d{2})\s+(\d{2})\s+(\d{2})(\.\d{2})?(?:\s*[-–—]\s*|\s+)?(.*)$/

function catalogItemFromWorkbook(
  row: SageEstimateCatalogRow
): ProjectEstimateCostCodeCatalogItem {
  const [name, , divisionCode, divisionDescription] = row
  const match = CSI_CODE_FROM_NAME.exec(name)
  const matchedDivision = match?.[1]
  const middleCode = match?.[2]
  const finalCode = match?.[3]
  const csiCode =
    matchedDivision && middleCode && finalCode
      ? `${matchedDivision} ${middleCode} ${finalCode}${match?.[4] ?? ""}`
      : null
  const description = csiCode ? match?.[5]?.trim() || csiCode : name
  const code = csiCode ?? name

  return {
    code,
    // The Sage export supplied names and divisions rather than the numeric item
    // IDs. Named entries intentionally retain their exact description so Sage
    // handoff can resolve them by name, including Division 01 and builder fees.
    sourceCostCode: name,
    description,
    displayLabel: csiCode ? `${csiCode} ${description}` : name,
    divisionCode,
    divisionDescription,
    divisionDisplayLabel: `${divisionCode} · ${divisionDescription}`,
    sageMapped: true,
  }
}

function sageCodeFromName(
  row: EstimateSageNamedCostCode
): ProjectEstimateCostCodeCatalogItem | null {
  if (!row.sourceSystem.toLowerCase().startsWith("sage")) return null

  const match = CSI_CODE_FROM_NAME.exec(row.description)
  if (!match) return null

  const divisionCode = match[1]
  const middleCode = match[2]
  const finalCode = match[3]
  if (!divisionCode || !middleCode || !finalCode) return null

  const code = `${divisionCode} ${middleCode} ${finalCode}${match[4] ?? ""}`
  const description = match[5]?.trim() || code
  const divisionDescription = row.divisionName.trim() || "General Requirements"
  return {
    code,
    sourceCostCode: row.costCode.trim(),
    description,
    displayLabel: `${code} ${description}`,
    divisionCode,
    divisionDescription,
    divisionDisplayLabel: `${divisionCode} · ${divisionDescription}`,
    sageMapped: true,
  }
}

export function projectEstimateCostCodeCatalog(
  sageRows: readonly EstimateSageCostCode[],
  namedSageRows: readonly EstimateSageNamedCostCode[],
  workbookRows: readonly SageEstimateCatalogRow[] =
    SAGE_ESTIMATE_COST_CODE_CATALOG
): readonly ProjectEstimateCostCodeCatalogItem[] {
  const catalog = new Map<string, ProjectEstimateCostCodeCatalogItem>()

  for (const row of workbookRows) {
    const item = catalogItemFromWorkbook(row)
    catalog.set(item.code, item)
  }

  for (const row of sageRows) {
    for (const [code, item] of catalog) {
      if (
        item.sourceCostCode === row.description &&
        item.divisionCode === row.divisionCode
      ) {
        catalog.delete(code)
      }
    }
    catalog.set(row.code, {
      code: row.code,
      sourceCostCode: row.code,
      description: row.description,
      displayLabel: row.displayLabel,
      divisionCode: row.divisionCode,
      divisionDescription: row.divisionDescription,
      divisionDisplayLabel: row.divisionDisplayLabel,
      sageMapped: true,
    })
  }

  for (const row of namedSageRows) {
    const namedCode = sageCodeFromName(row)
    if (!namedCode || catalog.has(namedCode.code)) continue
    catalog.set(namedCode.code, namedCode)
  }

  for (const row of CSI_PROJECT_TOTALS_FALLBACK_COST_CODES) {
    if (catalog.has(row.code)) continue
    catalog.set(row.code, {
      code: row.code,
      sourceCostCode: row.code,
      description: row.description,
      displayLabel: `${row.code} ${row.description}`,
      divisionCode: row.divisionCode,
      divisionDescription: row.divisionDescription,
      divisionDisplayLabel: `${row.divisionCode} · ${row.divisionDescription}`,
      sageMapped: false,
    })
  }

  return [...catalog.values()].sort((left, right) => {
    const divisionOrder = left.divisionCode.localeCompare(right.divisionCode)
    return divisionOrder || left.displayLabel.localeCompare(right.displayLabel)
  })
}
