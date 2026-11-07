import { canonicalFeeCostCode, isBuilderFeeCostCode } from "@/lib/domain/financials/builder-fee-codes"

/*
 * Which Sage 100 Contractor cost code a Compass cost code goes to. Pure, so
 * the Sage export preview and its tests share it.
 *
 * - CSI codes ("01 31 00") map by the Sage cost code name's prefix
 *   ("01 31 00 - Project Management & Coordination").
 * - Builder fees map by name ("Company Overhead"), whichever spelling the
 *   Compass line used ("99 10 00" or the name).
 * - Anything else maps only when the catalog has a Sage entry with that exact
 *   name; otherwise it is flagged unmapped. Nothing is guessed.
 */

/** A row of the company's cost code catalog, as the export needs it. */
export type SageCatalogEntry = {
  /** Compass code: "01 31 00", or a name such as "Company Overhead". */
  readonly code: string
  /** The Sage record number, or the Sage cost code's full name when only the name is known. */
  readonly sourceCostCode: string
  readonly description: string
  /** False for Compass fallback codes that have no Sage cost code. */
  readonly sageMapped: boolean
}

export type SageCostCodeMapping =
  | {
      readonly status: "mapped"
      readonly by: "csi_prefix" | "fee_name" | "name"
      /** The Sage cost code's name, as staff find it in Sage. */
      readonly sageName: string
      /** Sage's cost code record number when Compass has read it; null when only the name is known. */
      readonly sageRecordNumber: string | null
    }
  | { readonly status: "unmapped"; readonly reason: string }

const CSI_PREFIX = /^\s*(\d{2})\s+(\d{2})\s+(\d{2})(\.\d{2})?(?=\s|$|[-–—])/
const SAGE_RECORD_NUMBER = /^\d+(\.\d+)?$/

function normalized(value: string): string {
  return value.trim().replaceAll(/\s+/g, " ").toLowerCase()
}

/** "01 31 00" from "01 31 00 - Project Management", or null. */
function csiCodePrefix(value: string): string | null {
  const match = CSI_PREFIX.exec(value)
  if (!match) return null
  return `${match[1]} ${match[2]} ${match[3]}${match[4] ?? ""}`
}

function isSageRecordNumber(value: string): boolean {
  return SAGE_RECORD_NUMBER.test(value.trim())
}

/** "35" from "35", "35.0" or " 035 ", so Sage's record numbers compare however they were stored. */
export function normalizedSageRecordNumber(value: string): string | null {
  const trimmed = value.trim()
  return isSageRecordNumber(trimmed) ? String(Number(trimmed)) : null
}

export type SageCatalogIndex = {
  readonly byCode: ReadonlyMap<string, SageCatalogEntry>
  readonly byName: ReadonlyMap<string, SageCatalogEntry>
  readonly byRecordNumber: ReadonlyMap<string, SageCatalogEntry>
  /**
   * Sage record numbers by cost code name (normalized name, CSI code or
   * canonical fee name), from every Sage-read catalog row. A name can belong
   * to more than one record.
   */
  readonly recordNumbersByName: ReadonlyMap<string, ReadonlySet<string>>
}

/** The names a catalog row answers to, for finding its record number. */
function catalogNames(entry: SageCatalogEntry): readonly string[] {
  const names = new Set<string>()
  for (const text of [entry.code, entry.description, entry.sourceCostCode]) {
    if (!text.trim() || isSageRecordNumber(text)) continue
    names.add(normalized(canonicalFeeCostCode(text.trim())))
    const csi = csiCodePrefix(text)
    if (csi) names.add(csi)
  }
  return [...names]
}

/** Index the Sage-backed catalog rows; Compass-only fallback rows never map. */
export function indexSageCatalog(catalog: readonly SageCatalogEntry[]): SageCatalogIndex {
  const byCode = new Map<string, SageCatalogEntry>()
  const byName = new Map<string, SageCatalogEntry>()
  const byRecordNumber = new Map<string, SageCatalogEntry>()
  const recordNumbersByName = new Map<string, Set<string>>()
  for (const entry of catalog) {
    if (!entry.sageMapped) continue
    if (!byCode.has(entry.code)) byCode.set(entry.code, entry)
    for (const name of [entry.description, entry.code, entry.sourceCostCode]) {
      const key = normalized(name)
      if (key && !byName.has(key)) byName.set(key, entry)
    }
    const recordNumber = normalizedSageRecordNumber(entry.sourceCostCode) ?? normalizedSageRecordNumber(entry.code)
    if (!recordNumber) continue
    if (!byRecordNumber.has(recordNumber)) byRecordNumber.set(recordNumber, entry)
    for (const name of catalogNames(entry)) {
      const numbers = recordNumbersByName.get(name) ?? new Set<string>()
      numbers.add(recordNumber)
      recordNumbersByName.set(name, numbers)
    }
  }
  return { byCode, byName, byRecordNumber, recordNumbersByName }
}

function sageNameOf(entry: SageCatalogEntry): string {
  if (!isSageRecordNumber(entry.sourceCostCode)) return entry.sourceCostCode
  return entry.code === entry.description ? entry.description : `${entry.code} - ${entry.description}`
}

function mapped(entry: SageCatalogEntry, by: "csi_prefix" | "fee_name" | "name"): SageCostCodeMapping {
  return {
    status: "mapped",
    by,
    sageName: sageNameOf(entry),
    sageRecordNumber: normalizedSageRecordNumber(entry.sourceCostCode),
  }
}

/** The Sage cost code a Compass cost code goes to, or why it can't be mapped. */
export function mapToSageCostCode(costCode: string, index: SageCatalogIndex): SageCostCodeMapping {
  const code = costCode.trim()
  if (!code) return { status: "unmapped", reason: "The line has no cost code." }
  const canonical = canonicalFeeCostCode(code)
  if (isBuilderFeeCostCode(canonical)) {
    const entry = index.byName.get(normalized(canonical))
    return entry ? mapped(entry, "fee_name") : { status: "unmapped", reason: `No Sage cost code is named "${canonical}".` }
  }
  const csi = csiCodePrefix(code)
  if (csi) {
    const entry = index.byCode.get(csi)
    return entry ? mapped(entry, "csi_prefix") : { status: "unmapped", reason: `No Sage cost code name starts with "${csi}".` }
  }
  const entry = index.byName.get(normalized(code))
  return entry ? mapped(entry, "name") : { status: "unmapped", reason: `No Sage cost code is named "${code}".` }
}

/**
 * One key per cost code, the same for a Compass line and a Sage progress
 * billing line: the CSI code, the canonical builder fee name, or the name.
 */
export function compassLineKey(costCode: string): string {
  const canonical = canonicalFeeCostCode(costCode.trim())
  if (isBuilderFeeCostCode(canonical)) return canonical
  return csiCodePrefix(canonical) ?? `name:${normalized(canonical)}`
}

/**
 * The key for a line of Sage's own progress billing, whose cost code is
 * Sage's record number and whose description is usually the Sage name.
 */
export function sageLineKey(line: { readonly costCode: string; readonly description: string }, index: SageCatalogIndex): string {
  for (const text of [line.description, line.costCode]) {
    const canonical = canonicalFeeCostCode(text.trim())
    if (isBuilderFeeCostCode(canonical)) return canonical
    const csi = csiCodePrefix(text)
    if (csi) return csi
  }
  const recordNumber = normalizedSageRecordNumber(line.costCode)
  const entry = recordNumber ? index.byRecordNumber.get(recordNumber) : undefined
  if (entry) return compassLineKey(isSageRecordNumber(entry.code) ? entry.description : entry.code)
  return `name:${normalized(line.description)}`
}

/**
 * Every Sage cost code record a Compass cost code resolves to through the
 * catalog: the record it maps to, plus any Sage-read row with the same name,
 * CSI code or builder fee. Empty when Compass doesn't know the record number.
 */
export function sageRecordNumbersFor(costCode: string, mapping: SageCostCodeMapping, index: SageCatalogIndex): ReadonlySet<string> {
  const numbers = new Set<string>()
  if (mapping.status === "mapped" && mapping.sageRecordNumber) numbers.add(mapping.sageRecordNumber)
  const code = canonicalFeeCostCode(costCode.trim())
  const names = [normalized(code), csiCodePrefix(code)].filter((name): name is string => Boolean(name))
  for (const name of names) for (const number of index.recordNumbersByName.get(name) ?? []) numbers.add(number)
  return numbers
}
