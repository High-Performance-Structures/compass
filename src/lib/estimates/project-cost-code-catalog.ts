import { SAGE_COST_CODE_SOURCE } from "@/lib/domain/sage-bridge/cost-code-sync-rules"
import { BUILDER_FEE_NAMES, canonicalFeeLabel, isLegacyFeeCostCode } from "@/lib/domain/financials/builder-fee-codes"
import { CSI_PROJECT_TOTALS_FALLBACK_COST_CODES } from "@/lib/estimates/csi-project-totals-catalog"
import {
  SAGE_ESTIMATE_COST_CODE_CATALOG,
  type SageEstimateCatalogRow,
} from "@/lib/estimates/sage-estimate-cost-code-catalog"

export type EstimateSageCostCode = {
  /** "sage" for rows read from Sage by the cost code sync; older rows came from a spreadsheet. */
  readonly sourceSystem: string
  /** Sage's cost code record number for synced rows. */
  readonly sourceRecordId: string | null
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

const SAGE_RECORD_NUMBER = /^\d+(\.\d+)?$/

/**
 * Sage record numbers read from Sage, by the code they belong to: the CSI
 * code in the Sage name ("03 31 00 - Structural Concrete") or the builder
 * fee's canonical name ("Contingency" is "Contingency Reserve"). A code Sage
 * files under more than one record is left out; nothing is guessed.
 */
function sageRecordNumbersByCode(namedSageRows: readonly EstimateSageNamedCostCode[]): ReadonlyMap<string, string> {
  const numbers = new Map<string, Set<string>>()
  for (const row of namedSageRows) {
    const recordNumber = row.costCode.trim()
    if (!row.sourceSystem.toLowerCase().startsWith("sage") || !SAGE_RECORD_NUMBER.test(recordNumber)) continue
    const match = CSI_CODE_FROM_NAME.exec(row.description)
    const fee = canonicalFeeLabel(row.description.trim())
    const code =
      match?.[1] && match[2] && match[3]
        ? `${match[1]} ${match[2]} ${match[3]}${match[4] ?? ""}`
        : BUILDER_FEE_NAMES.includes(fee)
          ? fee
          : null
    if (!code) continue
    const set = numbers.get(code) ?? new Set<string>()
    set.add(String(Number(recordNumber)))
    numbers.set(code, set)
  }
  const single = new Map<string, string>()
  for (const [code, set] of numbers) {
    const [only] = set
    if (set.size === 1 && only) single.set(code, only)
  }
  return single
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

function syncedRecordNumber(row: EstimateSageCostCode): string | null {
  const recordNumber = row.sourceRecordId?.trim() ?? ""
  return row.sourceSystem === SAGE_COST_CODE_SOURCE && /^\d+$/.test(recordNumber) ? recordNumber : null
}

function namedKey(divisionCode: string, name: string): string {
  return `${divisionCode}|${name.trim().replaceAll(/\s+/g, " ").toLowerCase()}`
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

  // Bare Sage names ("Fox-S800") by division, for the synced rows: the
  // workbook's named codes keep resolving and take the exact Sage record.
  const syncedRecordsByName = new Map<string, Set<string>>()
  for (const row of sageRows) {
    const recordNumber = syncedRecordNumber(row)
    if (recordNumber) {
      const key = namedKey(row.divisionCode, row.description)
      const set = syncedRecordsByName.get(key) ?? new Set<string>()
      set.add(recordNumber)
      syncedRecordsByName.set(key, set)
    } else {
      // A spreadsheet-imported row replaces the workbook entry it came from.
      for (const [code, item] of catalog) {
        if (
          item.sourceCostCode === row.description &&
          item.divisionCode === row.divisionCode
        ) {
          catalog.delete(code)
        }
      }
    }
    catalog.set(row.code, {
      code: row.code,
      sourceCostCode: recordNumber ?? row.code,
      description: row.description,
      displayLabel: row.displayLabel,
      divisionCode: row.divisionCode,
      divisionDescription: row.divisionDescription,
      divisionDisplayLabel: row.divisionDisplayLabel,
      sageMapped: true,
    })
  }

  // A workbook name ("Fox-S800", "ICF Shipping") stays a choice so older
  // records keep resolving, addressed to the one Sage record with that name.
  for (const [code, item] of catalog) {
    if (CSI_CODE_FROM_NAME.test(code) || SAGE_RECORD_NUMBER.test(item.sourceCostCode.trim())) continue
    const records = syncedRecordsByName.get(namedKey(item.divisionCode, item.description))
    const [only] = records ?? []
    if (records?.size === 1 && only) catalog.set(code, { ...item, sourceCostCode: only })
  }

  for (const row of namedSageRows) {
    const namedCode = sageCodeFromName(row)
    if (!namedCode || catalog.has(namedCode.code)) continue
    catalog.set(namedCode.code, namedCode)
  }

  // A code the Sage catalog or workbook names, but without the record number
  // Sage files it under, takes the number Sage's own job data shows, so the
  // Sage handoff can address it.
  for (const [code, recordNumber] of sageRecordNumbersByCode(namedSageRows)) {
    const item = catalog.get(code)
    if (item && !SAGE_RECORD_NUMBER.test(item.sourceCostCode.trim())) catalog.set(code, { ...item, sourceCostCode: recordNumber })
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

  // The retired Division 99 fee codes are never offered; builder fees go by
  // their canonical names.
  return [...catalog.values()].filter((row) => !isLegacyFeeCostCode(row.code)).sort((left, right) => {
    const divisionOrder = left.divisionCode.localeCompare(right.divisionCode)
    return divisionOrder || left.displayLabel.localeCompare(right.displayLabel)
  })
}
