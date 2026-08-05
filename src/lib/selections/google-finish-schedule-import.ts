export type FinishScheduleSheet = {
  readonly sheetId: number
  readonly title: string
  readonly index: number
  readonly values: ReadonlyArray<ReadonlyArray<unknown>>
}

export type FinishScheduleRoom = {
  readonly sheetId: number
  readonly sheetName: string
  readonly roomName: string
  readonly roomType: string | null
  readonly sortOrder: number
}

export type FinishScheduleSelection = {
  readonly sourceRowNumber: number
  readonly sheetId: number
  readonly sheetName: string
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
}

export type ParsedFinishSchedule = {
  readonly projectNumber: string | null
  readonly rooms: readonly FinishScheduleRoom[]
  readonly selections: readonly FinishScheduleSelection[]
  readonly warnings: readonly string[]
}

function text(value: unknown): string | null {
  if (typeof value === "string") {
    const cleaned = value.trim()
    return cleaned.length > 0 ? cleaned : null
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return null
}

function normalizedLabel(value: unknown): string {
  return text(value)?.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() ?? ""
}

function quantity(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  const cleaned = text(value)?.replace(/,/g, "")
  if (!cleaned) return null
  const match = /^-?\d+(?:\.\d+)?/.exec(cleaned)
  if (!match) return null
  const parsed = Number(match[0])
  return Number.isFinite(parsed) ? parsed : null
}

function isHeaderRow(row: ReadonlyArray<unknown>): boolean {
  return normalizedLabel(row[0]) === "name" &&
    normalizedLabel(row[1]).includes("description")
}

function isCategoryRow(row: ReadonlyArray<unknown>): boolean {
  const first = text(row[0])
  if (!first || first.length > 100) return false
  if (row.slice(1).some((value) => text(value) !== null)) return false
  if (!/[A-Z]/.test(first)) return false
  return first === first.toUpperCase()
}

function projectNumberFromCoverPage(
  rows: ReadonlyArray<ReadonlyArray<unknown>>
): string | null {
  for (const row of rows) {
    for (let index = 0; index < row.length; index += 1) {
      const label = normalizedLabel(row[index])
      if (!["project number", "project no", "job number", "job no"].includes(label)) {
        continue
      }
      const adjacent = text(row[index + 1])
      if (adjacent) return adjacent
    }
  }

  for (const row of rows.slice(0, 20)) {
    for (const value of row) {
      const candidate = text(value)
      if (candidate && /^[A-Z]-\d{2,4}(?:-\d{1,6})?$/i.test(candidate)) {
        return candidate
      }
    }
  }
  return null
}

function roomTypesFromCoverPage(
  rows: ReadonlyArray<ReadonlyArray<unknown>>
): ReadonlyMap<string, string> {
  const result = new Map<string, string>()
  let roomColumn = -1
  let typeColumn = -1
  let headerRow = -1

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? []
    for (let column = 0; column < row.length; column += 1) {
      const label = normalizedLabel(row[column])
      if (["room", "room name", "area"].includes(label)) roomColumn = column
      if (["type", "room type", "area type"].includes(label)) typeColumn = column
    }
    if (roomColumn >= 0 && typeColumn >= 0) {
      headerRow = rowIndex
      break
    }
    roomColumn = -1
    typeColumn = -1
  }

  if (headerRow < 0) return result
  for (const row of rows.slice(headerRow + 1)) {
    const roomName = text(row[roomColumn])
    const roomType = text(row[typeColumn])
    if (roomName && roomType) result.set(roomName.toLowerCase(), roomType)
  }
  return result
}

export function normalizeProjectNumber(value: string | null): string | null {
  const normalized = value?.toUpperCase().replace(/[^A-Z0-9]/g, "") ?? ""
  return normalized.length > 0 ? normalized : null
}

export function parseFinishScheduleWorkbook(input: {
  readonly coverPageRows: ReadonlyArray<ReadonlyArray<unknown>>
  readonly roomSheets: readonly FinishScheduleSheet[]
}): ParsedFinishSchedule {
  const warnings: string[] = []
  const projectNumber = projectNumberFromCoverPage(input.coverPageRows)
  const roomTypes = roomTypesFromCoverPage(input.coverPageRows)
  const rooms: FinishScheduleRoom[] = []
  const selections: FinishScheduleSelection[] = []

  for (const sheet of [...input.roomSheets].sort((left, right) => left.index - right.index)) {
    const roomName = sheet.title.trim()
    if (!roomName) continue
    const roomType = roomTypes.get(roomName.toLowerCase()) ?? null
    rooms.push({
      sheetId: sheet.sheetId,
      sheetName: sheet.title,
      roomName,
      roomType,
      sortOrder: sheet.index,
    })

    let category = "Uncategorized"
    let selectionSortOrder = 0
    for (let rowIndex = 0; rowIndex < sheet.values.length; rowIndex += 1) {
      const row = sheet.values[rowIndex] ?? []
      if (isHeaderRow(row)) continue
      if (isCategoryRow(row)) {
        category = text(row[0]) ?? category
        continue
      }
      const name = text(row[0])
      if (!name) continue
      selectionSortOrder += 1
      selections.push({
        sourceRowNumber: rowIndex + 1,
        sheetId: sheet.sheetId,
        sheetName: sheet.title,
        roomName,
        roomType,
        category,
        name,
        description: text(row[1]),
        quantity: quantity(row[2]),
        manufacturer: text(row[3]),
        model: text(row[4]),
        colorFinish: text(row[5]),
        notes: text(row[6]),
        sortOrder: selectionSortOrder,
      })
    }
    if (selectionSortOrder === 0) {
      warnings.push(`${sheet.title} contains no importable selection rows.`)
    }
  }

  if (!projectNumber) warnings.push("The workbook cover page has no project number.")
  if (rooms.length === 0) warnings.push("The workbook has no visible room sheets.")
  return { projectNumber, rooms, selections, warnings }
}
