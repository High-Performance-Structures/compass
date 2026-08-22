export type EstimateVersionComparisonLine = {
  readonly divisionCode: string
  readonly divisionName: string
  readonly costCode: string
  readonly description: string
  readonly lineTotalCents: number
}

export type EstimateVersionComparisonChange =
  | "added"
  | "removed"
  | "changed"
  | "unchanged"

export type EstimateVersionComparisonRow = {
  readonly key: string
  readonly divisionCode: string
  readonly divisionName: string
  readonly costCode: string
  readonly baseDescription: string | null
  readonly revisedDescription: string | null
  readonly baseTotalCents: number
  readonly revisedTotalCents: number
  readonly deltaCents: number
  readonly change: EstimateVersionComparisonChange
}

export type EstimateVersionComparisonDivision = {
  readonly divisionCode: string
  readonly divisionName: string
  readonly baseTotalCents: number
  readonly revisedTotalCents: number
  readonly deltaCents: number
  readonly rows: readonly EstimateVersionComparisonRow[]
}

export type EstimateVersionComparison = {
  readonly baseTotalCents: number
  readonly revisedTotalCents: number
  readonly deltaCents: number
  readonly changedRowCount: number
  readonly divisions: readonly EstimateVersionComparisonDivision[]
}

type AggregatedLine = {
  readonly divisionCode: string
  readonly divisionName: string
  readonly costCode: string
  readonly descriptions: readonly string[]
  readonly totalCents: number
}

function lineKey(line: EstimateVersionComparisonLine): string {
  return `${line.divisionCode}|${line.costCode}`
}

function aggregateLines(
  lines: readonly EstimateVersionComparisonLine[]
): ReadonlyMap<string, AggregatedLine> {
  const groups = new Map<string, AggregatedLine>()

  for (const line of lines) {
    const key = lineKey(line)
    const prior = groups.get(key)
    const descriptions = new Set(prior?.descriptions ?? [])
    const description = line.description.trim()
    if (description) descriptions.add(description)
    groups.set(key, {
      divisionCode: line.divisionCode,
      divisionName: line.divisionName,
      costCode: line.costCode,
      descriptions: [...descriptions],
      totalCents: (prior?.totalCents ?? 0) + line.lineTotalCents,
    })
  }

  return groups
}

function description(group: AggregatedLine | undefined): string | null {
  if (!group || group.descriptions.length === 0) return null
  return group.descriptions.join(" / ")
}

function rowChange(input: {
  readonly base: AggregatedLine | undefined
  readonly revised: AggregatedLine | undefined
}): EstimateVersionComparisonChange {
  if (!input.base) return "added"
  if (!input.revised) return "removed"
  if (
    input.base.totalCents === input.revised.totalCents &&
    description(input.base) === description(input.revised)
  ) {
    return "unchanged"
  }
  return "changed"
}

export function compareEstimateVersions(input: {
  readonly baseLines: readonly EstimateVersionComparisonLine[]
  readonly revisedLines: readonly EstimateVersionComparisonLine[]
}): EstimateVersionComparison {
  const baseGroups = aggregateLines(input.baseLines)
  const revisedGroups = aggregateLines(input.revisedLines)
  const keys = new Set([...baseGroups.keys(), ...revisedGroups.keys()])
  const rows = [...keys].map((key): EstimateVersionComparisonRow => {
    const base = baseGroups.get(key)
    const revised = revisedGroups.get(key)
    const representative = revised ?? base
    if (!representative) {
      throw new Error("Estimate comparison row is missing its source line.")
    }
    const baseTotalCents = base?.totalCents ?? 0
    const revisedTotalCents = revised?.totalCents ?? 0
    return {
      key,
      divisionCode: representative.divisionCode,
      divisionName: representative.divisionName,
      costCode: representative.costCode,
      baseDescription: description(base),
      revisedDescription: description(revised),
      baseTotalCents,
      revisedTotalCents,
      deltaCents: revisedTotalCents - baseTotalCents,
      change: rowChange({ base, revised }),
    }
  })
  rows.sort((left, right) => {
    const divisionOrder = left.divisionCode.localeCompare(right.divisionCode)
    if (divisionOrder !== 0) return divisionOrder
    return left.costCode.localeCompare(right.costCode)
  })

  const divisionGroups = new Map<string, EstimateVersionComparisonRow[]>()
  for (const row of rows) {
    const current = divisionGroups.get(row.divisionCode) ?? []
    current.push(row)
    divisionGroups.set(row.divisionCode, current)
  }
  const divisions = [...divisionGroups.entries()].map(
    ([divisionCode, divisionRows]): EstimateVersionComparisonDivision => {
      const baseTotalCents = divisionRows.reduce(
        (total, row) => total + row.baseTotalCents,
        0
      )
      const revisedTotalCents = divisionRows.reduce(
        (total, row) => total + row.revisedTotalCents,
        0
      )
      return {
        divisionCode,
        divisionName: divisionRows[0]?.divisionName ?? `Division ${divisionCode}`,
        baseTotalCents,
        revisedTotalCents,
        deltaCents: revisedTotalCents - baseTotalCents,
        rows: divisionRows,
      }
    }
  )
  const baseTotalCents = rows.reduce(
    (total, row) => total + row.baseTotalCents,
    0
  )
  const revisedTotalCents = rows.reduce(
    (total, row) => total + row.revisedTotalCents,
    0
  )

  return {
    baseTotalCents,
    revisedTotalCents,
    deltaCents: revisedTotalCents - baseTotalCents,
    changedRowCount: rows.filter((row) => row.change !== "unchanged").length,
    divisions,
  }
}
