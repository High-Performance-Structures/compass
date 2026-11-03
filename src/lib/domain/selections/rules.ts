/**
 * Pure finish-selection rules: statuses, input validation, change detection,
 * the selections summary, the picker options and the finish-schedule import
 * matching. No database or network access.
 */
import type { projectFinishSelectionRooms, projectFinishSelections } from "@/db/schema"
import { PROJECT_SELECTION_STATUSES } from "@/lib/domain/selections/statuses"
import { cleanText } from "@/lib/shared/guards"
import { isListValue } from "@/lib/shared/statuses"
import type { ParsedFinishSchedule } from "@/lib/selections/google-finish-schedule-import"
import { normalizeProjectNumber } from "@/lib/selections/google-finish-schedule-import"

import type {
  ProjectFinishScheduleImportPreview,
  ProjectSelectionCostCodeOption,
  ProjectSelectionItem,
  ProjectSelectionOption,
  ProjectSelectionOptions,
  ProjectSelectionRoom,
  ProjectSelectionsSummary,
  ProjectSelectionStatus,
} from "./types"

type SelectionRow = typeof projectFinishSelections.$inferSelect
type SelectionRoomRow = typeof projectFinishSelectionRooms.$inferSelect


const ROOM_TYPE_OPTIONS: readonly string[] = [
  "Living Area",
  "Kitchen",
  "Dining",
  "Bedroom",
  "Bathroom",
  "Powder Room",
  "Laundry",
  "Mudroom",
  "Pantry",
  "Closet",
  "Office / Study",
  "Library",
  "Loft",
  "Rec Room",
  "Theater Room",
  "Wine Room",
  "Exercise Room",
  "Guest Suite",
  "Bunk Room",
  "Mechanical / Utility",
  "Garage",
  "Exterior",
  "Porch / Deck",
  "Hardscape",
  "Pool / Spa",
  "Sauna / Wellness",
  "Outdoor Kitchen",
  "Other"
]

const MANUFACTURER_OPTIONS: readonly string[] = [
  "Kohler",
  "Delta",
  "Moen",
  "Hansgrohe",
  "Brizo",
  "Rohl",
  "Schlage",
  "Kwikset",
  "Emtek",
  "Sherwin-Williams",
  "Benjamin Moore",
  "Daltile",
  "Marazzi",
  "Shaw",
  "Mohawk",
  "Bruce Hardwood",
  "Andersen Windows",
  "Marvin Windows",
  "James Hardie",
  "Custom (see notes)"
]

// ---- input validation

export function requiredText(value: string | null, label: string): string {
  const cleaned = cleanText(value)
  if (!cleaned) throw new Error(`${label} is required`)
  return cleaned
}

export function isSelectionStatus(value: string): value is ProjectSelectionStatus {
  return isListValue(PROJECT_SELECTION_STATUSES, value)
}

export function normalizeStatus(value: string | null): ProjectSelectionStatus {
  const cleaned = cleanText(value)
  if (cleaned && isSelectionStatus(cleaned)) return cleaned
  return "needed"
}

export function parseQuantity(value: string | null): number | null {
  const cleaned = cleanText(value)
  if (!cleaned) return null
  const parsed = Number(cleaned)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("Quantity must be a positive number.")
  }
  return parsed
}

export function normalizedChoiceOptions(values: readonly string[] | undefined): readonly string[] {
  if (!values) return []
  const unique = new Set<string>()
  for (const value of values) {
    const cleaned = value.trim()
    if (!cleaned) continue
    if (cleaned.length > 200) {
      throw new Error("Template selection choices must be 200 characters or less.")
    }
    unique.add(cleaned)
  }
  if (unique.size > 200) {
    throw new Error("A finish selection may have no more than 200 choices.")
  }
  return [...unique]
}

/** The id of the Compass room row a manually entered room name upserts into. */
export function compassSelectionRoomId(projectId: string, roomName: string): string {
  return `selection-room-${projectId}-${roomName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`
}

export function projectTaskNumberFor(existingCount: number): string {
  return `TASK-${String(existingCount + 1).padStart(3, "0")}`
}

// ---- change detection

export type SelectionFieldChange = {
  readonly field: string
  readonly before: string
  readonly after: string
}

function normalizedNumberText(value: number | null): string {
  return value === null ? "" : String(value)
}

function normalizedText(value: string | null): string {
  return value?.trim() ?? ""
}

export function changedTextField(
  label: string,
  before: string | null,
  after: string | null
): SelectionFieldChange | null {
  const normalizedBefore = normalizedText(before)
  const normalizedAfter = normalizedText(after)
  if (normalizedBefore === normalizedAfter) return null
  return { field: label, before: normalizedBefore, after: normalizedAfter }
}

export function changedNumberField(
  label: string,
  before: number | null,
  after: number | null
): SelectionFieldChange | null {
  const normalizedBefore = normalizedNumberText(before)
  const normalizedAfter = normalizedNumberText(after)
  if (normalizedBefore === normalizedAfter) return null
  return { field: label, before: normalizedBefore, after: normalizedAfter }
}

// ---- read model

function parseChoiceOptions(value: string | null): readonly string[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (option): option is string => typeof option === "string" && option.trim().length > 0
    )
  } catch {
    return []
  }
}

export function toSelectionItem(row: SelectionRow): ProjectSelectionItem {
  const status = isSelectionStatus(row.status) ? row.status : "needed"
  return {
    id: row.id,
    projectId: row.projectId,
    sourceSystem: row.sourceSystem,
    sourceRecordId: row.sourceRecordId,
    sourceWorkbookId: row.sourceWorkbookId,
    sourceSheetName: row.sourceSheetName,
    roomName: row.roomName,
    roomType: row.roomType,
    category: row.category,
    name: row.name,
    description: row.description,
    quantity: row.quantity,
    manufacturer: row.manufacturer,
    model: row.model,
    colorFinish: row.colorFinish,
    choiceOptions: parseChoiceOptions(row.choiceOptionsJson),
    parentSelectionId: row.parentSelectionId,
    parentChoiceValue: row.parentChoiceValue,
    selectionLevel: row.selectionLevel,
    supplierName: row.supplierName,
    productUrl: row.productUrl,
    costCode: row.costCode,
    phaseCode: row.phaseCode,
    status,
    ownerVisible: row.ownerVisible,
    ownerApproved: row.ownerApproved,
    rfqOperationId: row.rfqOperationId,
    purchaseOrderOperationId: row.purchaseOrderOperationId,
    notes: row.notes,
    syncStatus: row.syncStatus,
    updatedAt: row.updatedAt
  }
}

export function summarizeSelections(
  roomRows: readonly SelectionRoomRow[],
  selections: readonly ProjectSelectionItem[]
): ProjectSelectionsSummary {
  const roomMap = new Map<
    string,
    ProjectSelectionRoom & {
      readonly selections: ProjectSelectionItem[]
    }
  >()

  for (const room of roomRows) {
    roomMap.set(room.roomName, {
      id: room.id,
      projectId: room.projectId,
      sourceSystem: room.sourceSystem,
      sourceWorkbookId: room.sourceWorkbookId,
      sourceSheetId: room.sourceSheetId,
      sourceSheetName: room.sourceSheetName,
      roomName: room.roomName,
      roomType: room.roomType,
      sortOrder: room.sortOrder,
      selectionCount: 0,
      selections: []
    })
  }

  for (const selection of selections) {
    const existing = roomMap.get(selection.roomName)
    if (existing) {
      existing.selections.push(selection)
      continue
    }

    roomMap.set(selection.roomName, {
      id: `selection-room-${selection.roomName}`,
      projectId: selection.projectId,
      sourceSystem: selection.sourceSystem,
      sourceWorkbookId: selection.sourceWorkbookId,
      sourceSheetId: null,
      sourceSheetName: selection.sourceSheetName,
      roomName: selection.roomName,
      roomType: selection.roomType,
      sortOrder: roomMap.size + 1_000,
      selectionCount: 0,
      selections: [selection]
    })
  }

  const rooms = Array.from(roomMap.values())
    .map((room) => ({
      ...room,
      selectionCount: room.selections.length
    }))
    .sort((left, right) => {
      if (left.sortOrder !== right.sortOrder) {
        return left.sortOrder - right.sortOrder
      }
      return left.roomName.localeCompare(right.roomName)
    })

  return {
    totalCount: selections.length,
    roomCount: rooms.length,
    sourceWorkbookCount: new Set(
      rooms.map((room) => room.sourceWorkbookId).filter((value): value is string => Boolean(value))
    ).size,
    needsDecisionCount: selections.filter((selection) =>
      ["needed", "proposed", "owner_review", "unavailable"].includes(selection.status)
    ).length,
    approvedCount: selections.filter((selection) => selection.status === "approved").length,
    pricingCount: selections.filter((selection) =>
      ["pricing", "rfq_sent"].includes(selection.status)
    ).length,
    orderedCount: selections.filter((selection) =>
      ["ordered", "installed"].includes(selection.status)
    ).length,
    rooms
  }
}

// ---- picker options

function optionFromLabel(label: string): ProjectSelectionOption {
  return { value: label, label }
}

function uniqueSortedOptions(values: readonly string[]): ProjectSelectionOption[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
    .map(optionFromLabel)
}

function divisionLabel(code: string, description: string): string {
  return code ? `${code} 00 00 ${description}` : description
}

function costCodeLabel(code: string, description: string): string {
  return code ? `${code} ${description}` : description
}

function divisionCodeFromCostCode(code: string): string {
  return code.trim().slice(0, 2)
}

function fallbackDivisionLabel(code: string): string {
  const divisionCode = divisionCodeFromCostCode(code)
  return divisionCode ? `${divisionCode} 00 00 Unmapped` : "Unmapped"
}

function fallbackCostCodeDescription(code: string): string {
  return code ? `CSI workbook cost code ${code}` : "CSI workbook cost code"
}

export type SelectionOptionSources = {
  readonly costCodes: readonly {
    readonly code: string
    readonly description: string
    readonly displayLabel: string
    readonly divisionCode: string
    readonly divisionDisplayLabel: string
    readonly onBudget: boolean
    readonly sageMapped: boolean
  }[]
  readonly contacts: readonly {
    readonly companyName: string | null
    readonly displayName: string | null
    readonly contactType: string | null
    readonly csiDivision: string | null
    readonly csiDivisionName: string | null
  }[]
  readonly selections: readonly {
    readonly manufacturer: string | null
    readonly supplierName: string | null
    readonly costCode: string | null
    readonly category: string | null
  }[]
}

export function buildSelectionOptions(sources: SelectionOptionSources): ProjectSelectionOptions {
  const divisionMap = new Map<string, ProjectSelectionOption>()
  const costCodeMap = new Map<string, ProjectSelectionCostCodeOption>()

  for (const row of sources.costCodes) {
    if (row.divisionCode && row.divisionDisplayLabel) {
      divisionMap.set(row.divisionCode, {
        value: row.divisionCode,
        label: row.divisionDisplayLabel
      })
    }

    costCodeMap.set(row.code, {
      value: row.code,
      onBudget: row.onBudget,
      label: row.displayLabel,
      description: row.description,
      divisionCode: row.divisionCode,
      divisionLabel: row.divisionDisplayLabel,
      source: row.onBudget && !row.sageMapped ? "project_budget" : row.sageMapped ? "sage" : "company",
      needsSageReview: !row.sageMapped
    })
  }

  for (const row of sources.contacts) {
    if (row.csiDivision && row.csiDivisionName) {
      divisionMap.set(row.csiDivision, {
        value: row.csiDivision,
        label: divisionLabel(row.csiDivision, row.csiDivisionName)
      })
    }
  }

  for (const row of sources.selections) {
    if (!row.costCode) continue
    const divisionCode = divisionCodeFromCostCode(row.costCode)
    const existingDivisionLabel =
      divisionMap.get(divisionCode)?.label ?? fallbackDivisionLabel(row.costCode)

    if (!divisionMap.has(divisionCode)) {
      divisionMap.set(divisionCode, {
        value: divisionCode,
        label: existingDivisionLabel
      })
    }

    if (!costCodeMap.has(row.costCode)) {
      const description = row.category
        ? `${row.category} selection`
        : fallbackCostCodeDescription(row.costCode)

      costCodeMap.set(row.costCode, {
        value: row.costCode,
        label: costCodeLabel(row.costCode, description),
        description,
        divisionCode,
        divisionLabel: existingDivisionLabel,
        source: "selection",
        needsSageReview: true
      })
    }
  }

  const manufacturerValues = [
    ...MANUFACTURER_OPTIONS,
    ...sources.contacts
      .filter((row) => row.contactType === "supplier")
      .flatMap((row) => [row.companyName, row.displayName]),
    ...sources.selections.flatMap((row) => [row.manufacturer, row.supplierName])
  ].filter((value): value is string => Boolean(value))

  return {
    roomTypes: ROOM_TYPE_OPTIONS.map(optionFromLabel),
    manufacturers: uniqueSortedOptions(manufacturerValues),
    divisions: Array.from(divisionMap.values()).sort((left, right) =>
      left.label.localeCompare(right.label)
    ),
    costCodes: Array.from(costCodeMap.values()).sort((left, right) =>
      left.label.localeCompare(right.label)
    )
  }
}

// ---- finish-schedule import

export function quotedSheetRange(sheetTitle: string, range: string): string {
  return `'${sheetTitle.replace(/'/g, "''")}'!${range}`
}

export type LoadedFinishSchedule = {
  readonly workbookId: string
  readonly workbookTitle: string
  readonly parsed: ParsedFinishSchedule
}

export function finishSchedulePreview(
  loaded: LoadedFinishSchedule,
  compassProjectNumber: string | null
): ProjectFinishScheduleImportPreview {
  const workbookProjectNumber = loaded.parsed.projectNumber
  const normalizedWorkbook = normalizeProjectNumber(workbookProjectNumber)
  const normalizedCompass = normalizeProjectNumber(compassProjectNumber)
  const projectMatch =
    !normalizedWorkbook || !normalizedCompass
      ? "unknown"
      : normalizedWorkbook === normalizedCompass
        ? "match"
        : "mismatch"
  const warnings = [...loaded.parsed.warnings]
  if (projectMatch === "mismatch") {
    warnings.push(
      `Workbook project ${workbookProjectNumber ?? "unknown"} does not match Compass project ${compassProjectNumber ?? "unknown"}.`
    )
  }
  if (projectMatch === "unknown") {
    warnings.push("The workbook and Compass project numbers could not both be verified.")
  }
  return {
    workbookId: loaded.workbookId,
    workbookTitle: loaded.workbookTitle,
    workbookProjectNumber,
    compassProjectNumber,
    projectMatch,
    roomCount: loaded.parsed.rooms.length,
    selectionCount: loaded.parsed.selections.length,
    warnings
  }
}

export type ImportedSelectionSourceValues = {
  readonly sourceSheetName: string
  readonly roomName: string
  readonly roomType: string | null
  readonly category: string
  readonly name: string
  readonly description: string | null
  readonly quantity: number | null
  readonly manufacturer: string | null
  readonly model: string | null
  readonly colorFinish: string | null
  readonly notes: string | null
  readonly sortOrder: number
  readonly lastSyncedAt: string
  readonly updatedAt: string
}

export function importedSelectionIdentity(input: {
  readonly sourceSheetName: string | null
  readonly category: string
  readonly name: string
}): string {
  return [input.sourceSheetName ?? "", input.category, input.name]
    .map((value) =>
      value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
    )
    .join("|")
}

export function importedSourceChanged(
  existing: SelectionRow,
  incoming: ImportedSelectionSourceValues
): boolean {
  return (
    existing.roomName !== incoming.roomName ||
    existing.roomType !== incoming.roomType ||
    existing.category !== incoming.category ||
    existing.name !== incoming.name ||
    existing.description !== incoming.description ||
    existing.quantity !== incoming.quantity ||
    existing.manufacturer !== incoming.manufacturer ||
    existing.model !== incoming.model ||
    existing.colorFinish !== incoming.colorFinish ||
    existing.notes !== incoming.notes
  )
}

/**
 * Which existing row an incoming workbook row updates, if any. A semantic
 * match at another row indicates an insertion/deletion/reorder. If no such
 * match exists and the old identity disappeared, this row was renamed in place.
 */
export function matchImportedSelection(input: {
  readonly identity: string
  readonly exactMatch: SelectionRow | undefined
  readonly identityMatches: readonly SelectionRow[]
  readonly usedSelectionIds: ReadonlySet<string>
  readonly incomingIdentities: ReadonlySet<string>
}): SelectionRow | null {
  const { exactMatch, usedSelectionIds } = input
  const exactIdentity = exactMatch ? importedSelectionIdentity(exactMatch) : null
  const stableMatch = input.identityMatches.find((candidate) => !usedSelectionIds.has(candidate.id))
  const unusedExactMatch = exactMatch && !usedSelectionIds.has(exactMatch.id) ? exactMatch : null
  return unusedExactMatch && exactIdentity === input.identity
    ? unusedExactMatch
    : (stableMatch ??
        (unusedExactMatch && exactIdentity !== null && !input.incomingIdentities.has(exactIdentity)
          ? unusedExactMatch
          : null))
}
