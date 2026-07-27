import { z } from "zod/v4"

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const scheduleItemSchema = z.object({
  title: z.string().trim().min(1),
  startDate: z.string().regex(ISO_DATE_PATTERN),
  endDate: z.string().regex(ISO_DATE_PATTERN),
  assignedTo: z.string().nullable(),
})

const scheduleSnapshotSchema = z.array(scheduleItemSchema)

const scheduleSelectionSchema = scheduleItemSchema.extend({
  id: z.string().trim().min(1),
  status: z.string(),
  percentComplete: z.number().min(0).max(100),
  notes: z.string(),
})

const todoSelectionSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  description: z.string(),
  status: z.string(),
  priority: z.string(),
  assigneeName: z.string().nullable(),
  companyName: z.string().nullable(),
  dueDate: z.string().nullable(),
  timing: z.union([z.literal("reporting_period"), z.literal("upcoming")]),
  notes: z.string(),
})

const documentSelectionSchema = z.object({
  id: z.string().trim().min(1),
  fileName: z.string().trim().min(1),
  mimeType: z.string().nullable(),
  driveFileId: z.string().nullable(),
  driveUrl: z.string().nullable(),
  caption: z.string().nullable(),
  capturedAt: z.string().nullable(),
  sourceSystem: z.string(),
})

const composerSnapshotSchema = z.object({
  version: z.literal(2),
  completedScheduleItems: z.array(scheduleSelectionSchema),
  lookAheadScheduleItems: z.array(scheduleSelectionSchema),
  todos: z.array(todoSelectionSchema),
  documents: z.array(documentSelectionSchema),
})

export type OwnerUpdateScheduleItem = {
  readonly title: string
  readonly startDate: string
  readonly endDate: string
  readonly assignedTo: string | null
}

export type OwnerUpdateScheduleSelection = OwnerUpdateScheduleItem & {
  readonly id: string
  readonly status: string
  readonly percentComplete: number
  readonly notes: string
}

export type OwnerUpdateTodoSelection = {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly status: string
  readonly priority: string
  readonly assigneeName: string | null
  readonly companyName: string | null
  readonly dueDate: string | null
  readonly timing: "reporting_period" | "upcoming"
  readonly notes: string
}

export type OwnerUpdateDocumentSelection = {
  readonly id: string
  readonly fileName: string
  readonly mimeType: string | null
  readonly driveFileId: string | null
  readonly driveUrl: string | null
  readonly caption: string | null
  readonly capturedAt: string | null
  readonly sourceSystem: string
}

export type OwnerUpdateComposerSnapshot = {
  readonly version: 2
  readonly completedScheduleItems: readonly OwnerUpdateScheduleSelection[]
  readonly lookAheadScheduleItems: readonly OwnerUpdateScheduleSelection[]
  readonly todos: readonly OwnerUpdateTodoSelection[]
  readonly documents: readonly OwnerUpdateDocumentSelection[]
}

export function emptyOwnerUpdateComposerSnapshot(): OwnerUpdateComposerSnapshot {
  return {
    version: 2,
    completedScheduleItems: [],
    lookAheadScheduleItems: [],
    todos: [],
    documents: [],
  }
}

export function parseOwnerUpdateComposerSnapshot(
  value: string | null
): OwnerUpdateComposerSnapshot {
  if (value === null || value.trim().length === 0) {
    return emptyOwnerUpdateComposerSnapshot()
  }

  try {
    const parsed: unknown = JSON.parse(value)
    const composerResult = composerSnapshotSchema.safeParse(parsed)
    if (composerResult.success) {
      return {
        version: 2,
        completedScheduleItems: composerResult.data.completedScheduleItems,
        lookAheadScheduleItems: composerResult.data.lookAheadScheduleItems,
        todos: composerResult.data.todos,
        documents: composerResult.data.documents,
      }
    }

    const legacyResult = scheduleSnapshotSchema.safeParse(parsed)
    if (!legacyResult.success) return emptyOwnerUpdateComposerSnapshot()

    return {
      version: 2,
      completedScheduleItems: [],
      lookAheadScheduleItems: legacyResult.data.map((item, index) => ({
        id: `legacy-${index}`,
        title: item.title,
        startDate: item.startDate,
        endDate: item.endDate,
        assignedTo: item.assignedTo,
        status: "PENDING",
        percentComplete: 0,
        notes: "",
      })),
      todos: [],
      documents: [],
    }
  } catch {
    return emptyOwnerUpdateComposerSnapshot()
  }
}

export function serializeOwnerUpdateComposerSnapshot(
  snapshot: OwnerUpdateComposerSnapshot
): string {
  return JSON.stringify(snapshot)
}

type IdentifiedRow = {
  readonly id: string
}

export function parseOwnerUpdateScheduleSnapshot(
  value: string | null
): readonly OwnerUpdateScheduleItem[] {
  return parseOwnerUpdateComposerSnapshot(value).lookAheadScheduleItems.map(
    (item) => ({
      title: item.title,
      startDate: item.startDate,
      endDate: item.endDate,
      assignedTo: item.assignedTo,
    })
  )
}

export function serializeOwnerUpdateScheduleSnapshot(
  items: readonly OwnerUpdateScheduleItem[]
): string {
  return JSON.stringify(items)
}

export function selectRowsByIdOrder<T extends IdentifiedRow>(
  rows: readonly T[],
  selectedIds: readonly string[]
): readonly T[] {
  const rowsById = new Map(rows.map((row) => [row.id, row]))

  return selectedIds.flatMap((id) => {
    const row = rowsById.get(id)
    return row === undefined ? [] : [row]
  })
}

export function dateRangeFromDates(
  values: readonly string[]
): { readonly startDate: string; readonly endDate: string } | null {
  const dates = values
    .filter((value) => ISO_DATE_PATTERN.test(value))
    .toSorted((left, right) => left.localeCompare(right))

  const startDate = dates[0]
  const endDate = dates[dates.length - 1]
  if (startDate === undefined || endDate === undefined) return null

  return { startDate, endDate }
}

export function isValidOwnerUpdatePeriod(
  startDate: string,
  endDate: string
): boolean {
  return (
    ISO_DATE_PATTERN.test(startDate) &&
    ISO_DATE_PATTERN.test(endDate) &&
    startDate <= endDate
  )
}

export function isDateWithinOwnerUpdatePeriod(
  date: string,
  startDate: string | null,
  endDate: string | null
): boolean {
  if (startDate !== null && date < startDate) return false
  if (endDate !== null && date > endDate) return false
  return true
}
