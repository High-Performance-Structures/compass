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

export type SageCatalogIndex = {
  readonly byCode: ReadonlyMap<string, SageCatalogEntry>
  readonly byName: ReadonlyMap<string, SageCatalogEntry>
  readonly byRecordNumber: ReadonlyMap<string, SageCatalogEntry>
}

/** Index the Sage-backed catalog rows; Compass-only fallback rows never map. */
export function indexSageCatalog(catalog: readonly SageCatalogEntry[]): SageCatalogIndex {
  const byCode = new Map<string, SageCatalogEntry>()
  const byName = new Map<string, SageCatalogEntry>()
  const byRecordNumber = new Map<string, SageCatalogEntry>()
  for (const entry of catalog) {
    if (!entry.sageMapped) continue
    if (!byCode.has(entry.code)) byCode.set(entry.code, entry)
    for (const name of [entry.description, entry.code, entry.sourceCostCode]) {
      const key = normalized(name)
      if (key && !byName.has(key)) byName.set(key, entry)
    }
    if (isSageRecordNumber(entry.sourceCostCode)) byRecordNumber.set(entry.sourceCostCode.trim(), entry)
  }
  return { byCode, byName, byRecordNumber }
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
    sageRecordNumber: isSageRecordNumber(entry.sourceCostCode) ? entry.sourceCostCode.trim() : null,
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
  const entry = index.byRecordNumber.get(line.costCode.trim())
  if (entry) return compassLineKey(entry.code)
  return `name:${normalized(line.description)}`
}
