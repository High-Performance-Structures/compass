/**
 * Sage timecard hours for shop tickets: turning Sage cost codes into the
 * codes Compass uses, and grouping a project's hours by cost code with the
 * hours already billed on other tickets left out.
 */

/**
 * The Compass cost code for a Sage cost code. Sage names most codes with the
 * code first ("03 31 00 - Structural Concrete"); otherwise the record number
 * is read as division, section and subsection digits (3310000 is 03 31 00,
 * 31232313 is 31 23 23.13). Small numbers (32, 508) are used as they are.
 */
export function compassCostCodeFromSage(sageCode: string | null, sageName: string | null): string | null {
  const named = sageName?.match(/^(\d{2} \d{2} \d{2}(?:\.\d{2})?)\s+-\s+/)
  if (named?.[1]) return named[1]
  if (!sageCode) return null
  const whole = sageCode.trim().replace(/\.0+$/, "")
  if (!/^\d+$/.test(whole)) return null
  if (whole.length <= 4) return whole
  const digits = whole.padStart(8, "0")
  const base = `${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 6)}`
  const sub = digits.slice(6, 8)
  return sub === "00" ? base : `${base}.${sub}`
}

export type SageLaborLine = {
  readonly id: string
  readonly workDate: string
  readonly hours: number
  readonly costCode: string | null
  readonly sageCostCodeName: string | null
  readonly employeeName: string | null
}

export type SageLaborGroup = {
  /** Compass cost code, or null when Sage's code has no match. */
  readonly costCode: string | null
  readonly sageCostCodeName: string | null
  /** Hours not yet billed on another ticket. */
  readonly availableHours: number
  /** Hours on other (not void) tickets. */
  readonly billedHours: number
  readonly lines: readonly (SageLaborLine & { readonly availableHours: number })[]
}

function roundHours(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * A project's timecard hours in the ticket's labor dates, grouped by cost
 * code. `billedElsewhere` is hours per timecard line already on other tickets;
 * those hours are not offered again.
 */
export function groupSageLabor(
  lines: readonly SageLaborLine[],
  billedElsewhere: ReadonlyMap<string, number>,
): readonly SageLaborGroup[] {
  const groups = new Map<string, { costCode: string | null; name: string | null; lines: (SageLaborLine & { availableHours: number })[]; billed: number }>()
  for (const line of lines) {
    const key = line.costCode ?? `sage:${line.sageCostCodeName ?? "none"}`
    const group = groups.get(key) ?? { costCode: line.costCode, name: line.sageCostCodeName, lines: [], billed: 0 }
    const billed = Math.min(line.hours, billedElsewhere.get(line.id) ?? 0)
    group.billed += billed
    group.lines.push({ ...line, availableHours: roundHours(line.hours - billed) })
    groups.set(key, group)
  }
  return [...groups.values()]
    .map((group) => ({
      costCode: group.costCode,
      sageCostCodeName: group.name,
      availableHours: roundHours(group.lines.reduce((sum, line) => sum + line.availableHours, 0)),
      billedHours: roundHours(group.billed),
      lines: [...group.lines].sort((a, b) => a.workDate.localeCompare(b.workDate)),
    }))
    .sort((a, b) => (a.costCode ?? "~").localeCompare(b.costCode ?? "~"))
}
