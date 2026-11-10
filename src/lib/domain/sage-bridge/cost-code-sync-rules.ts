/**
 * Pure rules for keeping Compass's cost code catalog (sage_cost_codes) the
 * same as Sage 100 Contractor's cost code list (dbo.cstcde). No database or
 * network access here; the cost code results route reads the current rows,
 * asks `planSageCostCodeSync` what to change, and writes it through
 * cost-code-store.ts.
 *
 * The CSI code always comes from Sage's record number, never from the name:
 * the record number padded to eight digits AABBCCDD reads "AA BB CC.DD", and
 * ".DD" is dropped when it is "00" (9300115 is "09 30 01.15", 9290000 is
 * "09 29 00"). Sage names are being renamed to "<code> - <name>", so the name
 * is stored without that leading code, whether or not it has been renamed.
 *
 * Record numbers that are not CSI codes stay out of the catalog: 1-43
 * (Division 00 procurement items and builder fees, numbered in sequence),
 * 500-514 (company internal) and 900000000 and up (contract line items).
 * Compass still offers Division 00 and the builder fees from its own
 * catalog workbook, so those keep resolving.
 */

/** source_system of a catalog row read from Sage by this sync. */
export const SAGE_COST_CODE_SOURCE = "sage"
/** sync_status of a row Sage has; a row Sage no longer has is "not_in_sage". */
export const SAGE_COST_CODE_SYNCED = "synced"
export const SAGE_COST_CODE_NOT_IN_SAGE = "not_in_sage"

/**
 * A read that returns fewer rows than this share of the active synced rows is
 * treated as a partial read and refused, so a bad Sage read can never mark
 * most of the catalog inactive.
 */
const SAGE_COST_CODE_MIN_SHARE = 0.8

/** One cost code row as Sage has it: dbo.cstcde recnum and cdenme. */
export type SageCostCodeRecord = {
  readonly recordNumber: string
  readonly name: string
}

/** The catalog columns the sync owns, for one Sage cost code. */
export type SageCostCodeCatalogValues = {
  readonly sourceRecordId: string
  readonly code: string
  readonly description: string
  readonly displayLabel: string
  readonly divisionCode: string
  readonly divisionDescription: string
  readonly divisionDisplayLabel: string
}

/** A current sage_cost_codes row, as the sync compares it. */
export type ExistingSageCostCode = Omit<SageCostCodeCatalogValues, "sourceRecordId"> & {
  readonly id: string
  readonly sourceSystem: string
  readonly sourceRecordId: string | null
  readonly sourceRecordNumber: string | null
  readonly active: boolean
  readonly syncStatus: string
}

export type SageCostCodeSyncPlan = {
  readonly inserts: readonly (SageCostCodeCatalogValues & { readonly id: string })[]
  /** Existing rows (by id) that take Sage's current values and become active. */
  readonly updates: readonly (SageCostCodeCatalogValues & { readonly id: string })[]
  /** Existing active rows Sage doesn't have: marked inactive, never deleted. */
  readonly inactivations: readonly { readonly id: string; readonly code: string }[]
  /** Rows Sage has that already match: nothing is written for them. */
  readonly unchanged: number
  /** Sage rows left out because their record number isn't a CSI code. */
  readonly skipped: number
  /** Names whose leading code differs from the record number's code. */
  readonly warnings: readonly string[]
}

export type SageCostCodeSyncResult =
  | { readonly success: true; readonly plan: SageCostCodeSyncPlan }
  | { readonly success: false; readonly error: string }

const RECORD_NUMBER = /^\d{1,9}(?:\.0+)?$/
// A leading CSI code on a Sage name: "09 30 01.15 - Name", "09 30 01.15 Name"
// or the code alone. Dashes may be hyphen, en dash or em dash.
const LEADING_CODE = /^\s*(\d{2}) (\d{2}) (\d{2})(\.\d{2})?(?:\s*[-–—]\s*|\s+|$)/

/** Sage's record number as a plain integer string ("9300115" from "9300115.0"), or null. */
function sageCostCodeRecordNumber(value: string): string | null {
  const trimmed = value.trim()
  if (!RECORD_NUMBER.test(trimmed)) return null
  return String(Number(trimmed.split(".")[0]))
}

/** Whether a Sage record number is a CSI cost code that belongs in the catalog. */
export function isCatalogSageCostCode(recordNumber: string): boolean {
  const normalized = sageCostCodeRecordNumber(recordNumber)
  if (normalized === null) return false
  const number = Number(normalized)
  if (number <= 43) return false
  if (number >= 500 && number <= 514) return false
  if (number >= 900_000_000) return false
  // A CSI code has a two-digit division; anything shorter than AA000000 isn't one.
  return number >= 1_000_000 && number <= 99_999_999
}

/** "09 30 01.15" from 9300115; "09 29 00" from 9290000. Null when not a catalog code. */
export function csiCodeFromSageRecordNumber(recordNumber: string): string | null {
  if (!isCatalogSageCostCode(recordNumber)) return null
  const normalized = sageCostCodeRecordNumber(recordNumber)
  if (normalized === null) return null
  const digits = normalized.padStart(8, "0")
  const code = `${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 6)}`
  const detail = digits.slice(6, 8)
  return detail === "00" ? code : `${code}.${detail}`
}

/** The CSI code a Sage name starts with, or null for a bare name. */
function leadingCsiCode(name: string): string | null {
  const match = LEADING_CODE.exec(name)
  if (!match) return null
  return `${match[1]} ${match[2]} ${match[3]}${match[4] ?? ""}`
}

/** A Sage name without its leading "<code> - " or "<code> " ("Fox-S800" stays "Fox-S800"). */
export function sageCostCodeNameWithoutCode(name: string): string {
  const collapsed = name.trim().replaceAll(/\s+/g, " ")
  const match = LEADING_CODE.exec(collapsed)
  if (!match) return collapsed
  const rest = collapsed.slice(match[0].length).trim()
  return rest || collapsed
}

/** "Woods, Plastics & Composites" from "WOODS, PLASTICS & COMPOSITES"; mixed case is kept. */
function readableDivisionName(name: string): string {
  if (name !== name.toUpperCase()) return name
  return name
    .toLowerCase()
    .replaceAll(/(^|[\s/(-])([a-z])/g, (_match, lead: string, letter: string) => `${lead}${letter.toUpperCase()}`)
    .replaceAll(/\b(And|Of|The|For|In|To)\b/g, (word: string) => word.toLowerCase())
    .replace(/^./, (first) => first.toUpperCase())
}

export type SageCostCodeMappingInput = {
  readonly record: SageCostCodeRecord
  /** Sage's own name for each division, by two-digit code (from AA000000). */
  readonly sageDivisionNames: ReadonlyMap<string, string>
  /** The division names Compass already shows, by code; kept so labels don't change. */
  readonly compassDivisionNames: ReadonlyMap<string, string>
}

/** The catalog values for one Sage cost code, or null when it stays out of the catalog. */
export function mapSageCostCode(input: SageCostCodeMappingInput): SageCostCodeCatalogValues | null {
  const recordNumber = sageCostCodeRecordNumber(input.record.recordNumber)
  const code = recordNumber === null ? null : csiCodeFromSageRecordNumber(recordNumber)
  if (recordNumber === null || code === null) return null
  const description = sageCostCodeNameWithoutCode(input.record.name) || code
  const divisionCode = code.slice(0, 2)
  const divisionDescription =
    input.compassDivisionNames.get(divisionCode) ??
    readableDivisionName(input.sageDivisionNames.get(divisionCode) ?? `Division ${divisionCode}`)
  return {
    sourceRecordId: recordNumber,
    code,
    description,
    displayLabel: `${code} ${description}`,
    divisionCode,
    divisionDescription,
    divisionDisplayLabel: `${divisionCode} 00 00 ${divisionDescription}`,
  }
}

/** Sage's division names (the AA000000 rows), without their leading code. */
function sageDivisionNames(records: readonly SageCostCodeRecord[]): ReadonlyMap<string, string> {
  const names = new Map<string, string>()
  for (const record of records) {
    const code = csiCodeFromSageRecordNumber(record.recordNumber)
    if (code === null || !code.endsWith(" 00 00")) continue
    names.set(code.slice(0, 2), sageCostCodeNameWithoutCode(record.name))
  }
  return names
}

/** New rows get a stable id from the Sage record number. */
function sageCostCodeRowId(recordNumber: string): string {
  return `sage-cost-code-r${recordNumber}`
}

function sameValues(existing: ExistingSageCostCode, next: SageCostCodeCatalogValues): boolean {
  return (
    existing.sourceSystem === SAGE_COST_CODE_SOURCE &&
    existing.sourceRecordId === next.sourceRecordId &&
    existing.sourceRecordNumber === next.sourceRecordId &&
    existing.code === next.code &&
    existing.description === next.description &&
    existing.displayLabel === next.displayLabel &&
    existing.divisionCode === next.divisionCode &&
    existing.divisionDescription === next.divisionDescription &&
    existing.divisionDisplayLabel === next.divisionDisplayLabel &&
    existing.active &&
    existing.syncStatus === SAGE_COST_CODE_SYNCED
  )
}

/**
 * What the sync changes, given Sage's complete cost code list and Compass's
 * current rows. A row is matched by Sage record number first, then by code
 * (the spreadsheet-imported rows have no record number), and is updated in
 * place so its id never changes. Rows Sage doesn't have become inactive.
 */
export function planSageCostCodeSync(input: {
  readonly records: readonly SageCostCodeRecord[]
  readonly existing: readonly ExistingSageCostCode[]
  /** Division names Compass already uses elsewhere (its catalog workbook), by code. */
  readonly divisionNames?: ReadonlyMap<string, string>
}): SageCostCodeSyncResult {
  const seen = new Set<string>()
  for (const record of input.records) {
    const recordNumber = sageCostCodeRecordNumber(record.recordNumber)
    if (recordNumber === null) return { success: false, error: `Sage record number "${record.recordNumber}" isn't a number.` }
    if (seen.has(recordNumber)) return { success: false, error: `Sage record number ${recordNumber} appears twice.` }
    seen.add(recordNumber)
  }

  // Existing rows' names win, then the workbook's, so division headings never change.
  const compassDivisionNames = new Map<string, string>(input.divisionNames ?? [])
  for (const row of input.existing) {
    if (row.divisionDescription.trim()) {
      compassDivisionNames.set(row.divisionCode, row.divisionDescription.trim())
    }
  }
  const divisions = sageDivisionNames(input.records)
  const mapped: SageCostCodeCatalogValues[] = []
  const warnings: string[] = []
  let skipped = 0
  for (const record of input.records) {
    const values = mapSageCostCode({ record, sageDivisionNames: divisions, compassDivisionNames })
    if (!values) {
      skipped += 1
      continue
    }
    const named = leadingCsiCode(record.name)
    if (named !== null && named !== values.code) {
      warnings.push(`Sage cost code ${values.sourceRecordId} is named "${record.name.trim()}" but its record number reads ${values.code}.`)
    }
    mapped.push(values)
  }

  const activeSynced = input.existing.filter((row) => row.active && row.sourceSystem === SAGE_COST_CODE_SOURCE).length
  if (mapped.length === 0 || mapped.length < Math.floor(activeSynced * SAGE_COST_CODE_MIN_SHARE)) {
    return {
      success: false,
      error: `Sage returned ${mapped.length} catalog cost codes but Compass has ${activeSynced} from Sage; the read looks incomplete, so nothing was changed.`,
    }
  }

  // Prefer active rows, then the oldest id, when several share a code.
  const ordered = [...input.existing].sort((left, right) => Number(right.active) - Number(left.active) || left.id.localeCompare(right.id))
  const byRecord = new Map<string, ExistingSageCostCode>()
  const byCode = new Map<string, ExistingSageCostCode>()
  for (const row of ordered) {
    if (row.sourceSystem === SAGE_COST_CODE_SOURCE && row.sourceRecordId && !byRecord.has(row.sourceRecordId)) {
      byRecord.set(row.sourceRecordId, row)
    }
    if (!byCode.has(row.code)) byCode.set(row.code, row)
  }

  const claimed = new Set<string>()
  const inserts: (SageCostCodeCatalogValues & { readonly id: string })[] = []
  const updates: (SageCostCodeCatalogValues & { readonly id: string })[] = []
  let unchanged = 0
  const pending: SageCostCodeCatalogValues[] = []
  // Record-number matches first, so a code match never takes a row another record owns.
  for (const values of mapped) {
    const row = byRecord.get(values.sourceRecordId)
    if (row && !claimed.has(row.id)) {
      claimed.add(row.id)
      if (sameValues(row, values)) unchanged += 1
      else updates.push({ ...values, id: row.id })
    } else {
      pending.push(values)
    }
  }
  for (const values of pending) {
    const row = byCode.get(values.code)
    // A row owned by a different Sage record is never taken over by code.
    const ownedElsewhere = row?.sourceSystem === SAGE_COST_CODE_SOURCE && row.sourceRecordId !== null && row.sourceRecordId !== values.sourceRecordId
    if (row && !claimed.has(row.id) && !ownedElsewhere) {
      claimed.add(row.id)
      if (sameValues(row, values)) unchanged += 1
      else updates.push({ ...values, id: row.id })
    } else {
      inserts.push({ ...values, id: sageCostCodeRowId(values.sourceRecordId) })
    }
  }
  const inactivations = input.existing
    .filter((row) => !claimed.has(row.id) && (row.active || row.syncStatus !== SAGE_COST_CODE_NOT_IN_SAGE))
    .map((row) => ({ id: row.id, code: row.code }))

  return { success: true, plan: { inserts, updates, inactivations, unchanged, skipped, warnings } }
}
