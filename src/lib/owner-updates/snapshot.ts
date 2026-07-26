import { z } from "zod/v4"

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const scheduleItemSchema = z.object({
  title: z.string().trim().min(1),
  startDate: z.string().regex(ISO_DATE_PATTERN),
  endDate: z.string().regex(ISO_DATE_PATTERN),
  assignedTo: z.string().nullable(),
})

const scheduleSnapshotSchema = z.array(scheduleItemSchema)

export type OwnerUpdateScheduleItem = {
  readonly title: string
  readonly startDate: string
  readonly endDate: string
  readonly assignedTo: string | null
}

type IdentifiedRow = {
  readonly id: string
}

export function parseOwnerUpdateScheduleSnapshot(
  value: string | null
): readonly OwnerUpdateScheduleItem[] {
  if (value === null || value.trim().length === 0) return []

  try {
    const result = scheduleSnapshotSchema.safeParse(JSON.parse(value))
    if (!result.success) return []

    return result.data.map((item) => ({
      title: item.title,
      startDate: item.startDate,
      endDate: item.endDate,
      assignedTo: item.assignedTo,
    }))
  } catch {
    return []
  }
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
